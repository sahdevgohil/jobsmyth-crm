import { randomUUID } from 'node:crypto';
import mongoose, { type Types } from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta } from '../../utils/pagination.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { EstimateModel, type EstimateDocument } from '../estimates/estimate.model.js';
import { InvoiceModel, PaymentModel } from '../invoices/invoice.model.js';
import { ProjectModel, type ProjectDocument } from '../projects/project.model.js';
import { UserModel } from '../users/user.model.js';
import {
  ACTIVE_STAGES, PIPELINE_STAGES, STAGE_LABEL, checkTransition, computeFinancials, contractValue, naturalStage, stageIndex, stageValue,
  type Financials, type PipelineStage,
} from './pipeline.calc.js';
import { PipelineJobModel, type PipelineJobDocument } from './pipeline.model.js';

export type PipelineAuth = { userId: string; role: 'admin' | 'salesperson' };
export type SyncActor = { actorId?: string; trigger: string; approximate?: boolean };

const oid = (v: string | Types.ObjectId): Types.ObjectId => new mongoose.Types.ObjectId(String(v));
const idStr = (v: unknown): string | null => (v ? String(v) : null);

// ------------------------------------------------------------------ loading the records behind a job

type Records = {
  estimate: EstimateDocument | null;
  project: ProjectDocument | null;
  invoices: Array<{ id: string; status: string; totalCents: number; invoiceDate: Date; dueDate: Date | null }>;
  payments: Array<{ invoiceId: string; amountCents: number; paymentDate: Date }>;
};

async function loadRecords(job: PipelineJobDocument): Promise<Records> {
  const [estimate, project] = await Promise.all([
    job.estimateId ? EstimateModel.findById(job.estimateId) : null,
    job.projectId ? ProjectModel.findById(job.projectId) : null,
  ]);
  const or: Record<string, unknown>[] = [];
  if (job.projectId) or.push({ projectId: job.projectId });
  if (job.estimateIds.length > 0) or.push({ estimateId: { $in: job.estimateIds } });
  const invoiceDocs = or.length > 0 ? await InvoiceModel.find({ $or: or, status: { $ne: 'void' } }).lean() : [];
  const ids = invoiceDocs.map((i) => i._id);
  const paymentDocs = ids.length > 0 ? await PaymentModel.find({ invoiceId: { $in: ids }, status: 'recorded' }).lean() : [];
  return {
    estimate,
    project,
    invoices: invoiceDocs.map((i) => ({ id: String(i._id), status: i.status, totalCents: i.totalCents, invoiceDate: i.invoiceDate, dueDate: i.dueDate ?? null })),
    payments: paymentDocs.map((p) => ({ invoiceId: String(p.invoiceId), amountCents: p.amountCents, paymentDate: p.paymentDate })),
  };
}

function baseContract(job: PipelineJobDocument, r: Records): { cents: number; source: 'estimate' | 'project_budget' | 'none' } {
  const accepted = r.estimate && (r.estimate.status === 'accepted' || Boolean(r.project));
  if (r.estimate && accepted) return { cents: r.estimate.totalCents, source: 'estimate' };
  if (!r.estimate && r.project && r.project.budgetCents > 0) return { cents: r.project.budgetCents, source: 'project_budget' };
  return { cents: job.baseContractCents ?? 0, source: job.valueSource ?? 'none' };
}

function financialsOf(job: PipelineJobDocument, r: Records, base: number, asOf?: Date): Financials {
  return computeFinancials({
    contractCents: contractValue(base, job.changeOrders.map((c) => ({ amountCents: c.amountCents, approvedAt: c.approvedAt })), asOf),
    invoices: r.invoices,
    payments: r.payments,
    asOf,
  });
}

// ------------------------------------------------------------------ transitions

const DATE_FIELD: Record<PipelineStage, 'sentAt' | 'acceptedAt' | 'startedAt' | 'completedAt' | 'invoicedAt' | 'paidAt'> = {
  estimates_out: 'sentAt', estimates_accepted: 'acceptedAt', jobs_started: 'startedAt', jobs_completed: 'completedAt', invoiced: 'invoicedAt', invoices_completed: 'paidAt',
};

type Target = PipelineStage | 'denied' | 'cancelled' | 'archived';
type TransitionOpts = { by?: string; auto: boolean; trigger: string; reason?: string; exception?: boolean; at?: Date; approximate?: boolean; valueCents?: number; manualOverride?: boolean };

const currentKey = (job: PipelineJobDocument): Target => (job.state === 'active' ? (job.stage as PipelineStage) : (job.state as Target));

/** Atomic compare-and-set on (stage/state, version): a concurrent writer makes this one return null instead of double-moving the job. */
async function applyTransition(job: PipelineJobDocument, to: Target, o: TransitionOpts): Promise<PipelineJobDocument | null> {
  const from = currentKey(job);
  const at = o.at ?? new Date();
  const set: Record<string, unknown> = { stageEnteredAt: at };
  const unset: Record<string, 1> = {};
  if ((PIPELINE_STAGES as readonly string[]).includes(to)) {
    set.state = 'active';
    set.stage = to;
    set[DATE_FIELD[to as PipelineStage]] = at;
  } else {
    set.state = to;
    unset.stage = 1;
    if (to === 'denied') set.deniedAt = at;
  }
  if (o.manualOverride !== undefined) set.manualOverride = o.manualOverride;
  const entry = { from, to, at, by: o.by ? oid(o.by) : undefined, auto: o.auto, trigger: o.trigger, reason: o.reason ?? '', exception: o.exception ?? false, approximate: o.approximate ?? false, valueCents: o.valueCents };
  const update: Record<string, unknown> = { $set: set, $inc: { version: 1 }, $push: { history: entry } };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  const res = await PipelineJobModel.findOneAndUpdate({ _id: job._id, version: job.version }, update, { new: true });
  if (res) {
    await recordAudit({ actorType: o.by ? 'user' : 'system', actorId: o.by, action: 'pipeline.stage_changed', entityType: 'pipeline_job', entityId: String(job._id), changes: { from, to, trigger: o.trigger, reason: o.reason ?? '', exception: o.exception ?? false } }).catch(() => undefined);
  }
  return res;
}

// ------------------------------------------------------------------ reconcile: make the stored stage match the records

async function reconcile(jobId: Types.ObjectId | string, actor: SyncActor, attempt = 0): Promise<PipelineJobDocument | null> {
  const job = await PipelineJobModel.findById(jobId);
  if (!job || job.state === 'archived') return job;
  const r = await loadRecords(job);
  const base = baseContract(job, r);
  const fin = financialsOf(job, r, base.cents);
  const est = r.estimate;

  // snapshot fields (not stage changes, so no version bump)
  const snap: Record<string, unknown> = { baseContractCents: base.cents, valueSource: base.source };
  if (est) snap.estimateCents = est.totalCents;
  if (r.project?.projectTypeKey) snap.jobTypeKey = r.project.projectTypeKey;
  if (r.invoices.some((i) => i.status !== 'draft')) {
    const first = r.invoices.filter((i) => i.status !== 'draft').sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime())[0];
    if (first && !job.invoicedAt) snap.invoicedAt = first.invoiceDate;
  }
  if (est?.sentAt && !job.sentAt) snap.sentAt = est.sentAt;
  if (est?.acceptedAt && !job.acceptedAt) snap.acceptedAt = est.acceptedAt;
  if (r.project?.actualStartAt && !job.startedAt) snap.startedAt = r.project.actualStartAt;
  if (r.project?.actualEndAt && !job.completedAt) snap.completedAt = r.project.actualEndAt;
  await PipelineJobModel.updateOne({ _id: job._id }, { $set: snap });

  // What do the records say?
  let target: Target | null;
  const estStatus = est?.status ?? null;
  if (r.project?.status === 'cancelled') target = 'cancelled';
  else if (!r.project && (estStatus === 'denied' || estStatus === 'rejected')) target = 'denied';
  else if (!r.project && (estStatus === 'void' || estStatus === 'expired')) target = 'cancelled';
  else target = naturalStage({ estimateStatus: estStatus, projectStatus: r.project?.status ?? null, projectStarted: Boolean(r.project?.actualStartAt), fin });
  if (target === null) return job; // draft estimate: not a pipeline job yet

  const cur = currentKey(job);
  if (cur === target) return job;
  const isStage = (PIPELINE_STAGES as readonly string[]).includes(target);
  const curIsStage = (PIPELINE_STAGES as readonly string[]).includes(cur);
  if (isStage && curIsStage) {
    const back = stageIndex(target as PipelineStage) < stageIndex(cur as PipelineStage);
    if (back && job.manualOverride) return job; // an administrator pinned the stage; automation only moves forward
  }
  const at = actor.approximate ? undefined : undefined;
  const moved = await applyTransition(job, target, {
    by: actor.actorId,
    auto: true,
    trigger: actor.trigger,
    reason: curIsStage && isStage && stageIndex(target as PipelineStage) < stageIndex(cur as PipelineStage) ? 'Underlying records changed' : '',
    at,
    valueCents: isStage ? stageValue(target as PipelineStage, { estimateCents: est?.totalCents ?? job.estimateCents, fin }) : undefined,
  });
  if (!moved && attempt < 3) return reconcile(jobId, actor, attempt + 1); // lost a race: re-read and decide again
  return moved ?? (await PipelineJobModel.findById(jobId));
}

// ------------------------------------------------------------------ finding or creating the job for a record

async function rootEstimateOf(estimateId: Types.ObjectId): Promise<{ root: Types.ObjectId; chain: Types.ObjectId[] }> {
  const chain: Types.ObjectId[] = [estimateId];
  let cur = await EstimateModel.findById(estimateId).select('parentEstimateId');
  for (let i = 0; i < 20 && cur?.parentEstimateId; i++) {
    chain.push(cur.parentEstimateId);
    cur = await EstimateModel.findById(cur.parentEstimateId).select('parentEstimateId');
  }
  return { root: chain[chain.length - 1] as Types.ObjectId, chain };
}

/** Inserts a job once (the unique keys make a concurrent insert a no-op) and records its first stage entry. */
async function createJob(filter: Record<string, unknown>, fields: Record<string, unknown>, stage: PipelineStage): Promise<PipelineJobDocument | null> {
  const at = new Date();
  const entry = { from: 'none', to: stage, at, auto: true, trigger: 'created', reason: '', exception: false, approximate: false };
  const res = await PipelineJobModel.updateOne(filter, { $setOnInsert: { ...fields, state: 'active', stage, stageEnteredAt: at, version: 0, history: [entry] } }, { upsert: true });
  const job = await PipelineJobModel.findOne(filter);
  if (job && res.upsertedCount > 0) {
    await recordAudit({ actorType: 'system', action: 'pipeline.stage_changed', entityType: 'pipeline_job', entityId: String(job._id), changes: { from: 'none', to: stage, trigger: 'created' } }).catch(() => undefined);
  }
  return job;
}

async function jobForEstimate(estimateId: Types.ObjectId, create: boolean): Promise<PipelineJobDocument | null> {
  const est = await EstimateModel.findById(estimateId);
  if (!est) return null;
  const { root, chain } = await rootEstimateOf(est._id);
  let job = await PipelineJobModel.findOne({ rootEstimateId: root });
  if (!job) job = await PipelineJobModel.findOne({ estimateIds: { $in: chain } });
  if (job) {
    const patch: Record<string, unknown> = { $addToSet: { estimateIds: { $each: chain } } };
    if (String(job.estimateId) !== String(est._id) && ['sent', 'accepted', 'denied', 'rejected'].includes(est.status)) {
      // A newer version of the estimate takes over while the job is open or reopened.
      const take = job.state !== 'active' || job.stage === 'estimates_out' || est.status === 'accepted';
      if (take) patch.$set = { estimateId: est._id, estimateCents: est.totalCents };
    }
    await PipelineJobModel.updateOne({ _id: job._id }, patch);
    return PipelineJobModel.findById(job._id);
  }
  if (!create) return null;
  return createJob({ rootEstimateId: root }, { number: est.number, customerId: est.customerId, propertyId: est.propertyId, leadId: est.leadId, rootEstimateId: root, estimateId: est._id, estimateIds: chain, estimateCents: est.totalCents, sentAt: est.sentAt }, 'estimates_out');
}

async function jobForProject(projectId: Types.ObjectId, create: boolean): Promise<PipelineJobDocument | null> {
  const existing = await PipelineJobModel.findOne({ projectId });
  if (existing) return existing;
  const project = await ProjectModel.findById(projectId);
  if (!project) return null;
  if (project.estimateId) {
    const job = await jobForEstimate(project.estimateId, create);
    if (job) {
      if (!job.projectId) await PipelineJobModel.updateOne({ _id: job._id, projectId: { $exists: false } }, { $set: { projectId: project._id, jobTypeKey: project.projectTypeKey ?? '' } });
      return PipelineJobModel.findById(job._id);
    }
    return null;
  }
  if (!create) return null;
  return createJob({ projectId: project._id }, { number: project.number, customerId: project.customerId, propertyId: project.propertyId, leadId: project.leadId, projectId: project._id, jobTypeKey: project.projectTypeKey ?? '' }, 'estimates_accepted');
}

// ------------------------------------------------------------------ hooks used by the estimate, proposal, project and invoice modules

export async function syncFromEstimate(estimateId: string, actor: SyncActor): Promise<PipelineJobDocument | null> {
  const est = await EstimateModel.findById(estimateId).select('status');
  if (!est || est.status === 'draft') return null;
  const job = await jobForEstimate(oid(estimateId), est.status === 'sent' || est.status === 'accepted');
  if (!job) return null;
  const r = await reconcile(job._id, actor);
  return r;
}

export async function syncFromProject(projectId: string, actor: SyncActor): Promise<PipelineJobDocument | null> {
  const job = await jobForProject(oid(projectId), true);
  return job ? reconcile(job._id, actor) : null;
}

export async function syncFromInvoice(invoiceId: string, actor: SyncActor): Promise<PipelineJobDocument | null> {
  const inv = await InvoiceModel.findById(invoiceId).select('projectId estimateId');
  if (!inv) return null;
  let job: PipelineJobDocument | null = null;
  if (inv.projectId) job = await jobForProject(inv.projectId, false);
  if (!job && inv.estimateId) job = await jobForEstimate(inv.estimateId, false);
  return job ? reconcile(job._id, actor) : null;
}

// ------------------------------------------------------------------ manual stage change (administrators)

export async function moveJob(input: { auth: PipelineAuth; id: string; toStage: PipelineStage; reason: string; requestId?: string; ip?: string }): Promise<JobView> {
  if (!mongoose.isValidObjectId(input.id)) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Job not found.' });
  const job = await PipelineJobModel.findById(input.id);
  if (!job) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Job not found.' });
  if (job.state !== 'active' || !job.stage) throw new AppError({ status: 409, code: 'INVALID_STATE', message: `A ${job.state} job cannot be moved. Reopen the estimate first.` });
  const r = await loadRecords(job);
  const fin = financialsOf(job, r, baseContract(job, r).cents);
  const check = checkTransition(job.stage as PipelineStage, input.toStage, { fin, hasReason: input.reason.trim().length >= 3, isAdmin: input.auth.role === 'admin' });
  if (!check.ok) throw new AppError({ status: check.code === 'EXCEPTION_NOT_ALLOWED' ? 403 : check.code === 'NO_CHANGE' ? 409 : 422, code: check.code, message: check.message });
  const moved = await applyTransition(job, input.toStage, { by: input.auth.userId, auto: false, trigger: 'manual', reason: input.reason.trim(), exception: check.exception, manualOverride: true, valueCents: stageValue(input.toStage, { estimateCents: job.estimateCents, fin }) });
  if (!moved) throw new AppError({ status: 409, code: 'CONCURRENT_UPDATE', message: 'The job was changed by someone else. Reload and try again.' });
  const view = (await jobViews({ auth: input.auth, jobId: input.id }))[0];
  if (!view) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Job not found.' });
  return view;
}

export async function addChangeOrder(input: { auth: PipelineAuth; id: string; description: string; amountCents: number; requestId?: string; ip?: string }): Promise<JobView> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents === 0) throw new AppError({ status: 422, code: 'INVALID_AMOUNT', message: 'A change order needs a non-zero amount in whole cents.' });
  const job = await PipelineJobModel.findById(input.id);
  if (!job || job.state !== 'active') throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Active job not found.' });
  await PipelineJobModel.updateOne({ _id: job._id }, { $push: { changeOrders: { id: randomUUID(), description: input.description.trim(), amountCents: input.amountCents, approvedAt: new Date(), approvedBy: oid(input.auth.userId) } } });
  await recordAudit({ actorType: 'user', actorId: input.auth.userId, action: 'pipeline.change_order_added', entityType: 'pipeline_job', entityId: input.id, changes: { amountCents: input.amountCents, description: input.description }, requestId: input.requestId, ip: input.ip });
  await reconcile(job._id, { actorId: input.auth.userId, trigger: 'change_order' });
  const view = (await jobViews({ auth: input.auth, jobId: input.id }))[0];
  if (!view) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Job not found.' });
  return view;
}

// ------------------------------------------------------------------ read models

export type JobView = {
  id: string;
  number: string;
  state: string;
  stage: PipelineStage | null;
  stageLabel: string;
  stageDate: string | null;
  customer: { id: string; name: string };
  property: { id: string; address: string } | null;
  jobType: string;
  estimateId: string | null;
  projectId: string | null;
  projectStatus: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  paidAt: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  estimateCents: number;
  contractCents: number;
  invoicedCents: number;
  paidCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdue: boolean;
  paymentStatus: Financials['paymentStatus'];
  /** The amount this job contributes to its stage. */
  valueCents: number;
  salesperson: { id: string; name: string } | null;
  projectManager: { id: string; name: string } | null;
  denial: { reason: string; note: string; at: string | null } | null;
  approximateHistory: boolean;
};

export type JobFilters = {
  from?: Date;
  to?: Date;
  salespersonId?: string;
  projectManagerId?: string;
  jobType?: string;
  paymentStatus?: Financials['paymentStatus'];
};

const fullName = (c: { type?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null }): string =>
  (c.type === 'business' && c.companyName ? c.companyName : `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()) || 'Unnamed customer';

async function scopeCustomerIds(auth: PipelineAuth, salespersonId?: string): Promise<Types.ObjectId[] | null> {
  if (auth.role !== 'admin') return (await CustomerModel.find({ ownerId: auth.userId }).distinct('_id')) as Types.ObjectId[];
  if (salespersonId) return (await CustomerModel.find({ ownerId: salespersonId }).distinct('_id')) as Types.ObjectId[];
  return null;
}

export async function jobViews(input: { auth: PipelineAuth; filters?: JobFilters; asOf?: Date; jobId?: string }): Promise<JobView[]> {
  const f = input.filters ?? {};
  const q: Record<string, unknown> = {};
  if (input.jobId) q._id = oid(input.jobId);
  let custIds = await scopeCustomerIds(input.auth, f.salespersonId);
  if (input.auth.role !== 'admin' && f.salespersonId && f.salespersonId !== input.auth.userId) custIds = [];
  if (custIds) q.customerId = { $in: custIds };
  if (f.jobType) q.jobTypeKey = f.jobType;
  if (f.projectManagerId) {
    const pids = await ProjectModel.find({ projectManagerId: f.projectManagerId }).distinct('_id');
    q.projectId = { $in: pids };
  }
  if (!input.asOf && (f.from || f.to)) q.stageEnteredAt = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  const jobs = await PipelineJobModel.find(q).lean();
  if (jobs.length === 0) return [];

  const jobDocs = jobs as unknown as PipelineJobDocument[];
  const projectIds = jobDocs.map((j) => j.projectId).filter(Boolean);
  const estimateIds = jobDocs.flatMap((j) => j.estimateIds ?? []);
  const [customers, properties, projects, estimates, invoices] = await Promise.all([
    CustomerModel.find({ _id: { $in: jobDocs.map((j) => j.customerId) } }).select('type firstName lastName companyName ownerId').lean(),
    PropertyModel.find({ _id: { $in: jobDocs.map((j) => j.propertyId).filter(Boolean) } }).select('address').lean(),
    ProjectModel.find({ _id: { $in: projectIds } }).select('status projectManagerId actualStartAt projectTypeKey').lean(),
    EstimateModel.find({ _id: { $in: jobDocs.map((j) => j.estimateId).filter(Boolean) } }).select('status totalCents denialReason denialNote deniedAt').lean(),
    InvoiceModel.find({ $or: [{ projectId: { $in: projectIds } }, { estimateId: { $in: estimateIds } }], status: { $ne: 'void' } }).lean(),
  ]);
  const payments = await PaymentModel.find({ invoiceId: { $in: invoices.map((i) => i._id) }, status: 'recorded' }).lean();
  const userIds = new Set<string>();
  for (const c of customers) userIds.add(String(c.ownerId));
  for (const p of projects) if (p.projectManagerId) userIds.add(String(p.projectManagerId));
  const users = await UserModel.find({ _id: { $in: [...userIds] } }).select('firstName lastName').lean();

  const byId = <T extends { _id: unknown }>(xs: T[]): Map<string, T> => new Map(xs.map((x) => [String(x._id), x]));
  const cMap = byId(customers), pMap = byId(properties), prMap = byId(projects), eMap = byId(estimates), uMap = byId(users);
  const userName = (id: unknown): { id: string; name: string } | null => {
    const u = id ? uMap.get(String(id)) : undefined;
    return u ? { id: String(u._id), name: `${u.firstName} ${u.lastName}`.trim() } : null;
  };
  const payByInv = new Map<string, typeof payments>();
  for (const p of payments) { const k = String(p.invoiceId); payByInv.set(k, [...(payByInv.get(k) ?? []), p]); }

  const out: JobView[] = [];
  for (const j of jobDocs) {
    const asOf = input.asOf;
    // Stage as of a date comes from the stage history, never from the current stage.
    let key: string = j.state === 'active' ? (j.stage as string) : j.state;
    let stageDate: Date | null = j.stageEnteredAt;
    if (asOf) {
      const entries = (j.history ?? []).filter((h) => h.at.getTime() <= asOf.getTime());
      const last = entries[entries.length - 1];
      if (!last) continue; // did not exist yet
      key = last.to;
      stageDate = last.at;
      if (f.from && stageDate < f.from) { /* date filter applies to the stage date as of the report date */ }
    }
    if (f.from && stageDate && stageDate < f.from) continue;
    if (f.to && stageDate && stageDate > f.to) continue;
    const inv = invoices.filter((i) => (j.projectId && String(i.projectId) === String(j.projectId)) || (i.estimateId && (j.estimateIds ?? []).some((e) => String(e) === String(i.estimateId))));
    const pay = inv.flatMap((i) => (payByInv.get(String(i._id)) ?? []));
    const est = j.estimateId ? eMap.get(String(j.estimateId)) : undefined;
    const proj = j.projectId ? prMap.get(String(j.projectId)) : undefined;
    const fin = computeFinancials({
      contractCents: contractValue(j.baseContractCents ?? 0, (j.changeOrders ?? []).map((c) => ({ amountCents: c.amountCents, approvedAt: c.approvedAt })), asOf),
      invoices: inv.map((i) => ({ id: String(i._id), status: i.status, totalCents: i.totalCents, invoiceDate: i.invoiceDate, dueDate: i.dueDate ?? null })),
      payments: pay.map((p) => ({ invoiceId: String(p.invoiceId), amountCents: p.amountCents, paymentDate: p.paymentDate })),
      asOf,
    });
    const stage = (PIPELINE_STAGES as readonly string[]).includes(key) ? (key as PipelineStage) : null;
    const state = stage ? 'active' : key;
    if (f.paymentStatus && fin.paymentStatus !== f.paymentStatus) continue;
    const issued = inv.filter((i) => ['sent', 'partially_paid', 'paid', 'overdue'].includes(i.status)).sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime());
    const unpaidDue = issued.filter((i) => i.dueDate).map((i) => i.dueDate as Date).sort((a, b) => a.getTime() - b.getTime())[0];
    const cust = cMap.get(String(j.customerId));
    const prop = j.propertyId ? pMap.get(String(j.propertyId)) : undefined;
    const a = prop?.address as { line1?: string; city?: string; state?: string; zip?: string } | undefined;
    const estCents = est?.totalCents ?? j.estimateCents ?? 0;
    out.push({
      id: String(j._id),
      number: j.number,
      state,
      stage,
      stageLabel: stage ? STAGE_LABEL[stage] : state === 'denied' ? 'Denied' : state === 'cancelled' ? 'Cancelled' : 'Archived',
      stageDate: stageDate ? stageDate.toISOString() : null,
      customer: { id: String(j.customerId), name: cust ? fullName(cust) : 'Unknown customer' },
      property: prop ? { id: String(prop._id), address: [a?.line1, a?.city, [a?.state, a?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') } : null,
      jobType: proj?.projectTypeKey || j.jobTypeKey || '',
      estimateId: idStr(j.estimateId),
      projectId: idStr(j.projectId),
      projectStatus: proj?.status ?? null,
      sentAt: j.sentAt ? j.sentAt.toISOString() : null,
      acceptedAt: j.acceptedAt ? j.acceptedAt.toISOString() : null,
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
      paidAt: j.paidAt ? j.paidAt.toISOString() : null,
      invoiceDate: issued[0] ? issued[0].invoiceDate.toISOString() : null,
      dueDate: unpaidDue ? unpaidDue.toISOString() : null,
      estimateCents: estCents,
      contractCents: fin.contractCents,
      invoicedCents: fin.invoicedCents,
      paidCents: fin.paidCents,
      outstandingCents: fin.outstandingCents,
      overdueCents: fin.overdueCents,
      overdue: fin.overdueCents > 0,
      paymentStatus: fin.paymentStatus,
      valueCents: stage ? stageValue(stage, { estimateCents: estCents, fin }) : state === 'denied' ? estCents : 0,
      salesperson: userName(cust?.ownerId),
      projectManager: userName(proj?.projectManagerId),
      denial: state === 'denied' ? { reason: est?.denialReason ?? '', note: est?.denialNote ?? '', at: (est?.deniedAt ?? j.deniedAt)?.toISOString() ?? null } : null,
      approximateHistory: (j.history ?? []).some((h) => h.approximate),
    });
  }
  return out;
}

export type StageSummary = { stage: PipelineStage; label: string; jobCount: number; valueCents: number; percentOfActive: number | null; active: boolean };

export const CALCULATION_EXPLANATION =
  'Total active pipeline = Estimates Out (sent estimate amounts) + Estimates Accepted, Jobs Started and Jobs Completed (approved contract value including change orders) + Invoiced (outstanding balance: the larger of the contract and the issued invoices, minus payments received). Invoices Completed, denied estimates, cancelled and archived jobs are excluded. Each job is counted once, in its current stage.';

export async function pipelineSummary(input: { auth: PipelineAuth; filters?: JobFilters; asOf?: Date }) {
  const views = await jobViews({ auth: input.auth, filters: input.filters, asOf: input.asOf });
  const stages: StageSummary[] = PIPELINE_STAGES.map((stage) => {
    const inStage = views.filter((v) => v.stage === stage);
    return { stage, label: STAGE_LABEL[stage], jobCount: inStage.length, valueCents: inStage.reduce((a, v) => a + v.valueCents, 0), percentOfActive: null, active: ACTIVE_STAGES.includes(stage) };
  });
  const totalActiveCents = stages.filter((s) => s.active).reduce((a, s) => a + s.valueCents, 0);
  for (const s of stages) if (s.active) s.percentOfActive = totalActiveCents > 0 ? Math.round((s.valueCents / totalActiveCents) * 1000) / 10 : 0;
  const denied = views.filter((v) => v.state === 'denied');
  const limitations: string[] = [];
  if (views.some((v) => v.approximateHistory)) limitations.push('Some jobs existed before the pipeline was introduced. Their stage dates come from the best available record dates and are marked approximate.');
  if (input.asOf) limitations.push('Historical views use stage history and dated invoices and payments. Estimate amounts and invoices that were voided later are shown as they are now, because their earlier values were not recorded.');
  return {
    stages,
    totalActiveCents,
    activeJobCount: stages.filter((s) => s.active).reduce((a, s) => a + s.jobCount, 0),
    denied: { jobCount: denied.length, valueCents: denied.reduce((a, v) => a + v.valueCents, 0) },
    calculation: CALCULATION_EXPLANATION,
    asOf: input.asOf ? input.asOf.toISOString() : null,
    limitations,
  };
}

export type JobListQuery = { stage?: PipelineStage | 'denied'; search?: string; sort?: string; dir?: 'asc' | 'desc'; page: number; pageSize: number };

export async function listPipelineJobs(input: { auth: PipelineAuth; filters?: JobFilters; asOf?: Date; query: JobListQuery }) {
  const all = await jobViews({ auth: input.auth, filters: input.filters, asOf: input.asOf });
  const q = input.query;
  let rows = all.filter((v) => (q.stage === 'denied' ? v.state === 'denied' : q.stage ? v.stage === q.stage : v.state === 'active'));
  if (q.search) {
    const s = q.search.toLowerCase();
    rows = rows.filter((v) => [v.customer.name, v.property?.address ?? '', v.number, v.jobType].some((x) => x.toLowerCase().includes(s)));
  }
  const key = q.sort ?? 'stageDate';
  const dir = q.dir === 'asc' ? 1 : -1;
  const val = (v: JobView): string | number => {
    switch (key) {
      case 'customer': return v.customer.name.toLowerCase();
      case 'value': return v.valueCents;
      case 'outstanding': return v.outstandingCents;
      case 'paid': return v.paidCents;
      case 'number': return v.number;
      default: return v.stageDate ?? '';
    }
  };
  rows.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * dir);
  const totals = { jobCount: rows.length, valueCents: rows.reduce((a, v) => a + v.valueCents, 0), invoicedCents: rows.reduce((a, v) => a + v.invoicedCents, 0), paidCents: rows.reduce((a, v) => a + v.paidCents, 0), outstandingCents: rows.reduce((a, v) => a + v.outstandingCents, 0) };
  const start = (q.page - 1) * q.pageSize;
  return { data: rows.slice(start, start + q.pageSize), meta: paginationMeta(rows.length, q.page, q.pageSize), totals };
}

export async function jobHistory(auth: PipelineAuth, id: string) {
  const views = await jobViews({ auth, jobId: id });
  if (views.length === 0) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Job not found.' });
  const job = await PipelineJobModel.findById(id).lean();
  const users = await UserModel.find({ _id: { $in: (job?.history ?? []).map((h) => h.by).filter(Boolean) } }).select('firstName lastName').lean();
  const names = new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  return {
    job: views[0],
    history: (job?.history ?? []).map((h) => ({ from: h.from, to: h.to, at: h.at.toISOString(), by: h.by ? names.get(String(h.by)) ?? 'Unknown user' : 'System', auto: h.auto, trigger: h.trigger, reason: h.reason, exception: h.exception, approximate: h.approximate, valueCents: h.valueCents ?? null })),
    changeOrders: (job?.changeOrders ?? []).map((c) => ({ id: c.id, description: c.description, amountCents: c.amountCents, approvedAt: c.approvedAt.toISOString() })),
  };
}

// ------------------------------------------------------------------ backfill of jobs that existed before the pipeline

/**
 * Creates pipeline jobs for existing estimates and projects. Stage history is rebuilt from the dates the records hold and every
 * rebuilt entry is marked approximate. Safe to run repeatedly: jobs are keyed by estimate lineage / project.
 */
export async function backfillPipeline(actorId?: string): Promise<{ estimates: number; projects: number; jobs: number }> {
  let estimates = 0, projects = 0;
  const startedAt = new Date();
  const cursor = EstimateModel.find({ status: { $in: ['sent', 'accepted', 'denied', 'rejected'] } }).sort({ createdAt: 1 }).cursor();
  for await (const e of cursor) {
    const job = await jobForEstimate(e._id, true);
    if (job && job.createdAt >= startedAt) await rebuildHistory(job._id, actorId);
    else if (job) await reconcile(job._id, { actorId, trigger: 'backfill' });
    estimates += 1;
  }
  for await (const p of ProjectModel.find({}).sort({ createdAt: 1 }).cursor()) {
    const job = await jobForProject(p._id, true);
    if (job && job.createdAt >= startedAt) await rebuildHistory(job._id, actorId);
    else if (job) await reconcile(job._id, { actorId, trigger: 'backfill' });
    projects += 1;
  }
  const jobs = await PipelineJobModel.countDocuments({});
  await recordAudit({ actorType: actorId ? 'user' : 'system', actorId, action: 'pipeline.backfill', entityType: 'pipeline_job', entityId: 'all', changes: { estimates, projects, jobs } }).catch(() => undefined);
  return { estimates, projects, jobs };
}

async function rebuildHistory(jobId: Types.ObjectId, actorId?: string): Promise<void> {
  const job = await PipelineJobModel.findById(jobId);
  if (!job) return;
  const r = await loadRecords(job);
  const base = baseContract(job, r);
  const fin = financialsOf(job, r, base.cents);
  const est = r.estimate;
  const proj = r.project;
  const stageTarget: Target | null = proj?.status === 'cancelled' ? 'cancelled'
    : !proj && (est?.status === 'denied' || est?.status === 'rejected') ? 'denied'
    : naturalStage({ estimateStatus: est?.status ?? null, projectStatus: proj?.status ?? null, projectStarted: Boolean(proj?.actualStartAt), fin });
  if (!stageTarget) return;
  const issued = r.invoices.filter((i) => i.status !== 'draft').sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime());
  const lastPay = [...r.payments].sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime())[0];
  const dates: Record<PipelineStage, Date> = {
    estimates_out: est?.sentAt ?? est?.createdAt ?? new Date(),
    estimates_accepted: est?.acceptedAt ?? proj?.createdAt ?? est?.updatedAt ?? new Date(),
    jobs_started: proj?.actualStartAt ?? proj?.updatedAt ?? new Date(),
    jobs_completed: proj?.actualEndAt ?? proj?.updatedAt ?? new Date(),
    invoiced: issued[0]?.invoiceDate ?? new Date(),
    invoices_completed: lastPay?.paymentDate ?? new Date(),
  };
  const chain: Target[] = [];
  if (stageTarget === 'denied' || stageTarget === 'cancelled') { chain.push('estimates_out', stageTarget); }
  else for (let i = 0; i <= stageIndex(stageTarget); i++) chain.push(PIPELINE_STAGES[i] as PipelineStage);
  const history: Array<Record<string, unknown>> = [];
  let prev: Target | 'none' = 'none';
  let t = 0;
  for (const to of chain) {
    const natural = (PIPELINE_STAGES as readonly string[]).includes(to) ? dates[to as PipelineStage].getTime() : (est?.deniedAt ?? est?.updatedAt ?? new Date()).getTime();
    t = Math.max(t, natural);
    history.push({ from: prev, to, at: new Date(t), auto: true, trigger: 'backfill', reason: 'Rebuilt from record dates', exception: false, approximate: true, by: actorId ? oid(actorId) : undefined });
    prev = to;
  }
  const last = history[history.length - 1] as { at: Date; to: Target };
  const set: Record<string, unknown> = { state: (PIPELINE_STAGES as readonly string[]).includes(last.to) ? 'active' : last.to, stageEnteredAt: last.at, baseContractCents: base.cents, valueSource: base.source, history, sentAt: dates.estimates_out };
  if (est) set.estimateCents = est.totalCents;
  if ((PIPELINE_STAGES as readonly string[]).includes(last.to)) set.stage = last.to;
  if (stageIndex((last.to as PipelineStage)) >= 1) set.acceptedAt = dates.estimates_accepted;
  await PipelineJobModel.updateOne({ _id: job._id, 'history.1': { $exists: false } }, { $set: set, $inc: { version: 1 } });
}
