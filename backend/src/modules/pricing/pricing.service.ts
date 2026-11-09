import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { ensureDefaultCompany } from '../companies/company.service.js';
import { CustomerModel } from '../customers/customer.model.js';
import { UserModel } from '../users/user.model.js';
import { EstimateModel } from '../estimates/estimate.model.js';
import { MeasurementModel } from '../measurements/measurement.model.js';
import { createEstimate, getEstimate, type EstimateDto } from '../estimates/estimate.service.js';
import { CUSTOMER_CATALOG_SEED, PACKAGE_KEYS, SUBCONTRACTOR_RATE_CARD_SEED, type PackageKey } from './default-catalogs.js';
import {
  EstimateCostSheetModel,
  PriceCatalogModel,
  SubcontractorRateCardModel,
  type CostSheetDocument,
  type PriceCatalogDocument,
  type RateCardDocument,
} from './pricing.model.js';
import { computeQuote, type Quote, type QuoteCatalog, type QuoteInput } from './quote-engine.js';

export type PricingCtx = { userId: string; companyId: string; role: Role; permissions: readonly string[] };

const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);
const valid = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);
const notFound = (what: string): AppError => new AppError({ status: 404, code: 'NOT_FOUND', message: `${what} not found.` });
const invalid = (message: string, details?: Array<{ path: string; message: string }>): AppError =>
  new AppError({ status: 422, code: 'VALIDATION_ERROR', message, details });
const can = (ctx: PricingCtx, p: string): boolean => ctx.permissions.includes(p);

/** Existing estimates/customers do not carry companyId yet; their company is that of the customer's owner. */
async function assertCustomerInCompany(ctx: PricingCtx, customerId: string): Promise<void> {
  const c = await CustomerModel.findById(customerId).select({ ownerId: 1 }).lean();
  const owner = c ? await UserModel.findById(c.ownerId).select({ companyId: 1 }).lean() : null;
  const company = owner?.companyId ? owner.companyId.toString() : (await ensureDefaultCompany())._id.toString();
  if (!c || company !== ctx.companyId) throw notFound('Estimate');
}

// ---------------------------------------------------------------- customer catalogs

export type CatalogDto = {
  id: string;
  name: string;
  status: string;
  version: number;
  effectiveFrom: string | null;
  validityDays: number;
  source: string;
  sourceNote: string;
  packages: unknown[];
  items: unknown[];
  conditionalCharges: unknown[];
  taxRateBps: number | null;
  approvedAt: string | null;
  /** True for catalogs that must not be used on a proposal. */
  usableForProposals: boolean;
};

function toCatalogDto(d: PriceCatalogDocument): CatalogDto {
  return {
    id: d._id.toString(),
    name: d.name,
    status: d.status,
    version: d.version,
    effectiveFrom: d.effectiveFrom ? d.effectiveFrom.toISOString() : null,
    validityDays: d.validityDays,
    source: d.source ?? '',
    sourceNote: d.sourceNote ?? '',
    packages: d.packages,
    items: JSON.parse(JSON.stringify(d.items)) as unknown[],
    conditionalCharges: d.conditionalCharges,
    taxRateBps: d.taxRateBps ?? null,
    approvedAt: d.approvedAt ? d.approvedAt.toISOString() : null,
    usableForProposals: d.status === 'approved',
  };
}

async function findCatalog(ctx: PricingCtx, id: string): Promise<PriceCatalogDocument> {
  const d = valid(id) ? await PriceCatalogModel.findOne({ _id: id, companyId: oid(ctx.companyId) }) : null;
  if (!d) throw notFound('Price catalog');
  return d;
}

export async function listCatalogs(ctx: PricingCtx): Promise<CatalogDto[]> {
  const rows = await PriceCatalogModel.find({ companyId: oid(ctx.companyId) }).sort({ status: 1, version: -1 });
  return rows.map(toCatalogDto);
}

export async function getCatalog(ctx: PricingCtx, id: string): Promise<CatalogDto> {
  return toCatalogDto(await findCatalog(ctx, id));
}

/** Seeds the client's price sheet and subcontractor list for this company as DRAFT / UNAPPROVED. Idempotent. */
export async function installDefaults(ctx: PricingCtx): Promise<{ catalogCreated: boolean; rateCardCreated: boolean }> {
  let catalogCreated = false;
  let rateCardCreated = false;
  if (!(await PriceCatalogModel.exists({ companyId: oid(ctx.companyId) }))) {
    const s = CUSTOMER_CATALOG_SEED;
    await PriceCatalogModel.create({
      companyId: oid(ctx.companyId),
      name: s.name,
      status: 'draft',
      source: s.source,
      sourceNote: s.sourceNote,
      validityDays: s.validityDays,
      packages: s.packages,
      items: s.items,
      conditionalCharges: s.conditionalCharges,
      taxRateBps: null,
      createdBy: oid(ctx.userId),
    });
    catalogCreated = true;
  }
  if (!(await SubcontractorRateCardModel.exists({ companyId: oid(ctx.companyId) }))) {
    const s = SUBCONTRACTOR_RATE_CARD_SEED;
    await SubcontractorRateCardModel.create({
      companyId: oid(ctx.companyId),
      name: s.name,
      status: 'draft',
      source: s.source,
      inclusionsNote: s.inclusionsNote,
      rates: s.rates,
      createdBy: oid(ctx.userId),
    });
    rateCardCreated = true;
  }
  return { catalogCreated, rateCardCreated };
}

/**
 * Edits a draft in place. Editing an approved/retired catalog never changes it: a new draft version is
 * created (rate history), so estimates already issued from the old version keep their snapshot.
 */
export async function updateCatalog(
  ctx: PricingCtx,
  id: string,
  patch: { name?: string; validityDays?: number; taxRateBps?: number | null; effectiveFrom?: string | null; packages?: unknown[]; items?: unknown[]; conditionalCharges?: unknown[] },
  meta: { requestId?: string; ip?: string } = {},
): Promise<CatalogDto> {
  const d = await findCatalog(ctx, id);
  let target = d;
  if (d.status !== 'draft') {
    target = await PriceCatalogModel.create({
      companyId: d.companyId,
      name: d.name,
      kind: d.kind,
      status: 'draft',
      version: (await PriceCatalogModel.countDocuments({ companyId: d.companyId, kind: d.kind })) + 1,
      supersedes: d._id,
      validityDays: d.validityDays,
      source: d.source,
      sourceNote: d.sourceNote,
      packages: d.packages,
      items: JSON.parse(JSON.stringify(d.items)),
      conditionalCharges: d.conditionalCharges,
      taxRateBps: d.taxRateBps,
      createdBy: oid(ctx.userId),
    });
  }
  if (patch.name !== undefined) target.name = patch.name;
  if (patch.validityDays !== undefined) target.validityDays = patch.validityDays;
  if (patch.taxRateBps !== undefined) target.taxRateBps = patch.taxRateBps;
  if (patch.effectiveFrom !== undefined) target.effectiveFrom = patch.effectiveFrom ? new Date(patch.effectiveFrom) : undefined;
  if (patch.packages) target.packages = patch.packages as never;
  if (patch.items) {
    for (const it of patch.items as Array<{ rates?: Record<string, unknown> }>) {
      for (const k of PACKAGE_KEYS) {
        const v = it.rates?.[k];
        if (v !== null && v !== undefined && (!Number.isSafeInteger(v) || (v as number) < 0)) throw invalid('Rates must be whole cents.', [{ path: 'items.rates', message: 'Invalid rate' }]);
      }
    }
    target.items = patch.items as never;
  }
  if (patch.conditionalCharges) target.conditionalCharges = patch.conditionalCharges as never;
  await target.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'price_catalog.updated', entityType: 'price_catalog', entityId: target._id.toString(), changes: { fields: Object.keys(patch), newVersion: target._id.toString() !== d._id.toString() }, requestId: meta.requestId, ip: meta.ip });
  return toCatalogDto(target);
}

/** Only `pricing:approve` may approve. Approving retires the previously approved catalog of the same kind. */
export async function approveCatalog(ctx: PricingCtx, id: string, meta: { requestId?: string; ip?: string } = {}): Promise<CatalogDto> {
  const d = await findCatalog(ctx, id);
  if (d.status === 'approved') return toCatalogDto(d);
  if (d.status === 'retired') throw new AppError({ status: 409, code: 'CATALOG_RETIRED', message: 'Retired catalogs cannot be approved; edit to create a new draft.' });
  await PriceCatalogModel.updateMany({ companyId: d.companyId, kind: d.kind, status: 'approved' }, { $set: { status: 'retired' } });
  d.status = 'approved';
  d.approvedBy = oid(ctx.userId);
  d.approvedAt = new Date();
  d.effectiveFrom ??= new Date();
  await d.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'price_catalog.approved', entityType: 'price_catalog', entityId: d._id.toString(), changes: { version: d.version }, requestId: meta.requestId, ip: meta.ip });
  return toCatalogDto(d);
}

function asQuoteCatalog(d: PriceCatalogDocument): QuoteCatalog {
  return {
    items: JSON.parse(JSON.stringify(d.items)) as QuoteCatalog['items'],
    conditionalCharges: d.conditionalCharges as QuoteCatalog['conditionalCharges'],
    packages: (d.packages as Array<{ key: PackageKey; name: string; perSquareLowCents: number; perSquareHighCents: number }>).map((p) => ({ key: p.key, name: p.name, perSquareLowCents: p.perSquareLowCents, perSquareHighCents: p.perSquareHighCents })),
  };
}

function runQuote(d: PriceCatalogDocument, input: QuoteInput): Quote {
  try {
    return computeQuote(asQuoteCatalog(d), { ...input, taxRateBps: input.taxRateBps ?? d.taxRateBps ?? undefined });
  } catch (err) {
    throw invalid((err as Error).message);
  }
}

export type QuoteResult = Quote & { catalog: { id: string; version: number; status: string; usableForProposals: boolean }; validUntil: string; draftWarning?: string };

export async function quote(ctx: PricingCtx, catalogId: string, input: QuoteInput): Promise<QuoteResult> {
  const d = await findCatalog(ctx, catalogId);
  const q = runQuote(d, input);
  return {
    ...q,
    catalog: { id: d._id.toString(), version: d.version, status: d.status, usableForProposals: d.status === 'approved' },
    validUntil: new Date(Date.now() + d.validityDays * 86_400_000).toISOString(),
    ...(d.status === 'approved' ? {} : { draftWarning: 'This catalog is not approved. Estimates made from it cannot be turned into proposals.' }),
  };
}

/** Creates a normal estimate from the quote. The line items ARE the price snapshot; later catalog edits never change them. */
export async function createEstimateFromQuote(
  ctx: PricingCtx,
  input: { catalogId: string; customerId: string; propertyId: string; inspectionId?: string; measurementId?: string; leadId?: string; notes?: string; quote: QuoteInput; requestId?: string; ip?: string },
): Promise<{ estimate: EstimateDto; quote: QuoteResult }> {
  const d = await findCatalog(ctx, input.catalogId);
  await assertCustomerInCompany(ctx, input.customerId);
  const q = runQuote(d, input.quote);
  const validUntil = new Date(Date.now() + d.validityDays * 86_400_000);
  const estimate = await createEstimate({
    auth: { userId: ctx.userId, role: ctx.role },
    customerId: input.customerId,
    propertyId: input.propertyId,
    inspectionId: input.inspectionId,
    measurementId: input.measurementId,
    leadId: input.leadId,
    lineItems: q.lines.map((l) => ({ description: l.included ? `${l.description} (included)` : l.description, kind: l.kind, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents, laborCostCents: 0, materialCostCents: 0 })),
    discountCents: q.discountCents,
    taxRateBps: q.taxRateBps ?? 0,
    notes: [input.notes, `Package: ${q.package.toUpperCase()} · Price range for ${input.quote.squares} SQ: $${(q.rangeLowCents / 100).toLocaleString('en-US')}–$${(q.rangeHighCents / 100).toLocaleString('en-US')} (range, not a guaranteed total).`].filter(Boolean).join('\n'),
    validUntil: validUntil.toISOString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  // Record exactly which measurement (and revision) the quantities came from, so a later re-measure never silently changes this estimate.
  const m = input.measurementId && valid(input.measurementId) ? await MeasurementModel.findById(input.measurementId) : null;
  const measurement = m
    ? {
        id: m._id.toString(), revision: m.revision ?? 1, source: m.source, provider: m.provider, isDemo: Boolean(m.isDemo),
        totalArea: m.totalArea ?? null, units: m.units, pitch: m.pitch || null,
        verified: Boolean((m.verified as Record<string, boolean> | undefined)?.totalArea),
        areaSource: ((m.fieldSources as Record<string, string> | undefined)?.totalArea) ?? 'manual',
        snapshotAt: new Date().toISOString(),
      }
    : null;
  const pricingSource = {
    ...(measurement ? { measurement } : {}),
    catalogId: d._id.toString(),
    catalogVersion: d.version,
    catalogStatus: d.status,
    package: q.package,
    inputs: input.quote,
    priceValidUntil: validUntil.toISOString(),
    snapshotAt: new Date().toISOString(),
  };
  await EstimateModel.updateOne({ _id: estimate.id }, { $set: { pricingSource } });
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'estimate.priced_from_catalog', entityType: 'estimate', entityId: estimate.id, changes: { catalogId: pricingSource.catalogId, version: d.version, status: d.status, package: q.package }, requestId: input.requestId, ip: input.ip });
  return { estimate, quote: { ...q, catalog: { id: d._id.toString(), version: d.version, status: d.status, usableForProposals: d.status === 'approved' }, validUntil: validUntil.toISOString() } };
}

/** Called before a proposal is created: draft pricing and expired quotes cannot be published to a customer. */
export async function assertEstimatePublishable(estimateId: string): Promise<void> {
  const e = await EstimateModel.findById(estimateId).select({ pricingSource: 1 }).lean();
  const src = (e as { pricingSource?: { catalogStatus?: string; priceValidUntil?: string } } | null)?.pricingSource;
  if (!src) return; // manually priced estimate
  if (src.catalogStatus !== 'approved') {
    throw new AppError({ status: 409, code: 'PRICING_NOT_APPROVED', message: 'This estimate was priced from an unapproved (draft) price catalog and cannot be turned into a proposal. Ask an administrator to approve the catalog, then re-price the estimate.' });
  }
  if (src.priceValidUntil && new Date(src.priceValidUntil).getTime() < Date.now()) {
    throw new AppError({ status: 409, code: 'PRICE_EXPIRED', message: 'The price validity period for this estimate has expired. Re-price it before creating a proposal.' });
  }
}

// ---------------------------------------------------------------- subcontractor rate cards (INTERNAL)

export type RateCardDto = {
  id: string;
  name: string;
  status: string;
  version: number;
  subcontractorId: string | null;
  source: string;
  inclusionsNote: string;
  rates: unknown[];
  approvedAt: string | null;
};

const toRateCardDto = (d: RateCardDocument): RateCardDto => ({
  id: d._id.toString(),
  name: d.name,
  status: d.status,
  version: d.version,
  subcontractorId: d.subcontractorId ? d.subcontractorId.toString() : null,
  source: d.source ?? '',
  inclusionsNote: d.inclusionsNote ?? '',
  rates: JSON.parse(JSON.stringify(d.rates)) as unknown[],
  approvedAt: d.approvedAt ? d.approvedAt.toISOString() : null,
});

async function findRateCard(ctx: PricingCtx, id: string): Promise<RateCardDocument> {
  const d = valid(id) ? await SubcontractorRateCardModel.findOne({ _id: id, companyId: oid(ctx.companyId) }) : null;
  if (!d) throw notFound('Rate card');
  return d;
}

export async function listRateCards(ctx: PricingCtx): Promise<RateCardDto[]> {
  return (await SubcontractorRateCardModel.find({ companyId: oid(ctx.companyId) }).sort({ status: 1, version: -1 })).map(toRateCardDto);
}
export async function getRateCard(ctx: PricingCtx, id: string): Promise<RateCardDto> {
  return toRateCardDto(await findRateCard(ctx, id));
}

export async function createRateCard(ctx: PricingCtx, input: { name: string; subcontractorId?: string; rates: unknown[]; inclusionsNote?: string; source?: string }): Promise<RateCardDto> {
  const d = await SubcontractorRateCardModel.create({
    companyId: oid(ctx.companyId),
    name: input.name,
    subcontractorId: input.subcontractorId ? oid(input.subcontractorId) : null,
    inclusionsNote: input.inclusionsNote ?? '',
    source: input.source ?? '',
    rates: input.rates,
    createdBy: oid(ctx.userId),
  });
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'rate_card.created', entityType: 'rate_card', entityId: d._id.toString() });
  return toRateCardDto(d);
}

/** Same rule as customer catalogs: approved cards are immutable, edits create the next draft version (rate history). */
export async function updateRateCard(ctx: PricingCtx, id: string, patch: { name?: string; rates?: unknown[]; inclusionsNote?: string; effectiveFrom?: string | null }, meta: { requestId?: string; ip?: string } = {}): Promise<RateCardDto> {
  const d = await findRateCard(ctx, id);
  let target = d;
  if (d.status !== 'draft') {
    target = await SubcontractorRateCardModel.create({
      companyId: d.companyId, subcontractorId: d.subcontractorId, name: d.name, status: 'draft', source: d.source, inclusionsNote: d.inclusionsNote,
      version: (await SubcontractorRateCardModel.countDocuments({ companyId: d.companyId, name: d.name })) + 1,
      supersedes: d._id, rates: JSON.parse(JSON.stringify(d.rates)), createdBy: oid(ctx.userId),
    });
  }
  if (patch.name !== undefined) target.name = patch.name;
  if (patch.inclusionsNote !== undefined) target.inclusionsNote = patch.inclusionsNote;
  if (patch.effectiveFrom !== undefined) target.effectiveFrom = patch.effectiveFrom ? new Date(patch.effectiveFrom) : undefined;
  if (patch.rates) target.rates = patch.rates as never;
  await target.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'rate_card.updated', entityType: 'rate_card', entityId: target._id.toString(), changes: { fields: Object.keys(patch), newVersion: target._id.toString() !== d._id.toString() }, requestId: meta.requestId, ip: meta.ip });
  return toRateCardDto(target);
}

export async function approveRateCard(ctx: PricingCtx, id: string, meta: { requestId?: string; ip?: string } = {}): Promise<RateCardDto> {
  const d = await findRateCard(ctx, id);
  if (d.status === 'approved') return toRateCardDto(d);
  if (d.status === 'retired') throw new AppError({ status: 409, code: 'CATALOG_RETIRED', message: 'Retired rate cards cannot be approved.' });
  await SubcontractorRateCardModel.updateMany({ companyId: d.companyId, name: d.name, subcontractorId: d.subcontractorId ?? null, status: 'approved' }, { $set: { status: 'retired' } });
  d.status = 'approved';
  d.approvedBy = oid(ctx.userId);
  d.approvedAt = new Date();
  d.effectiveFrom ??= new Date();
  await d.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'rate_card.approved', entityType: 'rate_card', entityId: d._id.toString(), requestId: meta.requestId, ip: meta.ip });
  return toRateCardDto(d);
}

// ---------------------------------------------------------------- estimate cost sheets and margin

export type CostLineInput = {
  id?: string;
  kind: 'subcontractor' | 'material' | 'other';
  description?: string;
  unit?: string;
  quantity: number;
  unitCostCents?: number;
  subcontractorId?: string;
  rateCardId?: string;
  rateKey?: string;
  overridden?: boolean;
  overrideReason?: string;
};

export type CostSheetDto = {
  estimateId: string;
  lines: Array<CostLineInput & { id: string; description: string; unit: string; unitCostCents: number; totalCents: number }>;
  materialCostCents: number;
  subcontractorCostCents: number;
  otherCostCents: number;
  totalCostCents: number;
  /** Present only for users with margins:view. */
  sellingPriceCents?: number;
  grossProfitCents?: number;
  marginBps?: number | null;
};

/** Gross margin = profit / selling price (never markup). Basis points, rounded half-up. */
export function grossMarginBps(sellingCents: number, costCents: number): number | null {
  if (sellingCents <= 0) return null;
  return Math.round(((sellingCents - costCents) * 10_000) / sellingCents);
}

function toCostSheetDto(ctx: PricingCtx, d: CostSheetDocument | null, estimateId: string, selling: number): CostSheetDto {
  const base: CostSheetDto = {
    estimateId,
    lines: d ? (JSON.parse(JSON.stringify(d.lines)) as CostSheetDto['lines']) : [],
    materialCostCents: d?.materialCostCents ?? 0,
    subcontractorCostCents: d?.subcontractorCostCents ?? 0,
    otherCostCents: d?.otherCostCents ?? 0,
    totalCostCents: d?.totalCostCents ?? 0,
  };
  if (can(ctx, 'margins:view')) {
    base.sellingPriceCents = selling;
    base.grossProfitCents = selling - base.totalCostCents;
    base.marginBps = grossMarginBps(selling, base.totalCostCents);
  }
  return base;
}

const sellingPrice = (e: EstimateDto): number => e.subtotalCents - e.discountCents;

export async function getCostSheet(ctx: PricingCtx, estimateId: string): Promise<CostSheetDto> {
  const e = await getEstimate(estimateId, { userId: ctx.userId, role: ctx.role });
  await assertCustomerInCompany(ctx, e.customerId);
  const d = await EstimateCostSheetModel.findOne({ companyId: oid(ctx.companyId), estimateId: oid(estimateId) });
  return toCostSheetDto(ctx, d, estimateId, sellingPrice(e));
}

export async function saveCostSheet(ctx: PricingCtx, estimateId: string, lines: CostLineInput[], meta: { requestId?: string; ip?: string } = {}): Promise<CostSheetDto> {
  const e = await getEstimate(estimateId, { userId: ctx.userId, role: ctx.role });
  await assertCustomerInCompany(ctx, e.customerId);
  const resolved: Array<CostSheetDto['lines'][number]> = [];
  const overrides: Array<{ rateKey: string; from: number; to: number; reason: string }> = [];
  for (const [i, l] of lines.entries()) {
    let unitCost = l.unitCostCents;
    let description = l.description?.trim() ?? '';
    let unit = l.unit?.trim() ?? '';
    let overridden = false;
    if (l.rateCardId && l.rateKey) {
      const card = await findRateCard(ctx, l.rateCardId);
      const rate = (card.rates as Array<{ key: string; name: string; unit: string; rateCents: number | null; minCents?: number | null; maxCents?: number | null }>).find((r) => r.key === l.rateKey);
      if (!rate) throw invalid('Unknown rate on this rate card.', [{ path: `lines.${i}.rateKey`, message: 'Unknown rate' }]);
      description ||= rate.name;
      unit ||= rate.unit;
      if (rate.rateCents !== null && rate.rateCents !== undefined) {
        if (unitCost === undefined || unitCost === rate.rateCents) {
          unitCost = rate.rateCents;
        } else {
          // Project-specific override of a catalog rate: needs a reason and cost-management permission, and is audited.
          if (!l.overridden || !l.overrideReason || l.overrideReason.trim().length < 5) {
            throw invalid('Changing a catalog rate needs overridden=true and a reason (at least 5 characters).', [{ path: `lines.${i}.unitCostCents`, message: 'Override reason required' }]);
          }
          overridden = true;
          overrides.push({ rateKey: rate.key, from: rate.rateCents, to: unitCost, reason: l.overrideReason.trim() });
        }
      } else {
        // Source gives a range: the entered cost must be inside it.
        if (unitCost === undefined) throw invalid('This rate is a range; enter the agreed cost.', [{ path: `lines.${i}.unitCostCents`, message: 'Required' }]);
        const min = rate.minCents ?? 0;
        const max = rate.maxCents ?? Number.MAX_SAFE_INTEGER;
        if (unitCost < min || unitCost > max) throw invalid(`Cost must be between ${min} and ${max} cents for this rate.`, [{ path: `lines.${i}.unitCostCents`, message: 'Outside range' }]);
      }
    }
    if (unitCost === undefined || !Number.isSafeInteger(unitCost) || unitCost < 0) throw invalid('Unit cost must be whole cents.', [{ path: `lines.${i}.unitCostCents`, message: 'Invalid' }]);
    if (!description) throw invalid('Each cost line needs a description.', [{ path: `lines.${i}.description`, message: 'Required' }]);
    resolved.push({
      id: l.id ?? `c${i + 1}`,
      kind: l.kind,
      description,
      unit: unit || 'ea',
      quantity: l.quantity,
      unitCostCents: unitCost,
      totalCents: Math.round(l.quantity * unitCost),
      subcontractorId: l.subcontractorId,
      rateCardId: l.rateCardId,
      rateKey: l.rateKey,
      overridden: overridden || undefined,
      overrideReason: overridden ? l.overrideReason?.trim() : undefined,
    });
  }
  const sum = (k: CostLineInput['kind']): number => resolved.filter((r) => r.kind === k).reduce((s, r) => s + r.totalCents, 0);
  const material = sum('material');
  const sub = sum('subcontractor');
  const other = sum('other');
  const total = material + sub + other;
  const selling = sellingPrice(e);
  const doc = await EstimateCostSheetModel.findOneAndUpdate(
    { companyId: oid(ctx.companyId), estimateId: oid(estimateId) },
    {
      $set: {
        lines: resolved.map((r) => ({ ...r, subcontractorId: r.subcontractorId ? oid(r.subcontractorId) : undefined, rateCardId: r.rateCardId ? oid(r.rateCardId) : undefined })),
        materialCostCents: material, subcontractorCostCents: sub, otherCostCents: other, totalCostCents: total,
        sellingPriceCents: selling, grossProfitCents: selling - total, marginBps: grossMarginBps(selling, total), updatedBy: oid(ctx.userId),
      },
    },
    { upsert: true, new: true },
  );
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'estimate.costs_saved', entityType: 'estimate', entityId: estimateId, changes: { totalCostCents: total, lines: resolved.length }, requestId: meta.requestId, ip: meta.ip });
  for (const o of overrides) {
    await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'cost.rate_override', entityType: 'estimate', entityId: estimateId, changes: o, requestId: meta.requestId, ip: meta.ip });
  }
  return toCostSheetDto(ctx, doc, estimateId, selling);
}
