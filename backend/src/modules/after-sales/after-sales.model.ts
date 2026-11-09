import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const afterSalesSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    completionConfirmedAt: { type: Date, default: null },
    completionConfirmedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    feedbackRating: { type: Number, min: 1, max: 5, default: null },
    feedbackComment: { type: String, default: '' },
    warrantyLookupKey: { type: String, default: null },
    warrantyNotes: { type: String, default: '' },
    followUpDueAt: { type: Date, default: null },
    followUpCompletedAt: { type: Date, default: null },
    serviceHistoryNotes: { type: String, default: '' },
    customerNotesVisible: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

afterSalesSchema.index({ projectId: 1 }, { unique: true });
afterSalesSchema.index({ customerId: 1, createdAt: -1 });
afterSalesSchema.index({ followUpDueAt: 1 });

export type AfterSalesDocument = InferSchemaType<typeof afterSalesSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const AfterSalesModel = model('AfterSales', afterSalesSchema, 'afterSales');
