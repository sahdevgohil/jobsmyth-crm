import mongoose, { type ClientSession } from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { AppError } from '../../utils/errors.js';
import { LeadModel } from '../leads/lead.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { ActivityModel, type ActivityType } from './activity.model.js';

export type AuthContext = { userId: string; role: Role };

export type ActivityDto = {
  id: string;
  entityType: string;
  entityId: string;
  type: ActivityType;
  body: string;
  dueAt: string | null;
  completedAt: string | null;
  assignedTo: string | null;
  metadata: unknown;
  createdBy: string;
  createdAt: string;
};

function toDto(doc: {
  _id: mongoose.Types.ObjectId;
  entityType: string;
  entityId: mongoose.Types.ObjectId;
  type: string;
  body?: string | null;
  dueAt?: Date | null;
  completedAt?: Date | null;
  assignedTo?: mongoose.Types.ObjectId | null;
  metadata?: unknown;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}): ActivityDto {
  return {
    id: doc._id.toString(),
    entityType: doc.entityType,
    entityId: doc.entityId.toString(),
    type: doc.type as ActivityType,
    body: doc.body ?? '',
    dueAt: doc.dueAt ? doc.dueAt.toISOString() : null,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    assignedTo: doc.assignedTo ? doc.assignedTo.toString() : null,
    metadata: doc.metadata ?? null,
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
  };
}

async function assertEntityAccess(
  entityType: 'lead' | 'customer',
  entityId: string,
  auth: AuthContext,
): Promise<void> {
  if (!mongoose.isValidObjectId(entityId)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Entity not found.' });
  }
  if (entityType === 'lead') {
    const filter: Record<string, unknown> = { _id: entityId };
    if (auth.role !== 'admin') filter.assignedTo = auth.userId;
    const lead = await LeadModel.findOne(filter).select({ _id: 1 });
    if (!lead) {
      throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Lead not found.' });
    }
    return;
  }
  const filter: Record<string, unknown> = { _id: entityId };
  if (auth.role !== 'admin') filter.ownerId = auth.userId;
  const customer = await CustomerModel.findOne(filter).select({ _id: 1 });
  if (!customer) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
}

export async function listActivities(input: {
  auth: AuthContext;
  entityType: 'lead' | 'customer';
  entityId: string;
}): Promise<ActivityDto[]> {
  await assertEntityAccess(input.entityType, input.entityId, input.auth);
  const rows = await ActivityModel.find({
    entityType: input.entityType,
    entityId: input.entityId,
  }).sort({ createdAt: -1 });
  return rows.map(toDto);
}

export async function createActivity(input: {
  auth: AuthContext;
  entityType: 'lead' | 'customer';
  entityId: string;
  type: 'note' | 'call' | 'follow_up';
  body?: string;
  dueAt?: string;
  assignedTo?: string;
  requestId?: string;
  ip?: string;
}): Promise<ActivityDto> {
  await assertEntityAccess(input.entityType, input.entityId, input.auth);
  if (input.type === 'follow_up' && !input.dueAt) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Follow-ups require a due date.',
      details: [{ path: 'dueAt', message: 'Required' }],
    });
  }
  const row = await ActivityModel.create({
    entityType: input.entityType,
    entityId: input.entityId,
    type: input.type,
    body: input.body ?? '',
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    assignedTo: input.assignedTo ?? input.auth.userId,
    createdBy: input.auth.userId,
  });
  return toDto(row);
}

export async function completeActivity(input: {
  auth: AuthContext;
  id: string;
}): Promise<ActivityDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Activity not found.' });
  }
  const row = await ActivityModel.findById(input.id);
  if (!row) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Activity not found.' });
  }
  if (row.entityType !== 'lead' && row.entityType !== 'customer') {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Activity not found.' });
  }
  await assertEntityAccess(row.entityType, row.entityId.toString(), input.auth);
  if (!row.completedAt) {
    row.completedAt = new Date();
    await row.save();
  }
  return toDto(row);
}

export async function recordSystemActivity(
  input: {
    entityType: 'lead' | 'customer';
    entityId: string;
    type: ActivityType;
    body: string;
    createdBy: string;
    metadata?: unknown;
    assignedTo?: string;
  },
  session?: ClientSession,
): Promise<void> {
  await ActivityModel.create(
    [
      {
        entityType: input.entityType,
        entityId: input.entityId,
        type: input.type,
        body: input.body,
        createdBy: input.createdBy,
        metadata: input.metadata,
        assignedTo: input.assignedTo,
      },
    ],
    { session: session ?? undefined },
  );
}

export async function countOverdueFollowUps(input: {
  auth: AuthContext;
  leadIds?: string[];
}): Promise<number> {
  const now = new Date();
  const leadFilter: Record<string, unknown> = {};
  if (input.auth.role !== 'admin') {
    leadFilter.assignedTo = input.auth.userId;
  }
  const leads = await LeadModel.find(leadFilter).select({ _id: 1 });
  const ids = leads.map((l) => l._id);
  return ActivityModel.countDocuments({
    entityType: 'lead',
    entityId: { $in: ids },
    type: 'follow_up',
    completedAt: null,
    dueAt: { $lt: now },
  });
}

export async function leadIdsWithOverdueFollowUps(auth: AuthContext): Promise<string[]> {
  const now = new Date();
  const leadFilter: Record<string, unknown> = {};
  if (auth.role !== 'admin') {
    leadFilter.assignedTo = auth.userId;
  }
  const leads = await LeadModel.find(leadFilter).select({ _id: 1 });
  const ids = leads.map((l) => l._id);
  const rows = await ActivityModel.find({
    entityType: 'lead',
    entityId: { $in: ids },
    type: 'follow_up',
    completedAt: null,
    dueAt: { $lt: now },
  }).select({ entityId: 1 });
  return [...new Set(rows.map((r) => r.entityId.toString()))];
}
