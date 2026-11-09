import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import type { AuthContext } from '../../services/entity-links.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { getProject } from '../projects/project.service.js';
import { SubcontractorModel } from '../subcontractors/subcontractor.model.js';
import {
  WorkOrderCounterModel,
  WorkOrderModel,
  type WorkOrderDocument,
  type WorkOrderStatus,
} from './work-order.model.js';

export type WorkOrderDto = {
  id: string;
  number: string;
  projectId: string;
  subcontractorId: string | null;
  assignedEmployeeId: string | null;
  title: string;
  description: string;
  instructions: string;
  location: string;
  status: WorkOrderStatus;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  completionNotes: string;
  issues: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDto(doc: WorkOrderDocument): WorkOrderDto {
  return {
    id: doc._id.toString(),
    number: doc.number,
    projectId: doc.projectId.toString(),
    subcontractorId: idOrNull(doc.subcontractorId),
    assignedEmployeeId: idOrNull(doc.assignedEmployeeId),
    title: doc.title,
    description: doc.description ?? '',
    instructions: doc.instructions ?? '',
    location: doc.location ?? '',
    status: doc.status as WorkOrderStatus,
    plannedStartAt: doc.plannedStartAt ? doc.plannedStartAt.toISOString() : null,
    plannedEndAt: doc.plannedEndAt ? doc.plannedEndAt.toISOString() : null,
    completionNotes: doc.completionNotes ?? '',
    issues: doc.issues ?? '',
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function nextNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counter = await WorkOrderCounterModel.findByIdAndUpdate(
    `wo-${year}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `WO-${year}-${String(counter?.seq ?? 1).padStart(4, '0')}`;
}

export async function listWorkOrders(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  projectId?: string;
  status?: WorkOrderStatus;
}): Promise<{ data: WorkOrderDto[]; meta: ReturnType<typeof paginationMeta> }> {
  // Ensure project access when filtering by project
  if (input.projectId) await getProject(input.projectId, input.auth);
  const filter: Record<string, unknown> = {};
  if (input.projectId) filter.projectId = input.projectId;
  if (input.status) filter.status = input.status;
  // Without project filter, salespeople only see WOs for projects they can access via customer scope
  if (!input.projectId && input.auth.role !== 'admin') {
    const { listProjects } = await import('../projects/project.service.js');
    const projects = await listProjects({
      auth: input.auth,
      page: 1,
      pageSize: 500,
    });
    filter.projectId = { $in: projects.data.map((p) => p.id) };
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    WorkOrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WorkOrderModel.countDocuments(filter),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getWorkOrder(id: string, auth: AuthContext): Promise<WorkOrderDto> {
  const doc = mongoose.isValidObjectId(id) ? await WorkOrderModel.findById(id) : null;
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Work order not found.' });
  }
  await getProject(doc.projectId.toString(), auth);
  return toDto(doc);
}

export async function createWorkOrder(input: {
  auth: AuthContext;
  projectId: string;
  title: string;
  description?: string;
  instructions?: string;
  location?: string;
  subcontractorId?: string;
  assignedEmployeeId?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  requestId?: string;
  ip?: string;
}): Promise<WorkOrderDto> {
  await getProject(input.projectId, input.auth);
  if (input.subcontractorId) {
    const sub = await SubcontractorModel.findById(input.subcontractorId);
    if (!sub || !sub.active) {
      throw new AppError({
        status: 422,
        code: 'INVALID_SUBCONTRACTOR',
        message: 'Subcontractor not found or inactive.',
      });
    }
  }
  const created = await WorkOrderModel.create({
    number: await nextNumber(),
    projectId: input.projectId,
    title: input.title.trim(),
    description: input.description ?? '',
    instructions: input.instructions ?? '',
    location: input.location ?? '',
    subcontractorId: input.subcontractorId,
    assignedEmployeeId: input.assignedEmployeeId,
    plannedStartAt: input.plannedStartAt ? new Date(input.plannedStartAt) : undefined,
    plannedEndAt: input.plannedEndAt ? new Date(input.plannedEndAt) : undefined,
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'work_order.created',
    entityType: 'work_order',
    entityId: created._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(created);
}

export async function updateWorkOrder(input: {
  auth: AuthContext;
  id: string;
  patch: Partial<{
    title: string;
    description: string;
    instructions: string;
    location: string;
    subcontractorId: string | null;
    assignedEmployeeId: string | null;
    status: WorkOrderStatus;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
    completionNotes: string;
    issues: string;
  }>;
  requestId?: string;
  ip?: string;
}): Promise<WorkOrderDto> {
  const doc = mongoose.isValidObjectId(input.id) ? await WorkOrderModel.findById(input.id) : null;
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Work order not found.' });
  }
  await getProject(doc.projectId.toString(), input.auth);
  if (doc.status === 'cancelled') {
    throw new AppError({
      status: 409,
      code: 'WORK_ORDER_LOCKED',
      message: 'Cancelled work orders cannot be edited.',
    });
  }
  const p = input.patch;
  if (p.title !== undefined) doc.title = p.title.trim();
  if (p.description !== undefined) doc.description = p.description;
  if (p.instructions !== undefined) doc.instructions = p.instructions;
  if (p.location !== undefined) doc.location = p.location;
  if (p.status !== undefined) doc.status = p.status;
  if (p.completionNotes !== undefined) doc.completionNotes = p.completionNotes;
  if (p.issues !== undefined) doc.issues = p.issues;
  if (p.subcontractorId !== undefined) {
    doc.subcontractorId = p.subcontractorId
      ? new mongoose.Types.ObjectId(p.subcontractorId)
      : null;
  }
  if (p.assignedEmployeeId !== undefined) {
    doc.assignedEmployeeId = p.assignedEmployeeId
      ? new mongoose.Types.ObjectId(p.assignedEmployeeId)
      : null;
  }
  if (p.plannedStartAt !== undefined) {
    doc.plannedStartAt = p.plannedStartAt ? new Date(p.plannedStartAt) : null;
  }
  if (p.plannedEndAt !== undefined) {
    doc.plannedEndAt = p.plannedEndAt ? new Date(p.plannedEndAt) : null;
  }
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'work_order.updated',
    entityType: 'work_order',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(doc);
}
