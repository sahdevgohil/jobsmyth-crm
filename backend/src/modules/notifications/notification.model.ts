import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'lead_assigned',
  'website_lead_received',
  'possible_duplicate',
  'appointment_assigned',
  'appointment_changed',
  'appointment_reminder',
  'inspection_completed',
  'storm_alert',
  'storm_follow_up',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    link: { type: String, trim: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

export type NotificationDocument = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const NotificationModel = model('Notification', notificationSchema, 'notifications');
