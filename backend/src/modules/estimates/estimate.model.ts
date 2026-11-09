import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LINE_ITEM_KINDS } from '../settings/company-settings.model.js';

export const ESTIMATE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'denied',
  'expired',
  'void',
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

const lineItemSchema = new Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true, trim: true },
    kind: { type: String, enum: LINE_ITEM_KINDS, required: true, default: 'material' },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, default: 'ea' },
    unitCostCents: { type: Number, required: true, min: 0, default: 0 },
    laborCostCents: { type: Number, required: true, min: 0, default: 0 },
    materialCostCents: { type: Number, required: true, min: 0, default: 0 },
    /** Always computed by the backend; never trusted from clients. */
    amountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/** One entry per status change; never edited or removed. */
const statusEventSchema = new Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const estimateSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection' },
    measurementId: { type: Schema.Types.ObjectId, ref: 'Measurement' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    status: { type: String, enum: ESTIMATE_STATUSES, required: true, default: 'draft' },
    version: { type: Number, required: true, min: 1, default: 1 },
    lineItems: { type: [lineItemSchema], default: [] },
    discountCents: { type: Number, required: true, min: 0, default: 0 },
    taxRateBps: { type: Number, required: true, min: 0, max: 10000, default: 0 },
    taxCents: { type: Number, required: true, min: 0, default: 0 },
    subtotalCents: { type: Number, required: true, min: 0, default: 0 },
    totalCents: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, default: '' },
    validUntil: { type: Date },
    sentAt: { type: Date },
    acceptedAt: { type: Date },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deniedAt: { type: Date },
    deniedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    denialReason: { type: String, default: '' },
    denialNote: { type: String, default: '' },
    statusHistory: { type: [statusEventSchema], default: [] },
    parentEstimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
    /** Set when priced from a catalog: which catalog version/package/inputs produced these lines (snapshot). */
    pricingSource: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

estimateSchema.index({ customerId: 1 });
estimateSchema.index({ propertyId: 1 });
estimateSchema.index({ inspectionId: 1 });
estimateSchema.index({ status: 1 });
estimateSchema.index({ createdAt: -1 });

export type EstimateDocument = HydratedDocument<
  InferSchemaType<typeof estimateSchema> & { createdAt: Date; updatedAt: Date }
>;

export const EstimateModel = model('Estimate', estimateSchema, 'estimates');

/** Atomic per-year sequence used for estimate numbers. */
const counterSchema = new Schema(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false },
);

export const EstimateCounterModel = model('EstimateCounter', counterSchema, 'estimateCounters');
