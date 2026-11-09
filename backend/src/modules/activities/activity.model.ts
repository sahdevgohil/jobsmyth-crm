import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

export const ACTIVITY_TYPES = [
  'note',
  'call',
  'follow_up',
  'stage_change',
  'assignment',
  'conversion',
  'system',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const activitySchema = new Schema(
  {
    entityType: { type: String, enum: ['lead', 'customer', 'project'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    body: { type: String, default: '' },
    dueAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    metadata: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

activitySchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
activitySchema.index({ assignedTo: 1, completedAt: 1, dueAt: 1 });

export type ActivityDocument = InferSchemaType<typeof activitySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ActivityModel = model('Activity', activitySchema, 'activities');
