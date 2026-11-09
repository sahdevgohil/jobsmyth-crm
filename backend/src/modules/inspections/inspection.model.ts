import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const INSPECTION_STATUSES = ['draft', 'in_progress', 'completed', 'cancelled'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

const measurementsSchema = new Schema(
  {
    totalAreaSqFt: { type: Number, min: 0 },
    pitch: { type: String, trim: true, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: false },
);

const inspectionSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inspectionDate: { type: Date, required: true },
    typeKey: { type: String, required: true, trim: true, default: 'standard' },
    status: { type: String, enum: INSPECTION_STATUSES, required: true, default: 'draft' },
    roofCondition: { type: String, default: '' },
    findings: { type: String, default: '' },
    damageObservations: { type: String, default: '' },
    recommendations: { type: String, default: '' },
    notes: { type: String, default: '' },
    measurements: { type: measurementsSchema, default: () => ({}) },
    reportGeneratedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

inspectionSchema.index({ assignedTo: 1, inspectionDate: -1 });
inspectionSchema.index({ customerId: 1 });
inspectionSchema.index({ propertyId: 1 });
inspectionSchema.index({ appointmentId: 1 });
inspectionSchema.index({ leadId: 1 });
inspectionSchema.index({ status: 1 });

export type InspectionDocument = HydratedDocument<
  InferSchemaType<typeof inspectionSchema> & { createdAt: Date; updatedAt: Date }
>;

export const InspectionModel = model('Inspection', inspectionSchema, 'inspections');
