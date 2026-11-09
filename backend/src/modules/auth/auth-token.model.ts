import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const authTokenSchema = new Schema(
  {
    purpose: { type: String, enum: ['password_reset', 'invite'], required: true },
    principalType: { type: String, enum: ['user', 'customer'], required: true },
    principalId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
);

authTokenSchema.index({ tokenHash: 1 }, { unique: true });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthTokenDocument = InferSchemaType<typeof authTokenSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const AuthTokenModel = model('AuthToken', authTokenSchema, 'authTokens');
