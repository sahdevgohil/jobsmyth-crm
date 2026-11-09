import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LINE_ITEM_KINDS } from '../settings/company-settings.model.js';

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'void',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = ['recorded', 'void'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_SOURCES = ['manual', 'provider', 'accounting_import'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

const lineItemSchema = new Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true },
    kind: { type: String, enum: LINE_ITEM_KINDS, required: true, default: 'other' },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, default: 'ea' },
    unitCostCents: { type: Number, required: true, min: 0 },
    amountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date },
    status: { type: String, enum: INVOICE_STATUSES, required: true, default: 'draft' },
    lineItems: { type: [lineItemSchema], default: [] },
    discountCents: { type: Number, required: true, min: 0, default: 0 },
    taxRateBps: { type: Number, required: true, min: 0, max: 10000, default: 0 },
    taxCents: { type: Number, required: true, min: 0, default: 0 },
    subtotalCents: { type: Number, required: true, min: 0, default: 0 },
    totalCents: { type: Number, required: true, min: 0, default: 0 },
    amountPaidCents: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, default: '' },
    externalAccountingRef: { type: String, default: '' },
    idempotencyKey: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

invoiceSchema.index({ customerId: 1 });
invoiceSchema.index({ projectId: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export type InvoiceDocument = HydratedDocument<
  InferSchemaType<typeof invoiceSchema> & { createdAt: Date; updatedAt: Date }
>;

export const InvoiceModel = model('Invoice', invoiceSchema, 'invoices');

const counterSchema = new Schema(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false },
);
export const InvoiceCounterModel = model('InvoiceCounter', counterSchema, 'invoiceCounters');

const paymentSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    amountCents: { type: Number, required: true, min: 1 },
    paymentDate: { type: Date, required: true },
    method: { type: String, required: true, trim: true },
    transactionRef: { type: String, default: '' },
    status: { type: String, enum: PAYMENT_STATUSES, required: true, default: 'recorded' },
    source: { type: String, enum: PAYMENT_SOURCES, required: true, default: 'manual' },
    notes: { type: String, default: '' },
    idempotencyKey: { type: String },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    externalAccountingRef: { type: String, default: '' },
  },
  { timestamps: true },
);

paymentSchema.index({ invoiceId: 1 });
paymentSchema.index({ customerId: 1 });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export type PaymentDocument = HydratedDocument<
  InferSchemaType<typeof paymentSchema> & { createdAt: Date; updatedAt: Date }
>;

export const PaymentModel = model('Payment', paymentSchema, 'payments');
