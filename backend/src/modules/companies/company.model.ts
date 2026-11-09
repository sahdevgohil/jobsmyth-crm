import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const brandingSchema = new Schema(
  {
    displayName: { type: String, default: '' },
    /** Key of a bundled logo asset ('legacy-default') or an uploaded File id in the future. */
    logoKey: { type: String, default: 'legacy-default' },
    primaryColor: { type: String, default: '#3c3c3c' },
    accentColor: { type: String, default: '#c32930' },
    footerText: { type: String, default: '' },
  },
  { _id: false },
);

const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    /** The company that owns all pre-multi-company records. Exactly one. */
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    timezone: { type: String, default: 'America/Chicago' },
    branding: { type: brandingSchema, default: () => ({}) },
  },
  { timestamps: true },
);

companySchema.index({ slug: 1 }, { unique: true });

export type CompanyDocument = InferSchemaType<typeof companySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CompanyModel = model('Company', companySchema, 'companies');
