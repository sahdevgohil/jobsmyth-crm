import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LINE_ITEM_KINDS } from '../settings/company-settings.model.js';

export const PROPOSAL_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'rejected',
  'expired',
  'void',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const SIGNATURE_STATUSES = [
  'not_requested',
  'pending',
  'signed',
  'declined',
  'error',
  'not_configured',
] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

const lineItemSchema = new Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true, trim: true },
    kind: { type: String, enum: LINE_ITEM_KINDS, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    unitCostCents: { type: Number, required: true, min: 0 },
    laborCostCents: { type: Number, required: true, min: 0, default: 0 },
    materialCostCents: { type: Number, required: true, min: 0, default: 0 },
    amountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const paymentScheduleItemSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    percentBps: { type: Number, min: 0, max: 10000 },
    amountCents: { type: Number, min: 0 },
  },
  { _id: false },
);

const proposalSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate', required: true },
    version: { type: Number, required: true, min: 1, default: 1 },
    status: { type: String, enum: PROPOSAL_STATUSES, required: true, default: 'draft' },
    lineItems: { type: [lineItemSchema], default: [] },
    discountCents: { type: Number, required: true, min: 0, default: 0 },
    taxRateBps: { type: Number, required: true, min: 0, max: 10000, default: 0 },
    taxCents: { type: Number, required: true, min: 0, default: 0 },
    subtotalCents: { type: Number, required: true, min: 0, default: 0 },
    totalCents: { type: Number, required: true, min: 0, default: 0 },
    termsAndConditions: { type: String, default: '' },
    paymentSchedule: { type: [paymentScheduleItemSchema], default: [] },
    expirationDate: { type: Date },
    signature: {
      status: {
        type: String,
        enum: SIGNATURE_STATUSES,
        required: true,
        default: 'not_requested',
      },
      provider: {
        type: String,
        enum: ['none', 'dropbox_sign', 'docusign'],
        required: true,
        default: 'none',
      },
      providerRef: { type: String, default: '' },
      signedAt: { type: Date, default: null },
      signedDocumentFileId: { type: Schema.Types.ObjectId, ref: 'File' },
      errorMessage: { type: String, default: '' },
    },
    notes: { type: String, default: '' },
    parentProposalId: { type: Schema.Types.ObjectId, ref: 'Proposal' },
    lastEmailDelivery: {
      status: { type: String, default: '' },
      message: { type: String, default: '' },
      at: { type: Date, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

proposalSchema.index({ customerId: 1 });
proposalSchema.index({ estimateId: 1 });
proposalSchema.index({ status: 1 });
proposalSchema.index({ createdAt: -1 });

export type ProposalDocument = HydratedDocument<
  InferSchemaType<typeof proposalSchema> & { createdAt: Date; updatedAt: Date }
>;

export const ProposalModel = model('Proposal', proposalSchema, 'proposals');

const counterSchema = new Schema(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false },
);

export const ProposalCounterModel = model('ProposalCounter', counterSchema, 'proposalCounters');
