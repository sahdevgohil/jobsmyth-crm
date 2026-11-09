import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const addressSchema = new Schema(
  {
    line1: { type: String, default: '' },
    line2: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    zip: { type: String, default: '' },
  },
  { _id: false },
);

const duplicateRefSchema = new Schema(
  {
    entityType: { type: String, enum: ['lead', 'customer'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const leadSchema = new Schema(
  {
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    companyName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    emailNormalized: { type: String, default: null },
    phone: { type: String, trim: true, default: '' },
    phoneE164: { type: String, default: null },
    address: { type: addressSchema, default: () => ({}) },
    addressKey: { type: String, default: null },
    sourceKey: { type: String, required: true },
    stageId: { type: Schema.Types.ObjectId, ref: 'PipelineStage', required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    serviceInterestKey: { type: String, default: '' },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    referredByCustomerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    possibleDuplicateOf: { type: [duplicateRefSchema], default: [] },
    lostReasonKey: { type: String, default: null },
    convertedCustomerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    convertedAt: { type: Date, default: null },
    externalSubmissionId: { type: String },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

leadSchema.index({ assignedTo: 1, stageId: 1 });
leadSchema.index({ phoneE164: 1 });
leadSchema.index({ emailNormalized: 1 });
leadSchema.index({ addressKey: 1 });
leadSchema.index({ externalSubmissionId: 1 }, { unique: true, sparse: true });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ firstName: 'text', lastName: 'text', companyName: 'text' });

export type LeadDocument = HydratedDocument<InferSchemaType<typeof leadSchema>>;

export const LeadModel = model('Lead', leadSchema, 'leads');
