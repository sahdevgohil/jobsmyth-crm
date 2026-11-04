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

const companySettingsSchema = new Schema(
  {
    legalName: { type: String, required: true, default: 'Legacy Construction Group' },
    displayName: { type: String, required: true, default: 'Legacy Construction Group' },
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
    invoiceTermsText: { type: String, default: '' },
    proposalTermsText: { type: String, default: '' },
    invoiceAutoIssue: { type: Boolean, default: false },
    invoiceNumberPrefix: { type: String, default: 'INV' },
    leadAssignment: {
      strategy: { type: String, default: 'round_robin' },
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
