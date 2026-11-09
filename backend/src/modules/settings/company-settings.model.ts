import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const taxRateSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    rateBp: { type: Number, required: true },
    isDefault: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

export const LINE_ITEM_KINDS = ['material', 'labor', 'other'] as const;
export type LineItemKind = (typeof LINE_ITEM_KINDS)[number];

const standardLineItemSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true, default: 'ea' },
    unitCostCents: { type: Number, required: true, min: 0, default: 0 },
    kind: { type: String, enum: LINE_ITEM_KINDS, required: true, default: 'material' },
    active: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const companySettingsSchema = new Schema(
  {
    legalName: { type: String, required: true, default: 'Legacy Construction Group LLC' },
    displayName: { type: String, required: true, default: 'Legacy Construction Group LLC' },
    logoFileId: { type: String },
    address: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: 'TX' },
      zip: { type: String, default: '' },
    },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    website: { type: String, default: 'https://builtbylegacygroup.com/' },
    licenseText: { type: String, default: '' },
    timezone: { type: String, required: true, default: 'America/Chicago' },
    defaultWasteBp: { type: Number, required: true, default: 1000 },
    defaultMarginBp: { type: Number, required: true, default: 4000 },
    estimateExpiryDays: { type: Number, required: true, default: 30 },
    taxRates: { type: [taxRateSchema], default: [] },
    /** Estimate pricing config (Phase 4). Basis points, e.g. 825 = 8.25%. No default rate is assumed. */
    taxRateBps: { type: Number, required: true, default: 0, min: 0, max: 10000 },
    standardLineItems: { type: [standardLineItemSchema], default: [] },
    invoiceTermsText: { type: String, default: '' },
    proposalTermsText: { type: String, default: '' },
    invoiceAutoIssue: { type: Boolean, default: false },
    invoiceNumberPrefix: { type: String, default: 'INV' },
    leadAssignment: {
      strategy: { type: String, default: 'round_robin' },
      lastAssignedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
  },
  { timestamps: true },
);

export type CompanySettingsAttrs = InferSchemaType<typeof companySettingsSchema>;
export type CompanySettingsDocument = HydratedDocument<CompanySettingsAttrs>;

export const CompanySettingsModel = model(
  'CompanySettings',
  companySettingsSchema,
  'companySettings',
);
