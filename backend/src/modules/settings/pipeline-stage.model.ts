import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const LEAD_STAGE_CATEGORIES = ['open', 'won', 'lost'] as const;
export type LeadStageCategory = (typeof LEAD_STAGE_CATEGORIES)[number];

export const PIPELINES = ['lead', 'project'] as const;
export type PipelineKind = (typeof PIPELINES)[number];

const pipelineStageSchema = new Schema(
  {
    pipeline: { type: String, enum: PIPELINES, required: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    order: { type: Number, required: true },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

pipelineStageSchema.index({ pipeline: 1, order: 1 });
pipelineStageSchema.index({ pipeline: 1, name: 1 }, { unique: true });

export type PipelineStageDocument = HydratedDocument<
  InferSchemaType<typeof pipelineStageSchema>
>;

export const PipelineStageModel = model(
  'PipelineStage',
  pipelineStageSchema,
  'pipelineStages',
);
