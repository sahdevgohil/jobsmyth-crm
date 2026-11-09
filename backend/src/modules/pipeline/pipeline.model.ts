import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PIPELINE_STAGES } from './pipeline.calc.js';

export const PIPELINE_STATES = ['active', 'denied', 'cancelled', 'archived'] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];

/** History entries use stage keys plus the two states a job can leave the pipeline through. */
export const HISTORY_TARGETS = [...PIPELINE_STAGES, 'denied', 'cancelled', 'archived'] as const;

const historySchema = new Schema(
  {
    from: { type: String, enum: [...HISTORY_TARGETS, 'none'], required: true },
    to: { type: String, enum: HISTORY_TARGETS, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    auto: { type: Boolean, required: true, default: true },
    trigger: { type: String, default: '' },
    reason: { type: String, default: '' },
    /** True when an administrator moved the job to a stage its records do not support. */
    exception: { type: Boolean, default: false },
    /** True when the date is the best known one, not a recorded event (jobs that existed before the pipeline). */
    approximate: { type: Boolean, default: false },
    /** Stage value at the time, for audit. */
    valueCents: { type: Number },
  },
  { _id: false },
);

const changeOrderSchema = new Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true, trim: true },
    /** Signed: a change order can reduce the contract. */
    amountCents: { type: Number, required: true },
    approvedAt: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const pipelineJobSchema = new Schema(
  {
    number: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    /** The estimate currently driving this job, and every earlier version that belonged to it. */
    /** Oldest ancestor of the estimate lineage: one job per lineage, enforced by a unique index. */
    rootEstimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
    estimateIds: [{ type: Schema.Types.ObjectId, ref: 'Estimate' }],
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    jobTypeKey: { type: String, default: '' },
    state: { type: String, enum: PIPELINE_STATES, required: true, default: 'active' },
    stage: { type: String, enum: PIPELINE_STAGES },
    stageEnteredAt: { type: Date, required: true },
    /** Bumped on every stage change; makes concurrent moves lose cleanly. */
    version: { type: Number, required: true, default: 0 },
    estimateCents: { type: Number, required: true, default: 0, min: 0 },
    /** Accepted estimate total, or the project budget for a job that never had an estimate (see valueSource). */
    baseContractCents: { type: Number, required: true, default: 0, min: 0 },
    valueSource: { type: String, enum: ['estimate', 'project_budget', 'none'], default: 'none' },
    changeOrders: { type: [changeOrderSchema], default: [] },
    sentAt: { type: Date },
    acceptedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    invoicedAt: { type: Date },
    paidAt: { type: Date },
    deniedAt: { type: Date },
    /** An administrator forced the stage; automation will not move the job backwards. */
    manualOverride: { type: Boolean, default: false },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

pipelineJobSchema.index({ state: 1, stage: 1 });
pipelineJobSchema.index({ customerId: 1 });
pipelineJobSchema.index({ estimateIds: 1 });
pipelineJobSchema.index({ projectId: 1 }, { unique: true, sparse: true });
pipelineJobSchema.index({ estimateId: 1 });
pipelineJobSchema.index({ rootEstimateId: 1 }, { unique: true, sparse: true });
pipelineJobSchema.index({ stageEnteredAt: -1 });

export type PipelineJobDocument = HydratedDocument<InferSchemaType<typeof pipelineJobSchema> & { createdAt: Date; updatedAt: Date }>;
export const PipelineJobModel = model('PipelineJob', pipelineJobSchema, 'pipelineJobs');
