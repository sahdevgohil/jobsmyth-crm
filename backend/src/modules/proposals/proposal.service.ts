import mongoose from 'mongoose';
import { assertEstimatePublishable } from '../pricing/pricing.service.js';
import { recordAudit } from '../../services/audit.js';
import { sendEmail } from '../../services/email/email.adapter.js';
import {
  customerOrInspectionScopeFilter,
  type AuthContext,
} from '../../services/entity-links.js';
import {
  createSignatureRequest,
  getSignatureProvidersStatus,
} from '../../services/signatures/signature.adapter.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { getEstimate } from '../estimates/estimate.service.js';
import type { LineItemKind } from '../settings/company-settings.model.js';
import { ensureCompanySettings } from '../settings/settings.service.js';
import {
  ProposalCounterModel,
  ProposalModel,
  type ProposalDocument,
  type ProposalStatus,
  type SignatureStatus,
} from './proposal.model.js';
import { renderProposalHtml } from './proposal.report.js';

export type { AuthContext };

let log: Logger | undefined;
function getLog(): Logger {
  if (!log) log = createLogger();
  return log;
}

export type ProposalDto = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string;
  estimateId: string;
  version: number;
  status: ProposalStatus;
  lineItems: Array<{
    id: string;
    description: string;
    kind: LineItemKind;
    quantity: number;
    unit: string;
    unitCostCents: number;
    laborCostCents: number;
    materialCostCents: number;
    amountCents: number;
  }>;
  discountCents: number;
  taxRateBps: number;
  taxCents: number;
  subtotalCents: number;
  totalCents: number;
  termsAndConditions: string;
  paymentSchedule: Array<{ label: string; percentBps: number | null; amountCents: number | null }>;
  expirationDate: string | null;
  signature: {
    status: SignatureStatus;
    provider: 'none' | 'dropbox_sign' | 'docusign';
    providerRef: string;
    signedAt: string | null;
    signedDocumentFileId: string | null;
    errorMessage: string;
  };
  notes: string;
  parentProposalId: string | null;
  lastEmailDelivery: { status: string; message: string; at: string | null };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDto(doc: ProposalDocument): ProposalDto {
  return {
    id: doc._id.toString(),
    number: doc.number,
    customerId: doc.customerId.toString(),
    propertyId: doc.propertyId.toString(),
    estimateId: doc.estimateId.toString(),
    version: doc.version,
    status: doc.status as ProposalStatus,
    lineItems: doc.lineItems.map((item) => ({
      id: item.id,
      description: item.description,
      kind: item.kind as LineItemKind,
      quantity: item.quantity,
      unit: item.unit,
      unitCostCents: item.unitCostCents,
      laborCostCents: item.laborCostCents,
      materialCostCents: item.materialCostCents,
      amountCents: item.amountCents,
    })),
    discountCents: doc.discountCents,
    taxRateBps: doc.taxRateBps,
    taxCents: doc.taxCents,
    subtotalCents: doc.subtotalCents,
    totalCents: doc.totalCents,
    termsAndConditions: doc.termsAndConditions ?? '',
    paymentSchedule: (doc.paymentSchedule ?? []).map((s) => ({
      label: s.label,
      percentBps: s.percentBps ?? null,
      amountCents: s.amountCents ?? null,
    })),
    expirationDate: doc.expirationDate ? doc.expirationDate.toISOString() : null,
    signature: {
      status: (doc.signature?.status ?? 'not_requested') as SignatureStatus,
      provider: (doc.signature?.provider ?? 'none') as 'none' | 'dropbox_sign' | 'docusign',
      providerRef: doc.signature?.providerRef ?? '',
      signedAt: doc.signature?.signedAt ? doc.signature.signedAt.toISOString() : null,
      signedDocumentFileId: idOrNull(doc.signature?.signedDocumentFileId),
      errorMessage: doc.signature?.errorMessage ?? '',
    },
    notes: doc.notes ?? '',
    parentProposalId: idOrNull(doc.parentProposalId),
    lastEmailDelivery: {
      status: doc.lastEmailDelivery?.status ?? '',
      message: doc.lastEmailDelivery?.message ?? '',
      at: doc.lastEmailDelivery?.at ? doc.lastEmailDelivery.at.toISOString() : null,
    },
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function notFound(): AppError {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'Proposal not found.' });
}

function locked(): AppError {
  return new AppError({
    status: 409,
    code: 'PROPOSAL_LOCKED',
    message: 'Only draft proposals can be edited. Duplicate to create a new version.',
  });
}

async function nextProposalNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counter = await ProposalCounterModel.findByIdAndUpdate(
    `proposal-${year}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const seq = String(counter?.seq ?? 1).padStart(4, '0');
  return `PROP-${year}-${seq}`;
}

async function findInScope(id: string, auth: AuthContext): Promise<ProposalDocument> {
  const scope = await customerOrInspectionScopeFilter(auth);
  const doc = mongoose.isValidObjectId(id)
    ? await ProposalModel.findOne({ _id: id, ...scope })
    : null;
  if (!doc) throw notFound();
  return doc;
}

export async function listProposals(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  status?: ProposalStatus;
  customerId?: string;
  estimateId?: string;
  search?: string;
}): Promise<{ data: ProposalDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const scope = await customerOrInspectionScopeFilter(input.auth);
  const filter: Record<string, unknown> = { ...scope };
  if (input.status) filter.status = input.status;
  if (input.customerId) filter.customerId = input.customerId;
  if (input.estimateId) filter.estimateId = input.estimateId;
  if (input.search?.trim()) {
    const q = escapeRegex(input.search.trim());
    filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { number: { $regex: q, $options: 'i' } }];
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    ProposalModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ProposalModel.countDocuments(filter),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getProposal(id: string, auth: AuthContext): Promise<ProposalDto> {
  return toDto(await findInScope(id, auth));
}

export async function createProposalFromEstimate(input: {
  auth: AuthContext;
  estimateId: string;
  termsAndConditions?: string;
  paymentSchedule?: Array<{ label: string; percentBps?: number; amountCents?: number }>;
  expirationDate?: string;
  notes?: string;
  requestId?: string;
  ip?: string;
}): Promise<ProposalDto> {
  const estimate = await getEstimate(input.estimateId, input.auth);
  await assertEstimatePublishable(estimate.id);
  const number = await nextProposalNumber();
  const created = await ProposalModel.create({
    number,
    customerId: estimate.customerId,
    propertyId: estimate.propertyId,
    estimateId: estimate.id,
    version: 1,
    status: 'draft',
    lineItems: estimate.lineItems,
    discountCents: estimate.discountCents,
    taxRateBps: estimate.taxRateBps,
    taxCents: estimate.taxCents,
    subtotalCents: estimate.subtotalCents,
    totalCents: estimate.totalCents,
    termsAndConditions: input.termsAndConditions ?? '',
    paymentSchedule: input.paymentSchedule ?? [],
    expirationDate: input.expirationDate ? new Date(input.expirationDate) : undefined,
    notes: input.notes ?? '',
    signature: { status: 'not_requested', provider: 'none' },
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'proposal.created',
    entityType: 'proposal',
    entityId: created._id.toString(),
    changes: { estimateId: estimate.id, number },
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(created);
}

export async function updateProposal(input: {
  auth: AuthContext;
  id: string;
  patch: {
    termsAndConditions?: string;
    paymentSchedule?: Array<{ label: string; percentBps?: number; amountCents?: number }>;
    expirationDate?: string | null;
    notes?: string;
  };
  requestId?: string;
  ip?: string;
}): Promise<ProposalDto> {
  const doc = await findInScope(input.id, input.auth);
  if (doc.status !== 'draft') throw locked();
  if (input.patch.termsAndConditions !== undefined) {
    doc.termsAndConditions = input.patch.termsAndConditions;
  }
  if (input.patch.paymentSchedule !== undefined) {
    doc.set(
      'paymentSchedule',
      input.patch.paymentSchedule.map((s) => ({
        label: s.label,
        percentBps: s.percentBps,
        amountCents: s.amountCents,
      })),
    );
  }
  if (input.patch.expirationDate !== undefined) {
    doc.expirationDate = input.patch.expirationDate
      ? new Date(input.patch.expirationDate)
      : null;
  }
  if (input.patch.notes !== undefined) doc.notes = input.patch.notes;
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'proposal.updated',
    entityType: 'proposal',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(doc);
}

export async function sendProposal(input: {
  auth: AuthContext;
  id: string;
  recipientEmail?: string;
  requestId?: string;
  ip?: string;
}): Promise<{ proposal: ProposalDto; emailDelivery: string }> {
  const doc = await findInScope(input.id, input.auth);
  if (doc.status !== 'draft' && doc.status !== 'sent') {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Only draft or sent proposals can be (re)sent.',
    });
  }
  doc.status = 'sent';
  let emailDelivery = 'not_configured';
  try {
    const customer = await CustomerModel.findById(doc.customerId);
    const to = input.recipientEmail || customer?.email;
    if (to) {
      const result = await sendEmail({
        to,
        subject: `Proposal ${doc.number}`,
        text: `Your proposal ${doc.number} is ready for review.`,
      });
      emailDelivery = result.status;
      doc.lastEmailDelivery = {
        status: result.status,
        message: result.message ?? '',
        at: new Date(),
      };
    } else {
      doc.lastEmailDelivery = {
        status: 'skipped',
        message: 'No recipient email available.',
        at: new Date(),
      };
      emailDelivery = 'skipped';
    }
  } catch (err) {
    getLog().error({ err, proposalId: doc._id.toString() }, 'Proposal email send failed');
    emailDelivery = 'failed';
  }
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'proposal.sent',
    entityType: 'proposal',
    entityId: doc._id.toString(),
    changes: { emailDelivery },
    requestId: input.requestId,
    ip: input.ip,
  });
  return { proposal: toDto(doc), emailDelivery };
}

export async function acceptProposal(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<ProposalDto> {
  const doc = await findInScope(input.id, input.auth);
  if (!['sent', 'viewed', 'draft'].includes(doc.status)) {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Proposal cannot be accepted in its current status.',
    });
  }
  doc.status = 'accepted';
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'proposal.accepted',
    entityType: 'proposal',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(doc);
}

export async function rejectProposal(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<ProposalDto> {
  const doc = await findInScope(input.id, input.auth);
  if (!['sent', 'viewed', 'draft'].includes(doc.status)) {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Proposal cannot be rejected in its current status.',
    });
  }
  doc.status = 'rejected';
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'proposal.rejected',
    entityType: 'proposal',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(doc);
}

export async function requestSignature(input: {
  auth: AuthContext;
  id: string;
  recipientEmail: string;
  recipientName?: string;
  requestId?: string;
  ip?: string;
}): Promise<ProposalDto> {
  const doc = await findInScope(input.id, input.auth);
  const result = await createSignatureRequest({
    proposalId: doc._id.toString(),
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
  });
  doc.signature = {
    status: 'not_configured',
    provider: 'none',
    providerRef: '',
    signedAt: null,
    signedDocumentFileId: undefined,
    errorMessage: result.message,
  };
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'proposal.signature_requested',
    entityType: 'proposal',
    entityId: doc._id.toString(),
    changes: { status: 'not_configured' },
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(doc);
}

export async function duplicateProposal(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<ProposalDto> {
  const source = await findInScope(input.id, input.auth);
  const number = await nextProposalNumber();
  const created = await ProposalModel.create({
    number,
    customerId: source.customerId,
    propertyId: source.propertyId,
    estimateId: source.estimateId,
    version: source.version + 1,
    status: 'draft',
    lineItems: source.lineItems,
    discountCents: source.discountCents,
    taxRateBps: source.taxRateBps,
    taxCents: source.taxCents,
    subtotalCents: source.subtotalCents,
    totalCents: source.totalCents,
    termsAndConditions: source.termsAndConditions,
    paymentSchedule: source.paymentSchedule,
    expirationDate: source.expirationDate,
    notes: source.notes,
    parentProposalId: source._id,
    signature: { status: 'not_requested', provider: 'none' },
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'proposal.duplicated',
    entityType: 'proposal',
    entityId: created._id.toString(),
    changes: { from: source._id.toString() },
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(created);
}

export async function previewProposalHtml(id: string, auth: AuthContext): Promise<string> {
  const proposal = await getProposal(id, auth);
  const [customer, property, settings] = await Promise.all([
    CustomerModel.findById(proposal.customerId),
    PropertyModel.findById(proposal.propertyId),
    ensureCompanySettings(),
  ]);
  const customerLabel =
    customer?.companyName ||
    `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim() ||
    proposal.customerId;
  const propertyLabel = property
    ? `${property.address.line1}, ${property.address.city} ${property.address.zip}`
    : proposal.propertyId;
  return renderProposalHtml({
    companyName: settings.displayName || settings.legalName || 'Legacy Construction Group LLC',
    proposal,
    customerLabel,
    propertyLabel,
  });
}

export function signatureIntegrationStatus() {
  return { providers: getSignatureProvidersStatus() };
}
