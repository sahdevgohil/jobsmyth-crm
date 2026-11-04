import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const refreshSessionSchema = new Schema(
  {
    principalType: { type: String, enum: ['user'], required: true },
    principalId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: Schema.Types.ObjectId, ref: 'RefreshSession' },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true },
);

refreshSessionSchema.index({ tokenHash: 1 }, { unique: true });
refreshSessionSchema.index({ principalId: 1 });
refreshSessionSchema.index({ familyId: 1 });
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshSessionDocument = InferSchemaType<typeof refreshSessionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const RefreshSessionModel = model(
  'RefreshSession',
  refreshSessionSchema,
  'refreshSessions',
);
