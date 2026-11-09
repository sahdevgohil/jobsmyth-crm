import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const CATALOG_STATUSES = ['draft', 'approved', 'retired'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

const rates = new Schema({ good: Number, better: Number, best: Number }, { _id: false });

/** Customer selling-price catalog (Good / Better / Best). Approved catalogs are immutable; edits create a new draft version. */
const priceCatalogSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['roof_replacement'], default: 'roof_replacement' },
    status: { type: String, enum: CATALOG_STATUSES, default: 'draft' },
    version: { type: Number, default: 1 },
    supersedes: { type: Schema.Types.ObjectId, ref: 'PriceCatalog' },
    effectiveFrom: { type: Date },
    /** How long a quote from this catalog stays valid. */
    validityDays: { type: Number, default: 30, min: 1, max: 365 },
    source: { type: String, default: '' },
    sourceNote: { type: String, default: '' },
    packages: { type: [Schema.Types.Mixed], default: [] },
    items: {
      type: [
        new Schema(
          {
            key: { type: String, required: true },
            name: { type: String, required: true },
            unit: { type: String, required: true },
            basis: { type: String, required: true },
            kind: { type: String, enum: ['material', 'labor', 'other'], default: 'material' },
            rates: { type: rates, required: true },
            optional: { type: Boolean, default: false },
            wasteIncludedInRate: { type: Boolean, default: false },
            wasteApplies: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    conditionalCharges: { type: [Schema.Types.Mixed], default: [] },
    /** Tax is explicit; null = pending company/CPA confirmation (no rate is assumed). */
    taxRateBps: { type: Number, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
priceCatalogSchema.index({ companyId: 1, status: 1, kind: 1 });

const rateSchema = new Schema(
  {
    key: { type: String, required: true },
    category: { type: String, required: true },
    name: { type: String, required: true },
    unit: { type: String, required: true },
    rateCents: { type: Number, default: null, min: 0 },
    minCents: { type: Number, min: 0 },
    maxCents: { type: Number, min: 0 },
    notes: { type: String, default: '' },
    materialsIncluded: { type: Boolean, default: null },
  },
  { _id: false },
);

/** INTERNAL subcontractor cost rates. Never exposed to customers; readable only with `costs:view`. */
const rateCardSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    /** Specific subcontractor, or null for a company-wide default list. */
    subcontractorId: { type: Schema.Types.ObjectId, ref: 'Subcontractor', default: null },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: CATALOG_STATUSES, default: 'draft' },
    version: { type: Number, default: 1 },
    supersedes: { type: Schema.Types.ObjectId, ref: 'SubcontractorRateCard' },
    effectiveFrom: { type: Date },
    source: { type: String, default: '' },
    inclusionsNote: { type: String, default: '' },
    rates: { type: [rateSchema], default: [] },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
rateCardSchema.index({ companyId: 1, status: 1 });
rateCardSchema.index({ companyId: 1, subcontractorId: 1 });

const costLineSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: ['subcontractor', 'material', 'other'], required: true },
    description: { type: String, required: true, trim: true },
    unit: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitCostCents: { type: Number, required: true, min: 0 },
    totalCents: { type: Number, required: true, min: 0 },
    subcontractorId: { type: Schema.Types.ObjectId, ref: 'Subcontractor' },
    rateCardId: { type: Schema.Types.ObjectId, ref: 'SubcontractorRateCard' },
    rateKey: { type: String },
    overridden: { type: Boolean, default: false },
    overrideReason: { type: String, default: '' },
  },
  { _id: false },
);

/** Internal cost sheet for an estimate: kept in its own collection so it can never leak through estimate/proposal/portal APIs. */
const estimateCostSheetSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate', required: true },
    lines: { type: [costLineSchema], default: [] },
    materialCostCents: { type: Number, default: 0 },
    subcontractorCostCents: { type: Number, default: 0 },
    otherCostCents: { type: Number, default: 0 },
    totalCostCents: { type: Number, default: 0 },
    /** Revenue the margin is measured against: estimate subtotal minus discount (tax is a pass-through). */
    sellingPriceCents: { type: Number, default: 0 },
    grossProfitCents: { type: Number, default: 0 },
    /** Gross margin in basis points (profit / selling price). Not markup. */
    marginBps: { type: Number, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
estimateCostSheetSchema.index({ companyId: 1, estimateId: 1 }, { unique: true });

export type PriceCatalogDocument = HydratedDocument<InferSchemaType<typeof priceCatalogSchema> & { createdAt: Date; updatedAt: Date }>;
export type RateCardDocument = HydratedDocument<InferSchemaType<typeof rateCardSchema> & { createdAt: Date; updatedAt: Date }>;
export type CostSheetDocument = HydratedDocument<InferSchemaType<typeof estimateCostSheetSchema> & { createdAt: Date; updatedAt: Date }>;

export const PriceCatalogModel = model('PriceCatalog', priceCatalogSchema, 'priceCatalogs');
export const SubcontractorRateCardModel = model('SubcontractorRateCard', rateCardSchema, 'subcontractorRateCards');
export const EstimateCostSheetModel = model('EstimateCostSheet', estimateCostSheetSchema, 'estimateCostSheets');
