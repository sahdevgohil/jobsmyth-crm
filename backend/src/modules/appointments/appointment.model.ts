import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that no longer occupy the assignee's calendar. */
export const INACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'cancelled',
  'completed',
  'no_show',
];

export const REMINDER_CHANNEL_STATUSES = [
  'not_requested',
  'pending',
  'not_configured',
  'failed',
] as const;

export type ReminderChannelStatus = (typeof REMINDER_CHANNEL_STATUSES)[number];

const reminderSchema = new Schema(
  {
    emailRequested: { type: Boolean, default: false },
    smsRequested: { type: Boolean, default: false },
    internalNotifiedAt: { type: Date, default: null },
    emailStatus: { type: String, enum: REMINDER_CHANNEL_STATUSES, default: 'not_requested' },
    smsStatus: { type: String, enum: REMINDER_CHANNEL_STATUSES, default: 'not_requested' },
  },
  { _id: false },
);

const appointmentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    typeKey: { type: String, required: true, trim: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, required: true, default: 'scheduled' },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    projectId: { type: Schema.Types.ObjectId, default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    timeZone: { type: String, required: true, default: 'America/Chicago' },
    location: { type: String, default: '' },
    notes: { type: String, default: '' },
    cancellationReason: { type: String, default: '' },
    reminder: { type: reminderSchema, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

appointmentSchema.index({ assignedTo: 1, startAt: 1 });
appointmentSchema.index({ startAt: 1 });
appointmentSchema.index({ customerId: 1 });
appointmentSchema.index({ leadId: 1 });
appointmentSchema.index({ status: 1 });

export type AppointmentDocument = HydratedDocument<
  InferSchemaType<typeof appointmentSchema> & { createdAt: Date; updatedAt: Date }
>;

export const AppointmentModel = model('Appointment', appointmentSchema, 'appointments');
