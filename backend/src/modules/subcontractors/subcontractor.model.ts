import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const subcontractorSchema = new Schema(
  {
    companyName: { type: String, required: true, trim: true },
    contactName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zip: { type: String, default: '' },
    },
    serviceCategories: { type: [String], default: [] },
    notes: { type: String, default: '' },
    active: { type: Boolean, required: true, default: true },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

subcontractorSchema.index({ companyName: 1 });
subcontractorSchema.index({ active: 1 });

export type SubcontractorDocument = HydratedDocument<
  InferSchemaType<typeof subcontractorSchema> & { createdAt: Date; updatedAt: Date }
>;

export const SubcontractorModel = model(
  'Subcontractor',
  subcontractorSchema,
  'subcontractors',
);
