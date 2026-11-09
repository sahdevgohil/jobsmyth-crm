import { syncPipelineFromProject } from '../pipeline/pipeline.hooks.js';
import { ActivityModel } from '../activities/activity.model.js';
import { InvoiceModel, PaymentModel } from '../invoices/invoice.model.js';
import { WorkOrderModel } from '../work-orders/work-order.model.js';
import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import {
  customerOrInspectionScopeFilter,
  resolveCustomerPropertyTarget,
  type AuthContext,
} from '../../services/entity-links.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { ProposalModel } from '../proposals/proposal.model.js';
import {
  PROJECT_TRANSITIONS,
  ProjectCounterModel,
  ProjectModel,
  ProjectTaskModel,
  type ProjectDocument,
  type ProjectPriority,
  type ProjectStatus,
  type ProjectTaskDocument,
  type TaskStatus,
} from './project.model.js';

export type { AuthContext };

export type ProjectDto = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string;
  leadId: string | null;
  estimateId: string | null;
  proposalId: string | null;
  projectTypeKey: string;
  projectManagerId: string | null;
  assignedEmployeeIds: string[];
  status: ProjectStatus;
  priority: ProjectPriority;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  budgetCents: number;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskDto = {
  id: string;
  projectId: string;
  title: string;
  assignedTo: string | null;
  dueAt: string | null;
  priority: ProjectPriority;
  status: TaskStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDto(doc: ProjectDocument): ProjectDto {
  return {
    id: doc._id.toString(),
    number: doc.number,
    customerId: doc.customerId.toString(),
    propertyId: doc.propertyId.toString(),
    leadId: idOrNull(doc.leadId),
    estimateId: idOrNull(doc.estimateId),
    proposalId: idOrNull(doc.proposalId),
    projectTypeKey: doc.projectTypeKey ?? '',
    projectManagerId: idOrNull(doc.projectManagerId),
    assignedEmployeeIds: (doc.assignedEmployeeIds ?? []).map((id) => id.toString()),
    status: doc.status as ProjectStatus,
    priority: doc.priority as ProjectPriority,
    plannedStartAt: doc.plannedStartAt ? doc.plannedStartAt.toISOString() : null,
    plannedEndAt: doc.plannedEndAt ? doc.plannedEndAt.toISOString() : null,
    actualStartAt: doc.actualStartAt ? doc.actualStartAt.toISOString() : null,
    actualEndAt: doc.actualEndAt ? doc.actualEndAt.toISOString() : null,
    budgetCents: doc.budgetCents ?? 0,
    notes: doc.notes ?? '',
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toTaskDto(doc: ProjectTaskDocument): ProjectTaskDto {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    title: doc.title,
    assignedTo: idOrNull(doc.assignedTo),
    dueAt: doc.dueAt ? doc.dueAt.toISOString() : null,
    priority: (doc.priority ?? 'normal') as ProjectPriority,
    status: doc.status as TaskStatus,
    notes: doc.notes ?? '',
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function nextNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counter = await ProjectCounterModel.findByIdAndUpdate(
    `project-${year}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `PRJ-${year}-${String(counter?.seq ?? 1).padStart(4, '0')}`;
}

async function findProject(id: string, auth: AuthContext): Promise<ProjectDocument> {
  const scope = await customerOrInspectionScopeFilter(auth);
  const doc = mongoose.isValidObjectId(id)
    ? await ProjectModel.findOne({ _id: id, ...scope })
    : null;
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Project not found.' });
  }
  return doc;
}

export async function listProjects(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  status?: ProjectStatus;
  customerId?: string;
  search?: string;
}): Promise<{ data: ProjectDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const scope = await customerOrInspectionScopeFilter(input.auth);
  const filter: Record<string, unknown> = { ...scope };
  if (input.status) filter.status = input.status;
  if (input.customerId) filter.customerId = input.customerId;
  if (input.search?.trim()) {
    filter.number = { $regex: escapeRegex(input.search.trim()), $options: 'i' };
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    ProjectModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ProjectModel.countDocuments(filter),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getProject(id: string, auth: AuthContext): Promise<ProjectDto> {
  return toDto(await findProject(id, auth));
}

export async function createProject(input: {
  auth: AuthContext;
  customerId: string;
  propertyId: string;
  leadId?: string;
  estimateId?: string;
  proposalId?: string;
  projectTypeKey?: string;
  projectManagerId?: string;
  assignedEmployeeIds?: string[];
  status?: ProjectStatus;
  priority?: ProjectPriority;
  plannedStartAt?: string;
  plannedEndAt?: string;
  budgetCents?: number;
  notes?: string;
  requestId?: string;
  ip?: string;
}): Promise<ProjectDto> {
  const links = await resolveCustomerPropertyTarget(input.auth, {
    customerId: input.customerId,
    propertyId: input.propertyId,
  });
  if (input.proposalId) {
    const proposal = await ProposalModel.findById(input.proposalId);
    if (!proposal || proposal.customerId.toString() !== links.customerId.toString()) {
      throw new AppError({
        status: 422,
        code: 'INVALID_PROPOSAL',
        message: 'Proposal not found for this customer.',
      });
    }
  }
  const number = await nextNumber();
  const created = await ProjectModel.create({
    number,
    customerId: links.customerId,
    propertyId: links.propertyId,
    leadId: input.leadId,
    estimateId: input.estimateId,
    proposalId: input.proposalId,
    projectTypeKey: input.projectTypeKey ?? '',
    projectManagerId: input.projectManagerId ?? input.auth.userId,
    assignedEmployeeIds: input.assignedEmployeeIds ?? [],
    status: input.status ?? 'awaiting_approval',
    priority: input.priority ?? 'normal',
    plannedStartAt: input.plannedStartAt ? new Date(input.plannedStartAt) : undefined,
    plannedEndAt: input.plannedEndAt ? new Date(input.plannedEndAt) : undefined,
    budgetCents: input.budgetCents ?? 0,
    notes: input.notes ?? '',
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'project.created',
    entityType: 'project',
    entityId: created._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  await syncPipelineFromProject(created._id.toString(), { actorId: input.auth.userId, trigger: 'project_created' });
  return toDto(created);
}

export async function updateProject(input: {
  auth: AuthContext;
  id: string;
  patch: Record<string, unknown>;
  requestId?: string;
  ip?: string;
}): Promise<ProjectDto> {
  const doc = await findProject(input.id, input.auth);
  if (doc.status === 'closed' || doc.status === 'cancelled') {
    throw new AppError({
      status: 409,
      code: 'PROJECT_LOCKED',
      message: 'Closed or cancelled projects cannot be edited.',
    });
  }
  const p = input.patch;
  if (p.projectTypeKey !== undefined) doc.projectTypeKey = String(p.projectTypeKey);
  if (p.projectManagerId !== undefined) {
    doc.projectManagerId = p.projectManagerId
      ? new mongoose.Types.ObjectId(String(p.projectManagerId))
      : null;
  }
  if (p.assignedEmployeeIds !== undefined) {
    doc.assignedEmployeeIds = (p.assignedEmployeeIds as string[]).map(
      (id) => new mongoose.Types.ObjectId(id),
    );
  }
  if (p.priority !== undefined) doc.priority = p.priority as ProjectPriority;
  if (p.plannedStartAt !== undefined) {
    doc.plannedStartAt = p.plannedStartAt ? new Date(String(p.plannedStartAt)) : null;
  }
  if (p.plannedEndAt !== undefined) {
    doc.plannedEndAt = p.plannedEndAt ? new Date(String(p.plannedEndAt)) : null;
  }
  if (p.actualStartAt !== undefined) {
    doc.actualStartAt = p.actualStartAt ? new Date(String(p.actualStartAt)) : null;
  }
  if (p.actualEndAt !== undefined) {
    doc.actualEndAt = p.actualEndAt ? new Date(String(p.actualEndAt)) : null;
  }
  if (p.budgetCents !== undefined) doc.budgetCents = Number(p.budgetCents);
  if (p.notes !== undefined) doc.notes = String(p.notes);
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'project.updated',
    entityType: 'project',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  await syncPipelineFromProject(doc._id.toString(), { actorId: input.auth.userId, trigger: 'project_updated' });
  return toDto(doc);
}

export async function changeProjectStatus(input: {
  auth: AuthContext;
  id: string;
  status: ProjectStatus;
  requestId?: string;
  ip?: string;
}): Promise<ProjectDto> {
  const doc = await findProject(input.id, input.auth);
  const current = doc.status as ProjectStatus;
  if (current === input.status) return toDto(doc);
  const allowed = PROJECT_TRANSITIONS[current] ?? [];
  if (!allowed.includes(input.status)) {
    throw new AppError({
      status: 422,
      code: 'INVALID_TRANSITION',
      message: `Cannot move project from ${current} to ${input.status}.`,
    });
  }
  doc.status = input.status;
  if (input.status === 'in_progress' && !doc.actualStartAt) doc.actualStartAt = new Date();
  if ((input.status === 'completed' || input.status === 'closed') && !doc.actualEndAt) {
    doc.actualEndAt = new Date();
  }
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'project.status_changed',
    entityType: 'project',
    entityId: doc._id.toString(),
    changes: { from: current, to: input.status },
    requestId: input.requestId,
    ip: input.ip,
  });
  await syncPipelineFromProject(doc._id.toString(), { actorId: input.auth.userId, trigger: `project_${input.status}` });
  return toDto(doc);
}

export async function listTasks(
  projectId: string,
  auth: AuthContext,
): Promise<ProjectTaskDto[]> {
  await findProject(projectId, auth);
  const rows = await ProjectTaskModel.find({ projectId }).sort({ createdAt: 1 });
  return rows.map(toTaskDto);
}

export async function createTask(input: {
  auth: AuthContext;
  projectId: string;
  title: string;
  assignedTo?: string;
  dueAt?: string;
  priority?: ProjectPriority;
  notes?: string;
  requestId?: string;
  ip?: string;
}): Promise<ProjectTaskDto> {
  await findProject(input.projectId, input.auth);
  const created = await ProjectTaskModel.create({
    projectId: input.projectId,
    title: input.title.trim(),
    assignedTo: input.assignedTo,
    dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
    priority: input.priority ?? 'normal',
    notes: input.notes ?? '',
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'project_task.created',
    entityType: 'project_task',
    entityId: created._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toTaskDto(created);
}

export async function updateTask(input: {
  auth: AuthContext;
  projectId: string;
  taskId: string;
  patch: Partial<{
    title: string;
    assignedTo: string | null;
    dueAt: string | null;
    priority: ProjectPriority;
    status: TaskStatus;
    notes: string;
  }>;
  requestId?: string;
  ip?: string;
}): Promise<ProjectTaskDto> {
  await findProject(input.projectId, input.auth);
  const doc = await ProjectTaskModel.findOne({ _id: input.taskId, projectId: input.projectId });
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Task not found.' });
  }
  if (input.patch.title !== undefined) doc.title = input.patch.title.trim();
  if (input.patch.assignedTo !== undefined) {
    doc.assignedTo = input.patch.assignedTo
      ? new mongoose.Types.ObjectId(input.patch.assignedTo)
      : null;
  }
  if (input.patch.dueAt !== undefined) {
    doc.dueAt = input.patch.dueAt ? new Date(input.patch.dueAt) : null;
  }
  if (input.patch.priority !== undefined) doc.priority = input.patch.priority;
  if (input.patch.status !== undefined) doc.status = input.patch.status;
  if (input.patch.notes !== undefined) doc.notes = input.patch.notes;
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'project_task.updated',
    entityType: 'project_task',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toTaskDto(doc);
}

export async function listAllTasks(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  status?: TaskStatus;
  assignedTo?: string;
  projectId?: string;
}): Promise<{
  data: Array<ProjectTaskDto & { projectNumber: string }>;
  meta: ReturnType<typeof paginationMeta>;
}> {
  const scope = await customerOrInspectionScopeFilter(input.auth);
  const projectIds = await ProjectModel.find(scope).distinct('_id');
  const filter: Record<string, unknown> = { projectId: { $in: projectIds } };
  if (input.status) filter.status = input.status;
  if (input.assignedTo) filter.assignedTo = input.assignedTo;
  if (input.projectId) filter.projectId = input.projectId;
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    ProjectTaskModel.find(filter).sort({ dueAt: 1, createdAt: -1 }).skip(skip).limit(limit),
    ProjectTaskModel.countDocuments(filter),
  ]);
  const projects = await ProjectModel.find({ _id: { $in: rows.map((r) => r.projectId) } })
    .select({ number: 1 })
    .lean();
  const numbers = new Map(projects.map((p) => [String(p._id), p.number]));
  return {
    data: rows.map((r) => ({ ...toTaskDto(r), projectNumber: numbers.get(String(r.projectId)) ?? '' })),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export type ProjectTimelineItem = { id: string; kind: string; title: string; detail: string; at: string };

/** Chronological activity for one project, derived from the project's own records (scope-checked). */
export async function getProjectTimeline(id: string, auth: AuthContext): Promise<ProjectTimelineItem[]> {
  const project = await findProject(id, auth);
  const [acts, tasks, orders, invoices] = await Promise.all([
    ActivityModel.find({ entityType: 'project', entityId: project._id }).lean(),
    ProjectTaskModel.find({ projectId: project._id }).lean(),
    WorkOrderModel.find({ projectId: project._id }).lean(),
    InvoiceModel.find({ projectId: project._id }).lean(),
  ]);
  const payments = await PaymentModel.find({ invoiceId: { $in: invoices.map((i) => i._id) }, status: 'recorded' }).lean();
  const money = (c: number): string => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const items: ProjectTimelineItem[] = [
    { id: `p-${project._id}`, kind: 'project', title: 'Project created', detail: project.number, at: project.createdAt.toISOString() },
    ...acts.map((a) => ({ id: `a-${a._id}`, kind: 'activity', title: a.body || a.type, detail: '', at: a.createdAt.toISOString() })),
    ...tasks.map((t) => ({ id: `t-${t._id}`, kind: 'task', title: `Task: ${t.title}`, detail: t.status.replace(/_/g, ' '), at: t.updatedAt.toISOString() })),
    ...orders.map((w) => ({ id: `w-${w._id}`, kind: 'work_order', title: `Work order ${w.number}: ${w.title}`, detail: w.status.replace(/_/g, ' '), at: w.updatedAt.toISOString() })),
    ...invoices.filter((i) => i.status !== 'draft').map((i) => ({ id: `i-${i._id}`, kind: 'invoice', title: `Invoice ${i.number} issued`, detail: money(i.totalCents), at: i.invoiceDate.toISOString() })),
    ...payments.map((p) => ({ id: `y-${p._id}`, kind: 'payment', title: 'Payment recorded', detail: `${money(p.amountCents)} · ${p.method}`, at: p.paymentDate.toISOString() })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
