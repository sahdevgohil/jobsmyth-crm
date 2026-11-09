import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const contactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
  },
  { _id: false },
);

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

const customerSchema = new Schema(
  {
    type: { type: String, enum: ['individual', 'business'], required: true },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    companyName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    emailNormalized: { type: String, default: null },
    phone: { type: String, trim: true, default: '' },
    phoneE164: { type: String, default: null },
    contacts: { type: [contactSchema], default: [] },
    mailingAddress: { type: addressSchema, default: () => ({}) },
    /** Contact consent is recorded per channel with timestamp, source and the wording shown. */
    consent: {
      sms: { type: new Schema({ granted: Boolean, at: Date, source: String, wording: String, wordingVersion: String }, { _id: false }), default: undefined },
      email: { type: new Schema({ granted: Boolean, at: Date, source: String, wording: String, wordingVersion: String }, { _id: false }), default: undefined },
    },
    preferredContact: { type: String, enum: ['call', 'text', 'email', ''], default: '' },
    bestTimeToReach: { type: String, default: '' },
    secondContactName: { type: String, default: '' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: '' },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

customerSchema.index({ ownerId: 1 });
customerSchema.index({ phoneE164: 1 });
customerSchema.index({ emailNormalized: 1 });
customerSchema.index({ firstName: 'text', lastName: 'text', companyName: 'text' });

export type CustomerDocument = HydratedDocument<InferSchemaType<typeof customerSchema>>;

export const CustomerModel = model('Customer', customerSchema, 'customers');
