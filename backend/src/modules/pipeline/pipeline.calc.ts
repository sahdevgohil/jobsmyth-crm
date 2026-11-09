/**
 * Pipeline financial rules. Pure functions over integer cents: no database access, no floating point money.
 * The rules are documented in docs/PIPELINE_FINANCIAL_RULES.md; this file is their single implementation.
 */

export const PIPELINE_STAGES = ['estimates_out', 'estimates_accepted', 'jobs_started', 'jobs_completed', 'invoiced', 'invoices_completed'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  estimates_out: 'Estimates Out',
  estimates_accepted: 'Estimates Accepted',
  jobs_started: 'Jobs Started',
  jobs_completed: 'Jobs Completed',
  invoiced: 'Invoiced',
  invoices_completed: 'Invoices Completed',
};

/** Stages whose value counts toward the total active pipeline. Invoices Completed leaves it. */
export const ACTIVE_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.slice(0, 5);

export const stageIndex = (s: PipelineStage): number => PIPELINE_STAGES.indexOf(s);

export type InvoiceLite = { id: string; status: string; totalCents: number; invoiceDate: Date; dueDate?: Date | null };
export type PaymentLite = { invoiceId: string; amountCents: number; paymentDate: Date };

const ISSUED = new Set(['sent', 'partially_paid', 'paid', 'overdue']);
export const isIssued = (status: string): boolean => ISSUED.has(status);

export type Financials = {
  contractCents: number;
  invoicedCents: number;
  paidCents: number;
  /** Money still to collect on the contract: the larger of the contract and what was invoiced, minus payments. Never negative. */
  outstandingCents: number;
  overdueCents: number;
  hasDraftInvoice: boolean;
  issuedInvoiceCount: number;
  paidInFull: boolean;
  paymentStatus: 'none' | 'unpaid' | 'partial' | 'overdue' | 'paid';
};

export type FinancialInput = {
  contractCents: number;
  invoices: InvoiceLite[];
  payments: PaymentLite[];
  /** Evaluate the ledger as of this moment (history reports). Defaults to now. */
  asOf?: Date;
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Financials of one job from its invoices and the payment ledger.
 *  - invoicedCents: issued invoices only (draft and void never count)
 *  - paidCents: recorded payments on issued invoices
 *  - outstandingCents: max(contract, invoiced) - paid, so a part-billed contract keeps its unbilled remainder in the pipeline
 *  - paidInFull: at least one issued invoice, no draft invoice waiting, and everything billable is paid
 */
export function computeFinancials(inp: FinancialInput): Financials {
  const asOf = inp.asOf ?? new Date();
  const issued = inp.invoices.filter((i) => isIssued(i.status) && i.invoiceDate.getTime() <= asOf.getTime());
  const issuedIds = new Set(issued.map((i) => i.id));
  const payments = inp.payments.filter((p) => issuedIds.has(p.invoiceId) && p.paymentDate.getTime() <= asOf.getTime());
  const invoicedCents = sum(issued.map((i) => i.totalCents));
  const paidCents = sum(payments.map((p) => p.amountCents));
  const contractCents = Math.max(0, inp.contractCents);
  const basis = Math.max(contractCents, invoicedCents);
  const outstandingCents = Math.max(0, basis - paidCents);
  const hasDraftInvoice = inp.invoices.some((i) => i.status === 'draft');
  const paidByInvoice = new Map<string, number>();
  for (const p of payments) paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + p.amountCents);
  const overdueCents = sum(
    issued
      .filter((i) => i.dueDate && i.dueDate.getTime() < asOf.getTime())
      .map((i) => Math.max(0, i.totalCents - (paidByInvoice.get(i.id) ?? 0))),
  );
  const paidInFull = issued.length > 0 && !hasDraftInvoice && paidCents >= basis;
  const paymentStatus: Financials['paymentStatus'] = issued.length === 0 ? 'none' : paidInFull ? 'paid' : overdueCents > 0 ? 'overdue' : paidCents > 0 ? 'partial' : 'unpaid';
  return { contractCents, invoicedCents, paidCents, outstandingCents, overdueCents, hasDraftInvoice, issuedInvoiceCount: issued.length, paidInFull, paymentStatus };
}

/** Contract value: the accepted amount plus approved change orders (signed). Never below zero. */
export function contractValue(baseCents: number, changeOrders: Array<{ amountCents: number; approvedAt?: Date | null }>, asOf?: Date): number {
  const cos = changeOrders.filter((c) => !asOf || !c.approvedAt || c.approvedAt.getTime() <= asOf.getTime());
  return Math.max(0, baseCents + sum(cos.map((c) => c.amountCents)));
}

/** The one dollar figure a job contributes to its current stage. */
export function stageValue(stage: PipelineStage, v: { estimateCents: number; fin: Financials }): number {
  switch (stage) {
    case 'estimates_out': return v.estimateCents;
    case 'estimates_accepted':
    case 'jobs_started':
    case 'jobs_completed': return v.fin.contractCents;
    case 'invoiced': return v.fin.outstandingCents;
    case 'invoices_completed': return v.fin.paidCents;
  }
}

export type NaturalInput = {
  estimateStatus: string | null;
  projectStatus: string | null;
  projectStarted: boolean;
  fin: Financials;
  currentStage?: PipelineStage;
};

const STARTED_STATUSES = new Set(['in_progress', 'quality_review']);
const DONE_STATUSES = new Set(['completed', 'closed']);

/**
 * The stage the underlying records support. Invoices only move a job into Invoiced after the work is complete;
 * a deposit invoice on an earlier stage does not change the stage (its payment still reduces the outstanding balance later).
 * Returns null when the records support no active stage (cancelled project, denied or void estimate).
 */
export function naturalStage(n: NaturalInput): PipelineStage | null {
  if (n.projectStatus === 'cancelled') return null;
  let stage: PipelineStage;
  if (n.projectStatus) {
    if (DONE_STATUSES.has(n.projectStatus)) stage = 'jobs_completed';
    else if (STARTED_STATUSES.has(n.projectStatus) || (n.projectStatus === 'on_hold' && n.projectStarted)) stage = 'jobs_started';
    else stage = 'estimates_accepted';
  } else if (n.estimateStatus === 'accepted') stage = 'estimates_accepted';
  else if (n.estimateStatus === 'sent') stage = 'estimates_out';
  else return null;
  if (stage === 'jobs_completed' && n.fin.issuedInvoiceCount > 0) stage = n.fin.paidInFull ? 'invoices_completed' : 'invoiced';
  return stage;
}

export type TransitionCheck = { ok: true; exception: boolean } | { ok: false; code: string; message: string };

/**
 * A move is "normal" when it goes one step forward, or one step back with a reason. Anything else (a jump, or into
 * Invoices Completed without a fully paid ledger) is an exception that needs an administrator and a reason.
 */
export function checkTransition(from: PipelineStage, to: PipelineStage, o: { fin: Financials; hasReason: boolean; isAdmin: boolean }): TransitionCheck {
  if (from === to) return { ok: false, code: 'NO_CHANGE', message: 'The job is already in that stage.' };
  const d = stageIndex(to) - stageIndex(from);
  let exception = false;
  if (d !== 1) exception = true;
  if (d === -1 && !o.hasReason) return { ok: false, code: 'REASON_REQUIRED', message: 'A reason is required to move a job back.' };
  if (to === 'invoices_completed' && !o.fin.paidInFull) exception = true;
  if (to === 'invoiced' && o.fin.issuedInvoiceCount === 0) exception = true;
  if (exception) {
    if (!o.isAdmin) return { ok: false, code: 'EXCEPTION_NOT_ALLOWED', message: 'Only an administrator can make this stage change, because the job records do not support it.' };
    if (!o.hasReason) return { ok: false, code: 'REASON_REQUIRED', message: 'A reason is required for an exceptional stage change.' };
  }
  return { ok: true, exception };
}
