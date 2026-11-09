import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import {
  assertLeadLink,
  customerOrInspectionScopeFilter,
  resolveCustomerPropertyTarget,
  validationError,
  type AuthContext,
} from '../../services/entity-links.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { InspectionModel } from '../inspections/inspection.model.js';
import { inspectionScopeFilter } from '../inspections/inspection.service.js';
import { measurementScopeFilter } from '../measurements/measurement.service.js';
import { MeasurementModel } from '../measurements/measurement.model.js';
import type { LineItemKind } from '../settings/company-settings.model.js';
import { getPricingConfig } from '../settings/pricing.service.js';
import { ensureCompanySettings } from '../settings/settings.service.js';
import {
  assertClientTotalsMatch,
  recalcTotals,
  type CalculatedLineItem,
  type EstimateTotals,
  type LineItemInput,
} from './estimate.calc.js';
import {
  EstimateCounterModel,
  EstimateModel,
  type EstimateDocument,
  type EstimateStatus,
} from './estimate.model.js';
import { renderEstimateHtml } from './estimate.report.js';

export type { AuthContext };

let log: Logger | undefined;
function getLog(): Logger {
  if (!log) log = createLogger();
  return log;
}

export type EstimateLineItemDto = CalculatedLineItem;

export type EstimateDto = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string;
  inspectionId: string | null;
  measurementId: string | null;
  leadId: string | null;
  status: EstimateStatus;
  version: number;
  lineItems: EstimateLineItemDto[];
  discountCents: number;
  taxRateBps: number;
  taxCents: number;
  subtotalCents: number;
  totalCents: number;
  notes: string;
  validUntil: string | null;
  parentEstimateId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Line item as accepted from clients (amountCents is verified, never stored). */
export type LineItemBody = Omit<LineItemInput, 'id'> & { id?: string; amountCents?: number };

type ClientFigures = { subtotalCents?: number; taxCents?: number; totalCents?: number };

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDto(doc: EstimateDocument): EstimateDto {
  return {
    id: doc._id.toString(),
    number: doc.number,
    customerId: doc.customerId.toString(),
    propertyId: doc.propertyId.toString(),
    inspectionId: idOrNull(doc.inspectionId),
    measurementId: idOrNull(doc.measurementId),
    leadId: idOrNull(doc.leadId),
    status: doc.status as EstimateStatus,
    version: doc.version,
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
    notes: doc.notes ?? '',
    validUntil: doc.validUntil ? doc.validUntil.toISOString() : null,
    parentEstimateId: idOrNull(doc.parentEstimateId),
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function notFound(): AppError {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'Estimate not found.' });
}

/** Salesperson scope: customer owner, or estimate linked to an inspection assigned to them. */
export async function estimateScopeFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  return customerOrInspectionScopeFilter(auth);
}

async function findEstimateInScope(id: string, auth: AuthContext): Promise<EstimateDocument> {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const scope = await estimateScopeFilter(auth);
  const doc = await EstimateModel.findOne({ _id: id, ...scope });
  if (!doc) throw notFound();
  return doc;
}

async function auditBestEffort(input: {
  auth: AuthContext;
  action: string;
  id: string;
  changes?: unknown;
  requestId?: string;
  ip?: string;
}): Promise<void> {
  try {
    await recordAudit({
      actorType: 'user',
      actorId: input.auth.userId,
      action: input.action,
      entityType: 'estimate',
      entityId: input.id,
      changes: input.changes,
      requestId: input.requestId,
      ip: input.ip,
    });
  } catch (err) {
    getLog().error(
      { err, estimateId: input.id, action: input.action },
      'Estimate audit failed (best-effort)',
    );
  }
}

/** Sequential, concurrency-safe number: EST-YYYY-0001 (atomic per-year counter). */
async function nextEstimateNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counterId = `estimate:${year}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const counter = await EstimateCounterModel.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      );
      return `EST-${year}-${counter.seq.toString().padStart(4, '0')}`;
    } catch (err) {
      // Two concurrent first-upserts can race on the unique _id; retry once the doc exists.
      const dup = typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
      if (!dup || attempt >= 3) throw err;
    }
  }
}

function withIds(items: LineItemBody[]): LineItemInput[] {
  // amountCents is intentionally dropped: it is recomputed, never trusted.
  return items.map((item) => ({
    id: item.id ?? randomUUID(),
    description: item.description,
    kind: item.kind,
    quantity: item.quantity,
    unit: item.unit,
    unitCostCents: item.unitCostCents,
    laborCostCents: item.laborCostCents,
    materialCostCents: item.materialCostCents,
  }));
}

function compute(input: {
  lineItems: LineItemBody[];
  discountCents: number;
  taxRateBps: number;
  client: ClientFigures;
}): EstimateTotals {
  const totals = recalcTotals(withIds(input.lineItems), input.discountCents, input.taxRateBps);
  assertClientTotalsMatch(
    {
      ...input.client,
      lineAmounts: input.lineItems.map((item) => item.amountCents),
    },
    totals,
  );
  return totals;
}

function applyTotals(doc: EstimateDocument, totals: EstimateTotals): void {
  doc.set('lineItems', totals.lineItems);
  doc.discountCents = totals.discountCents;
  doc.taxRateBps = totals.taxRateBps;
  doc.subtotalCents = totals.subtotalCents;
  doc.taxCents = totals.taxCents;
  doc.totalCents = totals.totalCents;
}

async function assertMeasurementLink(
  auth: AuthContext,
  measurementId: string,
  propertyId: mongoose.Types.ObjectId,
): Promise<void> {
  const scope = await measurementScopeFilter(auth);
  const measurement = mongoose.isValidObjectId(measurementId)
    ? await MeasurementModel.findOne({ _id: measurementId, ...scope }).select({ propertyId: 1 })
    : null;
  if (!measurement) throw validationError('measurementId', 'Measurement not found');
  if (measurement.propertyId.toString() !== propertyId.toString()) {
    throw validationError('measurementId', 'Measurement belongs to a different property');
  }
}

async function assertInspectionLink(
  auth: AuthContext,
  inspectionId: string,
  propertyId: mongoose.Types.ObjectId,
): Promise<void> {
  const scope = await inspectionScopeFilter(auth);
  const inspection = mongoose.isValidObjectId(inspectionId)
    ? await InspectionModel.findOne({ _id: inspectionId, ...scope }).select({ propertyId: 1 })
    : null;
  if (!inspection) throw validationError('inspectionId', 'Inspection not found');
  if (inspection.propertyId.toString() !== propertyId.toString()) {
    throw validationError('inspectionId', 'Inspection belongs to a different property');
  }
}

export async function listEstimates(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  status?: string;
  customerId?: string;
  propertyId?: string;
  inspectionId?: string;
  measurementId?: string;
  leadId?: string;
}): Promise<{ data: EstimateDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const clauses: Record<string, unknown>[] = [];
  const scope = await estimateScopeFilter(input.auth);
  if (Object.keys(scope).length > 0) clauses.push(scope);
  if (input.status) clauses.push({ status: input.status });
  if (input.customerId) clauses.push({ customerId: input.customerId });
  if (input.propertyId) clauses.push({ propertyId: input.propertyId });
  if (input.inspectionId) clauses.push({ inspectionId: input.inspectionId });
  if (input.measurementId) clauses.push({ measurementId: input.measurementId });
  if (input.leadId) clauses.push({ leadId: input.leadId });

  const filter = clauses.length > 0 ? { $and: clauses } : {};
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    EstimateModel.countDocuments(filter),
    EstimateModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getEstimate(id: string, auth: AuthContext): Promise<EstimateDto> {
  return toDto(await findEstimateInScope(id, auth));
}

export async function createEstimate(input: {
  auth: AuthContext;
  customerId: string;
  propertyId: string;
  inspectionId?: string;
  measurementId?: string;
  leadId?: string;
  lineItems: LineItemBody[];
  discountCents: number;
  taxRateBps?: number;
  notes?: string;
  validUntil?: string;
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  requestId?: string;
  ip?: string;
}): Promise<EstimateDto> {
  const target = await resolveCustomerPropertyTarget(input.auth, {
    customerId: input.customerId,
    propertyId: input.propertyId,
    inspectionId: input.inspectionId,
  });
  if (input.measurementId) {
    await assertMeasurementLink(input.auth, input.measurementId, target.propertyId);
  }
  if (input.leadId) await assertLeadLink(input.auth, input.leadId);

  const settings = await ensureCompanySettings();
  const taxRateBps = input.taxRateBps ?? settings.taxRateBps ?? 0;
  const totals = compute({
    lineItems: input.lineItems,
    discountCents: input.discountCents,
    taxRateBps,
    client: input,
  });

  const number = await nextEstimateNumber();
  const doc = new EstimateModel({
    number,
    customerId: target.customerId,
    propertyId: target.propertyId,
    inspectionId: target.inspection?._id,
    measurementId: input.measurementId,
    leadId: input.leadId,
    status: 'draft',
    version: 1,
    notes: input.notes ?? '',
    validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    createdBy: input.auth.userId,
  });
  applyTotals(doc, totals);
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: 'estimate.create',
    id: doc._id.toString(),
    changes: {
      number,
      customerId: input.customerId,
      propertyId: input.propertyId,
      totalCents: totals.totalCents,
    },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function updateEstimate(input: {
  auth: AuthContext;
  id: string;
  patch: {
    inspectionId?: string | null;
    measurementId?: string | null;
    leadId?: string | null;
    lineItems?: LineItemBody[];
    discountCents?: number;
    taxRateBps?: number;
    notes?: string;
    validUntil?: string | null;
    status?: 'sent';
    subtotalCents?: number;
    taxCents?: number;
    totalCents?: number;
  };
  requestId?: string;
  ip?: string;
}): Promise<EstimateDto> {
  const doc = await findEstimateInScope(input.id, input.auth);
  const { patch } = input;

  if (doc.status !== 'draft') {
    throw new AppError({
      status: 409,
      code: 'ESTIMATE_LOCKED',
      message: `Only draft estimates can be edited. This estimate is ${doc.status}.`,
    });
  }

  if (patch.inspectionId) await assertInspectionLink(input.auth, patch.inspectionId, doc.propertyId);
  if (patch.measurementId) {
    await assertMeasurementLink(input.auth, patch.measurementId, doc.propertyId);
  }
  if (patch.leadId) await assertLeadLink(input.auth, patch.leadId);

  const existingItems: LineItemBody[] = doc.lineItems.map((item) => ({
    id: item.id,
    description: item.description,
    kind: item.kind as LineItemKind,
    quantity: item.quantity,
    unit: item.unit,
    unitCostCents: item.unitCostCents,
    laborCostCents: item.laborCostCents,
    materialCostCents: item.materialCostCents,
  }));
  const totals = compute({
    lineItems: patch.lineItems ?? existingItems,
    discountCents: patch.discountCents ?? doc.discountCents,
    taxRateBps: patch.taxRateBps ?? doc.taxRateBps,
    client: patch,
  });
  applyTotals(doc, totals);

  if (patch.inspectionId !== undefined) {
    doc.set('inspectionId', patch.inspectionId ?? undefined);
  }
  if (patch.measurementId !== undefined) {
    doc.set('measurementId', patch.measurementId ?? undefined);
  }
  if (patch.leadId !== undefined) doc.set('leadId', patch.leadId ?? undefined);
  if (patch.notes !== undefined) doc.notes = patch.notes;
  if (patch.validUntil !== undefined) {
    doc.set('validUntil', patch.validUntil ? new Date(patch.validUntil) : undefined);
  }
  if (patch.status === 'sent') doc.status = 'sent';
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: patch.status === 'sent' ? 'estimate.send' : 'estimate.update',
    id: doc._id.toString(),
    changes: { ...patch, totalCents: totals.totalCents },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

/**
 * Creates a new draft estimate from an existing one.
 * `version`: same lineage, version = source.version + 1. `copy`: restarts at version 1.
 * Either way the new estimate gets its own number and links back via parentEstimateId.
 */
export async function duplicateEstimate(input: {
  auth: AuthContext;
  id: string;
  mode: 'version' | 'copy';
  requestId?: string;
  ip?: string;
}): Promise<EstimateDto> {
  const source = await findEstimateInScope(input.id, input.auth);
  const totals = recalcTotals(
    source.lineItems.map((item) => ({
      id: randomUUID(),
      description: item.description,
      kind: item.kind as LineItemKind,
      quantity: item.quantity,
      unit: item.unit,
      unitCostCents: item.unitCostCents,
      laborCostCents: item.laborCostCents,
      materialCostCents: item.materialCostCents,
    })),
    source.discountCents,
    source.taxRateBps,
  );

  const number = await nextEstimateNumber();
  const doc = new EstimateModel({
    number,
    customerId: source.customerId,
    propertyId: source.propertyId,
    inspectionId: source.inspectionId,
    measurementId: source.measurementId,
    leadId: source.leadId,
    status: 'draft',
    version: input.mode === 'version' ? source.version + 1 : 1,
    notes: source.notes ?? '',
    parentEstimateId: source._id,
    createdBy: input.auth.userId,
  });
  applyTotals(doc, totals);
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: 'estimate.duplicate',
    id: doc._id.toString(),
    changes: { sourceId: source._id.toString(), mode: input.mode, number },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function voidEstimate(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<EstimateDto> {
  const doc = await findEstimateInScope(input.id, input.auth);
  if (doc.status === 'void') {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Estimate is already void.',
    });
  }
  const previousStatus = doc.status;
  doc.status = 'void';
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: 'estimate.void',
    id: doc._id.toString(),
    changes: { previousStatus },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

/** Active standard line items + default tax rate, readable by anyone who can build estimates. */
export async function getEstimateCatalog(): Promise<{
  taxRateBps: number;
  standardLineItems: Awaited<ReturnType<typeof getPricingConfig>>['standardLineItems'];
}> {
  const config = await getPricingConfig();
  return {
    taxRateBps: config.taxRateBps,
    standardLineItems: config.standardLineItems.filter((item) => item.active),
  };
}

/** Printable HTML estimate. Backend-calculated figures only. */
export async function getEstimatePreviewHtml(id: string, auth: AuthContext): Promise<string> {
  const doc = await findEstimateInScope(id, auth);
  const [settings, customer, property] = await Promise.all([
    ensureCompanySettings(),
    CustomerModel.findById(doc.customerId),
    PropertyModel.findById(doc.propertyId),
  ]);

  const customerName = customer
    ? customer.type === 'business'
      ? customer.companyName || `${customer.firstName} ${customer.lastName}`.trim()
      : `${customer.firstName} ${customer.lastName}`.trim() || customer.companyName
    : '';

  return renderEstimateHtml({
    company: {
      name: settings.displayName,
      phone: settings.phone ?? '',
      email: settings.email ?? '',
      website: settings.website ?? '',
      licenseText: settings.licenseText ?? '',
      termsText: settings.proposalTermsText ?? '',
      timeZone: settings.timezone,
    },
    estimate: toDto(doc),
    customer: {
      name: customerName ?? '',
      email: customer?.email ?? '',
      phone: customer?.phone ?? '',
    },
    propertyAddress: property
      ? {
          line1: property.address.line1,
          line2: property.address.line2 ?? '',
          city: property.address.city ?? '',
          state: property.address.state ?? '',
          zip: property.address.zip,
        }
      : null,
  });
}
