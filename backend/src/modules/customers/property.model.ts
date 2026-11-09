import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const addressSchema = new Schema(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    zip: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const propertySchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    address: { type: addressSchema, required: true },
    addressKey: { type: String, default: null },
    propertyTypeKey: { type: String, trim: true, default: '' },
    details: {
      stories: { type: Number },
      roofAgeYears: { type: Number },
      notes: { type: String, default: '' },
    },
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

propertySchema.index({ customerId: 1 });
propertySchema.index({ addressKey: 1 });

export type PropertyDocument = HydratedDocument<InferSchemaType<typeof propertySchema>>;

export const PropertyModel = model('Property', propertySchema, 'properties');
