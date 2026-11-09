import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ROLES } from '../../config/permissions.js';

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, required: true, default: true },
    receivesLeads: { type: Boolean, required: true, default: false },
    mustChangePassword: { type: Boolean, required: true, default: false },
    lastLoginAt: { type: Date },
    /** Owning company. Absent = default company (backfilled lazily by `authenticate`). */
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, isActive: 1 });

export type UserDocument = InferSchemaType<typeof userSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const UserModel = model('User', userSchema, 'users');
