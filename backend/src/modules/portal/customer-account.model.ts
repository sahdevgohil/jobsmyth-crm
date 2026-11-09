import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const customerAccountSchema = new Schema(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    isActive: { type: Boolean, required: true, default: true },
    mustChangePassword: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type CustomerAccountDocument = InferSchemaType<typeof customerAccountSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CustomerAccountModel = model(
  'CustomerAccount',
  customerAccountSchema,
  'customerAccounts',
);
