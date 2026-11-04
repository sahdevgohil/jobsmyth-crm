import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

export const LOOKUP_TYPES = [
  'lead_source',
  'lost_reason',
  'property_type',
  'appointment_type',
  'photo_category',
  'slope_tag',
  'damage_tag',
  'material_category',
  'project_category',
  'warranty_type',
] as const;

export type LookupType = (typeof LOOKUP_TYPES)[number];

const lookupValueSchema = new Schema(
  {
    type: { type: String, enum: LOOKUP_TYPES, required: true },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    order: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

lookupValueSchema.index({ type: 1, key: 1 }, { unique: true });
lookupValueSchema.index({ type: 1, order: 1 });

export type LookupValueDocument = InferSchemaType<typeof lookupValueSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const LookupValueModel = model('LookupValue', lookupValueSchema, 'lookupValues');
