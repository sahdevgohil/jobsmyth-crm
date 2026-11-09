import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const WORK_ORDER_STATUSES = [
  'draft',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const workOrderSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    subcontractorId: { type: Schema.Types.ObjectId, ref: 'Subcontractor' },
    assignedEmployeeId: { type: Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    instructions: { type: String, default: '' },
    location: { type: String, default: '' },
    status: { type: String, enum: WORK_ORDER_STATUSES, required: true, default: 'draft' },
    plannedStartAt: { type: Date },
    plannedEndAt: { type: Date },
    completionNotes: { type: String, default: '' },
    issues: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

workOrderSchema.index({ projectId: 1 });
workOrderSchema.index({ status: 1 });
workOrderSchema.index({ subcontractorId: 1 });

export type WorkOrderDocument = HydratedDocument<
  InferSchemaType<typeof workOrderSchema> & { createdAt: Date; updatedAt: Date }
>;

export const WorkOrderModel = model('WorkOrder', workOrderSchema, 'workOrders');

const counterSchema = new Schema(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false },
);
export const WorkOrderCounterModel = model(
  'WorkOrderCounter',
  counterSchema,
  'workOrderCounters',
);
