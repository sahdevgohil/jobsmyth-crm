import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const PROJECT_STATUSES = [
  'awaiting_approval',
  'approved',
  'planning',
  'scheduled',
  'materials_preparation',
  'in_progress',
  'on_hold',
  'quality_review',
  'completed',
  'closed',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

/** Allowed forward transitions (and same-status no-ops). Cancel/hold from most open states. */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  awaiting_approval: ['approved', 'cancelled'],
  approved: ['planning', 'scheduled', 'cancelled'],
  planning: ['scheduled', 'materials_preparation', 'on_hold', 'cancelled'],
  scheduled: ['materials_preparation', 'in_progress', 'on_hold', 'cancelled'],
  materials_preparation: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['quality_review', 'on_hold', 'completed', 'cancelled'],
  on_hold: ['planning', 'scheduled', 'materials_preparation', 'in_progress', 'cancelled'],
  quality_review: ['completed', 'in_progress', 'cancelled'],
  completed: ['closed'],
  closed: [],
  cancelled: [],
};

const projectSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
    proposalId: { type: Schema.Types.ObjectId, ref: 'Proposal' },
    projectTypeKey: { type: String, default: '' },
    projectManagerId: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedEmployeeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    status: { type: String, enum: PROJECT_STATUSES, required: true, default: 'awaiting_approval' },
    priority: { type: String, enum: PROJECT_PRIORITIES, required: true, default: 'normal' },
    plannedStartAt: { type: Date },
    plannedEndAt: { type: Date },
    actualStartAt: { type: Date },
    actualEndAt: { type: Date },
    budgetCents: { type: Number, min: 0, default: 0 },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

projectSchema.index({ customerId: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ projectManagerId: 1 });
projectSchema.index({ createdAt: -1 });

export type ProjectDocument = HydratedDocument<
  InferSchemaType<typeof projectSchema> & { createdAt: Date; updatedAt: Date }
>;

export const ProjectModel = model('Project', projectSchema, 'projects');

const counterSchema = new Schema(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false },
);
export const ProjectCounterModel = model('ProjectCounter', counterSchema, 'projectCounters');

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const projectTaskSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, trim: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    dueAt: { type: Date },
    priority: { type: String, enum: PROJECT_PRIORITIES, default: 'normal' },
    status: { type: String, enum: TASK_STATUSES, required: true, default: 'open' },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

projectTaskSchema.index({ projectId: 1, status: 1 });
projectTaskSchema.index({ assignedTo: 1 });

export type ProjectTaskDocument = HydratedDocument<
  InferSchemaType<typeof projectTaskSchema> & { createdAt: Date; updatedAt: Date }
>;

export const ProjectTaskModel = model('ProjectTask', projectTaskSchema, 'projectTasks');
