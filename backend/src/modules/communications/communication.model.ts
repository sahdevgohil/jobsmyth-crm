import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

export const COMMUNICATION_CHANNELS = ['email', 'sms', 'internal_note'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_DIRECTIONS = ['inbound', 'outbound', 'internal'] as const;
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

export const DELIVERY_STATUSES = [
  'not_configured',
  'queued',
  'sent',
  'failed',
  'delivered',
  'received',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const COMMUNICATION_PROVIDERS = ['none', 'resend', 'twilio'] as const;
export type CommunicationProvider = (typeof COMMUNICATION_PROVIDERS)[number];

const communicationSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    channel: { type: String, enum: COMMUNICATION_CHANNELS, required: true },
    direction: { type: String, enum: COMMUNICATION_DIRECTIONS, required: true },
    subject: { type: String, default: '' },
    body: { type: String, required: true, default: '' },
    deliveryStatus: { type: String, enum: DELIVERY_STATUSES, required: true },
    provider: { type: String, enum: COMMUNICATION_PROVIDERS, required: true, default: 'none' },
    providerMessageId: { type: String, default: null },
    sender: { type: String, default: '' },
    recipient: { type: String, default: '' },
    customerVisible: { type: Boolean, required: true, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

communicationSchema.index({ customerId: 1, createdAt: -1 });
communicationSchema.index({ leadId: 1, createdAt: -1 });
communicationSchema.index({ projectId: 1, createdAt: -1 });
communicationSchema.index({ channel: 1, createdAt: -1 });

export type CommunicationDocument = InferSchemaType<typeof communicationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CommunicationModel = model(
  'Communication',
  communicationSchema,
  'communications',
);
