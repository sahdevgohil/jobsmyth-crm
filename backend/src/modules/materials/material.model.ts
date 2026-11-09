import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const materialSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: '', trim: true },
    description: { type: String, default: '' },
    unit: { type: String, required: true, trim: true, default: 'ea' },
    costCents: { type: Number, required: true, min: 0, default: 0 },
    supplier: { type: String, default: '' },
    active: { type: Boolean, required: true, default: true },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

materialSchema.index({ name: 1 });
materialSchema.index({ sku: 1 });
materialSchema.index({ active: 1 });

export type MaterialDocument = HydratedDocument<
  InferSchemaType<typeof materialSchema> & { createdAt: Date; updatedAt: Date }
>;

export const MaterialModel = model('Material', materialSchema, 'materials');

export const MATERIAL_REQUIREMENT_STATUSES = [
  'needed',
  'ordered',
  'delivered',
  'cancelled',
] as const;
export type MaterialRequirementStatus = (typeof MATERIAL_REQUIREMENT_STATUSES)[number];

const materialRequirementSchema = new Schema(
  {
    materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, default: 'ea' },
    status: {
      type: String,
      enum: MATERIAL_REQUIREMENT_STATUSES,
      required: true,
      default: 'needed',
    },
    notes: { type: String, default: '' },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
    proposalId: { type: Schema.Types.ObjectId, ref: 'Proposal' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

materialRequirementSchema.index({ materialId: 1 });
materialRequirementSchema.index({ estimateId: 1 });
materialRequirementSchema.index({ proposalId: 1 });
materialRequirementSchema.index({ projectId: 1 });

export type MaterialRequirementDocument = HydratedDocument<
  InferSchemaType<typeof materialRequirementSchema> & { createdAt: Date; updatedAt: Date }
>;

export const MaterialRequirementModel = model(
  'MaterialRequirement',
  materialRequirementSchema,
  'materialRequirements',
);
