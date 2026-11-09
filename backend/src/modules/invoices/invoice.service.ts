import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
  getQuickBooksStatus,
  syncInvoiceToQuickBooks,
} from '../../services/accounting/quickbooks.adapter.js';
import { recordAudit } from '../../services/audit.js';
import {
  customerOrInspectionScopeFilter,
  resolveCustomerPropertyTarget,
  type AuthContext,
} from '../../services/entity-links.js';
import { sendEmail } from '../../services/email/email.adapter.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { ensureCompanySettings } from '../settings/settings.service.js';
import { renderInvoiceHtml } from './invoice.report.js';
import { getProject } from '../projects/project.service.js';
import type { LineItemKind } from '../settings/company-settings.model.js';
import { getPricingConfig } from '../settings/pricing.service.js';
import {
  InvoiceCounterModel,
  InvoiceModel,
  PaymentModel,
  type InvoiceDocument,
  type InvoiceStatus,
  type PaymentDocument,
  type PaymentSource,
} from './invoice.model.js';

export type { AuthContext };

export type InvoiceDto = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string | null;
  projectId: string | null;
  estimateId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  lineItems: Array<{
    id: string;
    description: string;
    kind: LineItemKind;
    quantity: number;
    unit: string;
    unitCostCents: number;
    amountCents: number;
  }>;
  discountCents: number;
  taxRateBps: number;
  taxCents: number;
  subtotalCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  notes: string;
  externalAccountingRef: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentDto = {
  id: string;
  invoiceId: string;
  customerId: string;
  amountCents: number;
  paymentDate: string;
  method: string;
  transactionRef: string;
  status: string;
  source: PaymentSource;
  notes: string;
  recordedBy: string;
  createdAt: string;
};

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function recalcInvoiceTotals(
  lineItems: Array<{ quantity: number; unitCostCents: number }>,
  discountCents: number,
  taxRateBps: number,
): { subtotalCents: number; taxCents: number; totalCents: number; amounts: number[] } {
  const amounts = lineItems.map((li) => Math.round(li.quantity * li.unitCostCents));
  const subtotalCents = amounts.reduce((s, a) => s + a, 0);
  if (discountCents > subtotalCents) {
    throw new AppError({
      status: 422,
      code: 'INVALID_DISCOUNT',
      message: 'Discount cannot exceed subtotal.',
    });
  }
  const taxable = subtotalCents - discountCents;
  const taxCents = Math.round((taxable * taxRateBps) / 10000);
  return { subtotalCents, taxCents, totalCents: taxable + taxCents, amounts };
}

function deriveStatus(totalCents: number, amountPaidCents: number, current: InvoiceStatus): InvoiceStatus {
  if (current === 'void' || current === 'draft') return current;
  if (amountPaidCents <= 0) return current === 'sent' || current === 'overdue' ? current : 'sent';
  if (amountPaidCents >= totalCents) return 'paid';
  return 'partially_paid';
}

function toInvoiceDto(doc: InvoiceDocument): InvoiceDto {
  const amountPaidCents = doc.amountPaidCents ?? 0;
  return {
    id: doc._id.toString(),
    number: doc.number,
    customerId: doc.customerId.toString(),
    propertyId: idOrNull(doc.propertyId),
    projectId: idOrNull(doc.projectId),
    estimateId: idOrNull(doc.estimateId),
    invoiceDate: doc.invoiceDate.toISOString(),
    dueDate: doc.dueDate ? doc.dueDate.toISOString() : null,
    status: doc.status as InvoiceStatus,
    lineItems: doc.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      kind: li.kind as LineItemKind,
      quantity: li.quantity,
      unit: li.unit,
      unitCostCents: li.unitCostCents,
      amountCents: li.amountCents,
    })),
    discountCents: doc.discountCents,
    taxRateBps: doc.taxRateBps,
    taxCents: doc.taxCents,
    subtotalCents: doc.subtotalCents,
    totalCents: doc.totalCents,
    amountPaidCents,
    balanceCents: Math.max(0, doc.totalCents - amountPaidCents),
    notes: doc.notes ?? '',
    externalAccountingRef: doc.externalAccountingRef ?? '',
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toPaymentDto(doc: PaymentDocument): PaymentDto {
  return {
    id: doc._id.toString(),
    invoiceId: doc.invoiceId.toString(),
    customerId: doc.customerId.toString(),
    amountCents: doc.amountCents,
    paymentDate: doc.paymentDate.toISOString(),
    method: doc.method,
    transactionRef: doc.transactionRef ?? '',
    status: doc.status,
    source: doc.source as PaymentSource,
    notes: doc.notes ?? '',
    recordedBy: doc.recordedBy.toString(),
    createdAt: doc.createdAt.toISOString(),
  };
}

async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counter = await InvoiceCounterModel.findByIdAndUpdate(
    `invoice-${year}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `INV-${year}-${String(counter?.seq ?? 1).padStart(4, '0')}`;
}

async function findInvoice(id: string, auth: AuthContext): Promise<InvoiceDocument> {
  const scope = await customerOrInspectionScopeFilter(auth);
  const doc = mongoose.isValidObjectId(id)
    ? await InvoiceModel.findOne({ _id: id, ...scope })
    : null;
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Invoice not found.' });
  }
  return doc;
}

export async function listInvoices(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  status?: InvoiceStatus;
  customerId?: string;
  projectId?: string;
}): Promise<{ data: InvoiceDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const scope = await customerOrInspectionScopeFilter(input.auth);
  const filter: Record<string, unknown> = { ...scope };
  if (input.status) filter.status = input.status;
  if (input.customerId) filter.customerId = input.customerId;
  if (input.projectId) filter.projectId = input.projectId;
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    InvoiceModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    InvoiceModel.countDocuments(filter),
  ]);
  return { data: rows.map(toInvoiceDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getInvoice(id: string, auth: AuthContext): Promise<InvoiceDto> {
  return toInvoiceDto(await findInvoice(id, auth));
}

export async function createInvoice(input: {
  auth: AuthContext;
  customerId: string;
  propertyId?: string;
  projectId?: string;
  estimateId?: string;
  invoiceDate?: string;
  dueDate?: string;
  lineItems: Array<{
    description: string;
    kind?: LineItemKind;
    quantity: number;
    unit?: string;
    unitCostCents: number;
  }>;
  discountCents?: number;
  taxRateBps?: number;
  notes?: string;
  idempotencyKey?: string;
  requestId?: string;
  ip?: string;
}): Promise<InvoiceDto> {
  if (input.idempotencyKey) {
    const existing = await InvoiceModel.findOne({ idempotencyKey: input.idempotencyKey });
    if (existing) return toInvoiceDto(existing);
  }
  const customer = await CustomerModel.findById(input.customerId);
  if (!customer) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
  if (input.auth.role !== 'admin' && customer.ownerId.toString() !== input.auth.userId) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
  if (input.projectId) {
    const project = await getProject(input.projectId, input.auth);
    if (project.customerId !== input.customerId) {
      throw new AppError({
        status: 422,
        code: 'INVALID_PROJECT',
        message: 'Project does not belong to this customer.',
      });
    }
  }
  if (input.propertyId) {
    await resolveCustomerPropertyTarget(input.auth, {
      customerId: input.customerId,
      propertyId: input.propertyId,
    });
  }

  const pricing = await getPricingConfig();
  const discountCents = input.discountCents ?? 0;
  const taxRateBps = input.taxRateBps ?? pricing.taxRateBps;
  const calc = recalcInvoiceTotals(input.lineItems, discountCents, taxRateBps);
  const lineItems = input.lineItems.map((li, i) => ({
    id: randomUUID(),
    description: li.description,
    kind: li.kind ?? 'other',
    quantity: li.quantity,
    unit: li.unit ?? 'ea',
    unitCostCents: li.unitCostCents,
    amountCents: calc.amounts[i]!,
  }));

  const created = await InvoiceModel.create({
    number: await nextInvoiceNumber(),
    customerId: input.customerId,
    propertyId: input.propertyId,
    projectId: input.projectId,
    estimateId: input.estimateId,
    invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    status: 'draft',
    lineItems,
    discountCents,
    taxRateBps,
    taxCents: calc.taxCents,
    subtotalCents: calc.subtotalCents,
    totalCents: calc.totalCents,
    amountPaidCents: 0,
    notes: input.notes ?? '',
    idempotencyKey: input.idempotencyKey,
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'invoice.created',
    entityType: 'invoice',
    entityId: created._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toInvoiceDto(created);
}

export async function sendInvoice(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<{ invoice: InvoiceDto; emailDelivery: string; qbo: string }> {
  const doc = await findInvoice(input.id, input.auth);
  if (doc.status === 'void') {
    throw new AppError({ status: 409, code: 'INVOICE_VOID', message: 'Void invoices cannot be sent.' });
  }
  doc.status = doc.amountPaidCents > 0 ? deriveStatus(doc.totalCents, doc.amountPaidCents, 'sent') : 'sent';
  const customer = await CustomerModel.findById(doc.customerId);
  let emailDelivery = 'not_configured';
  if (customer?.email) {
    const result = await sendEmail({
      to: customer.email,
      subject: `Invoice ${doc.number}`,
      text: `Invoice ${doc.number} total ${(doc.totalCents / 100).toFixed(2)}`,
    });
    emailDelivery = result.status;
  } else {
    emailDelivery = 'skipped';
  }
  const qbo = await syncInvoiceToQuickBooks(doc._id.toString());
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'invoice.sent',
    entityType: 'invoice',
    entityId: doc._id.toString(),
    changes: { emailDelivery, qbo: qbo.status },
    requestId: input.requestId,
    ip: input.ip,
  });
  return { invoice: toInvoiceDto(doc), emailDelivery, qbo: qbo.status };
}

export async function voidInvoice(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<InvoiceDto> {
  const doc = await findInvoice(input.id, input.auth);
  if (doc.amountPaidCents > 0) {
    throw new AppError({
      status: 422,
      code: 'HAS_PAYMENTS',
      message: 'Invoices with recorded payments cannot be voided.',
    });
  }
  doc.status = 'void';
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'invoice.voided',
    entityType: 'invoice',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toInvoiceDto(doc);
}

export async function recordPayment(input: {
  auth: AuthContext;
  invoiceId: string;
  amountCents: number;
  paymentDate?: string;
  method: string;
  transactionRef?: string;
  notes?: string;
  source?: PaymentSource;
  idempotencyKey?: string;
  requestId?: string;
  ip?: string;
}): Promise<{ payment: PaymentDto; invoice: InvoiceDto }> {
  if (input.idempotencyKey) {
    const existing = await PaymentModel.findOne({ idempotencyKey: input.idempotencyKey });
    if (existing) {
      const inv = await findInvoice(existing.invoiceId.toString(), input.auth);
      return { payment: toPaymentDto(existing), invoice: toInvoiceDto(inv) };
    }
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new AppError({
      status: 422,
      code: 'INVALID_AMOUNT',
      message: 'Payment amount must be a positive integer of cents.',
    });
  }
  const doc = await findInvoice(input.invoiceId, input.auth);
  if (doc.status === 'void' || doc.status === 'draft') {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Payments can only be recorded on sent invoices.',
    });
  }
  const balance = doc.totalCents - doc.amountPaidCents;
  if (input.amountCents > balance) {
    throw new AppError({
      status: 422,
      code: 'OVERPAYMENT',
      message: 'Payment exceeds outstanding balance.',
    });
  }
  const payment = await PaymentModel.create({
    invoiceId: doc._id,
    customerId: doc.customerId,
    amountCents: input.amountCents,
    paymentDate: input.paymentDate ? new Date(input.paymentDate) : new Date(),
    method: input.method.trim(),
    transactionRef: input.transactionRef ?? '',
    notes: input.notes ?? '',
    source: input.source ?? 'manual',
    status: 'recorded',
    idempotencyKey: input.idempotencyKey,
    recordedBy: input.auth.userId,
  });
  doc.amountPaidCents += input.amountCents;
  doc.status = deriveStatus(doc.totalCents, doc.amountPaidCents, doc.status as InvoiceStatus);
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'payment.recorded',
    entityType: 'payment',
    entityId: payment._id.toString(),
    changes: { invoiceId: doc._id.toString(), amountCents: input.amountCents, source: payment.source },
    requestId: input.requestId,
    ip: input.ip,
  });
  return { payment: toPaymentDto(payment), invoice: toInvoiceDto(doc) };
}

export async function listPayments(input: {
  auth: AuthContext;
  invoiceId: string;
}): Promise<PaymentDto[]> {
  await findInvoice(input.invoiceId, input.auth);
  const rows = await PaymentModel.find({ invoiceId: input.invoiceId, status: 'recorded' }).sort({
    paymentDate: -1,
  });
  return rows.map(toPaymentDto);
}

export async function financeSummary(input: {
  auth: AuthContext;
  from?: string;
  to?: string;
}): Promise<{
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
  overdueCount: number;
  qbo: ReturnType<typeof getQuickBooksStatus>;
}> {
  const scope = await customerOrInspectionScopeFilter(input.auth);
  const filter: Record<string, unknown> = { ...scope, status: { $ne: 'void' } };
  if (input.from || input.to) {
    filter.invoiceDate = {};
    if (input.from) (filter.invoiceDate as Record<string, Date>).$gte = new Date(input.from);
    if (input.to) (filter.invoiceDate as Record<string, Date>).$lte = new Date(input.to);
  }
  const invoices = await InvoiceModel.find(filter).select({
    totalCents: 1,
    amountPaidCents: 1,
    status: 1,
    dueDate: 1,
  });
  let invoicedCents = 0;
  let collectedCents = 0;
  let outstandingCents = 0;
  let overdueCount = 0;
  const now = new Date();
  for (const inv of invoices) {
    if (inv.status === 'draft') continue;
    invoicedCents += inv.totalCents;
    collectedCents += inv.amountPaidCents;
    outstandingCents += Math.max(0, inv.totalCents - inv.amountPaidCents);
    if (
      inv.dueDate &&
      inv.dueDate < now &&
      inv.amountPaidCents < inv.totalCents &&
      inv.status !== 'paid'
    ) {
      overdueCount += 1;
    }
  }
  return {
    invoicedCents,
    collectedCents,
    outstandingCents,
    overdueCount,
    qbo: getQuickBooksStatus(),
  };
}

export async function listAllPayments(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  customerId?: string;
  projectId?: string;
}): Promise<{ data: Array<PaymentDto & { invoiceNumber: string }>; meta: ReturnType<typeof paginationMeta> }> {
  const scope = await customerOrInspectionScopeFilter(input.auth);
  const filter: Record<string, unknown> = { ...scope, status: 'recorded' };
  if (input.customerId) filter.customerId = input.customerId;
  if (input.projectId) {
    filter.invoiceId = { $in: await InvoiceModel.find({ projectId: input.projectId }).distinct('_id') };
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    PaymentModel.find(filter).sort({ paymentDate: -1 }).skip(skip).limit(limit),
    PaymentModel.countDocuments(filter),
  ]);
  const invoices = await InvoiceModel.find({ _id: { $in: rows.map((r) => r.invoiceId) } })
    .select({ number: 1 })
    .lean();
  const numbers = new Map(invoices.map((i) => [String(i._id), i.number]));
  return {
    data: rows.map((r) => ({ ...toPaymentDto(r), invoiceNumber: numbers.get(String(r.invoiceId)) ?? '' })),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function getInvoicePreviewHtml(id: string, auth: AuthContext): Promise<string> {
  const doc = await findInvoice(id, auth);
  const dto = toInvoiceDto(doc);
  const [settings, customer, property, payments] = await Promise.all([
    ensureCompanySettings(),
    CustomerModel.findById(doc.customerId),
    doc.propertyId ? PropertyModel.findById(doc.propertyId) : Promise.resolve(null),
    PaymentModel.find({ invoiceId: doc._id, status: 'recorded' }).sort({ paymentDate: 1 }),
  ]);
  const customerName = customer
    ? customer.type === 'business'
      ? customer.companyName
      : `${customer.firstName} ${customer.lastName}`.trim()
    : '';
  const a = property?.address;
  return renderInvoiceHtml({
    company: {
      name: settings.displayName,
      phone: settings.phone ?? '',
      email: settings.email ?? '',
      website: settings.website ?? '',
      licenseText: settings.licenseText ?? '',
      termsText: settings.invoiceTermsText ?? '',
    },
    invoice: {
      number: dto.number,
      status: dto.status,
      invoiceDate: doc.invoiceDate.toISOString(),
      dueDate: doc.dueDate ? doc.dueDate.toISOString() : null,
      lineItems: doc.lineItems.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitCostCents: l.unitCostCents,
        amountCents: l.amountCents,
      })),
      subtotalCents: doc.subtotalCents,
      discountCents: doc.discountCents,
      taxCents: doc.taxCents,
      taxRateBps: doc.taxRateBps,
      totalCents: doc.totalCents,
      amountPaidCents: doc.amountPaidCents,
      notes: doc.notes ?? '',
    },
    customerName,
    propertyAddress: a ? [a.line1, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '',
    payments: payments.map((p) => ({
      paymentDate: p.paymentDate.toISOString(),
      method: p.method,
      amountCents: p.amountCents,
    })),
  });
}
