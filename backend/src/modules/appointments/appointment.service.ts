import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppError, type ErrorDetails } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { createNotification } from '../notifications/notification.service.js';
import type { NotificationType } from '../notifications/notification.model.js';
import { LookupValueModel } from '../settings/lookup-value.model.js';
import { UserModel } from '../users/user.model.js';
import {
  AppointmentModel,
  INACTIVE_APPOINTMENT_STATUSES,
  type AppointmentDocument,
  type AppointmentStatus,
  type ReminderChannelStatus,
} from './appointment.model.js';

let log: Logger | undefined;
function getLog(): Logger {
  if (!log) log = createLogger();
  return log;
}

export type AuthContext = { userId: string; role: Role };

export type AppointmentDto = {
  id: string;
  title: string;
  typeKey: string;
  status: AppointmentStatus;
  customerId: string | null;
  propertyId: string | null;
  leadId: string | null;
  projectId: string | null;
  assignedTo: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  location: string;
  notes: string;
  cancellationReason: string;
  reminder: {
    emailRequested: boolean;
    smsRequested: boolean;
    internalNotifiedAt: string | null;
    emailStatus: ReminderChannelStatus;
    smsStatus: ReminderChannelStatus;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDto(doc: AppointmentDocument): AppointmentDto {
  return {
    id: doc._id.toString(),
    title: doc.title,
    typeKey: doc.typeKey,
    status: doc.status as AppointmentStatus,
    customerId: idOrNull(doc.customerId),
    propertyId: idOrNull(doc.propertyId),
    leadId: idOrNull(doc.leadId),
    projectId: idOrNull(doc.projectId),
    assignedTo: doc.assignedTo.toString(),
    startAt: doc.startAt.toISOString(),
    endAt: doc.endAt.toISOString(),
    timeZone: doc.timeZone,
    location: doc.location ?? '',
    notes: doc.notes ?? '',
    cancellationReason: doc.cancellationReason ?? '',
    reminder: {
      emailRequested: doc.reminder?.emailRequested ?? false,
      smsRequested: doc.reminder?.smsRequested ?? false,
      internalNotifiedAt: doc.reminder?.internalNotifiedAt
        ? doc.reminder.internalNotifiedAt.toISOString()
        : null,
      emailStatus: (doc.reminder?.emailStatus ?? 'not_requested') as ReminderChannelStatus,
      smsStatus: (doc.reminder?.smsStatus ?? 'not_requested') as ReminderChannelStatus,
    },
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function appointmentScopeFilter(auth: AuthContext): Record<string, unknown> {
  if (auth.role === 'admin') return {};
  return { $or: [{ assignedTo: auth.userId }, { createdBy: auth.userId }] };
}

function notFound(): AppError {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'Appointment not found.' });
}

function validationError(path: string, message: string): AppError {
  return new AppError({
    status: 400,
    code: 'VALIDATION_ERROR',
    message,
    details: [{ path, message }],
  });
}

function assertValidRange(startAt: Date, endAt: Date): void {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw validationError('startAt', 'Invalid date');
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw validationError('endAt', 'endAt must be after startAt');
  }
}

async function assertActiveAppointmentType(typeKey: string): Promise<void> {
  const row = await LookupValueModel.findOne({
    type: 'appointment_type',
    key: typeKey,
    isActive: true,
  }).select({ _id: 1 });
  if (!row) {
    throw validationError('typeKey', 'Unknown or inactive appointment type');
  }
}

async function assertActiveAssignee(userId: string): Promise<mongoose.Types.ObjectId> {
  const user = mongoose.isValidObjectId(userId)
    ? await UserModel.findOne({ _id: userId, isActive: true }).select({ _id: 1 })
    : null;
  if (!user) {
    throw new AppError({
      status: 422,
      code: 'INVALID_ASSIGNEE',
      message: 'Assignee must be an active user.',
      details: [{ path: 'assignedTo', message: 'Invalid assignee' }],
    });
  }
  return user._id;
}

function assertMayAssignTo(auth: AuthContext, assignedTo: string): void {
  if (auth.role !== 'admin' && assignedTo !== auth.userId) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'You can only assign appointments to yourself.',
    });
  }
}

/** Validate linked entities exist (and are in the caller's scope for non-admins). */
async function assertLinkedEntities(
  auth: AuthContext,
  links: { customerId?: string | null; propertyId?: string | null; leadId?: string | null },
): Promise<void> {
  if (links.customerId) {
    const filter: Record<string, unknown> = { _id: links.customerId };
    if (auth.role !== 'admin') filter.ownerId = auth.userId;
    if (!(await CustomerModel.exists(filter))) {
      throw validationError('customerId', 'Customer not found');
    }
  }
  if (links.leadId) {
    const filter: Record<string, unknown> = { _id: links.leadId };
    if (auth.role !== 'admin') filter.assignedTo = auth.userId;
    if (!(await LeadModel.exists(filter))) {
      throw validationError('leadId', 'Lead not found');
    }
  }
  if (links.propertyId) {
    if (!(await PropertyModel.exists({ _id: links.propertyId }))) {
      throw validationError('propertyId', 'Property not found');
    }
  }
}

async function findConflicts(input: {
  assignedTo: string | mongoose.Types.ObjectId;
  startAt: Date;
  endAt: Date;
  excludeId?: string;
}): Promise<AppointmentDocument[]> {
  const filter: Record<string, unknown> = {
    assignedTo: input.assignedTo,
    status: { $nin: INACTIVE_APPOINTMENT_STATUSES },
    startAt: { $lt: input.endAt },
    endAt: { $gt: input.startAt },
  };
  if (input.excludeId) filter._id = { $ne: input.excludeId };
  return AppointmentModel.find(filter).sort({ startAt: 1 }).limit(10);
}

async function assertNoConflicts(input: {
  assignedTo: string | mongoose.Types.ObjectId;
  startAt: Date;
  endAt: Date;
  excludeId?: string;
  force?: boolean;
}): Promise<void> {
  if (input.force) return;
  const conflicts = await findConflicts(input);
  if (conflicts.length === 0) return;
  const details: ErrorDetails = conflicts.map((c) => ({
    path: c._id.toString(),
    message: `${c.title} (${c.startAt.toISOString()} - ${c.endAt.toISOString()})`,
  }));
  throw new AppError({
    status: 409,
    code: 'SCHEDULE_CONFLICT',
    message: 'Assignee has an overlapping appointment.',
    details,
  });
}

async function findAppointmentInScope(id: string, auth: AuthContext): Promise<AppointmentDocument> {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const doc = await AppointmentModel.findOne({ _id: id, ...appointmentScopeFilter(auth) });
  if (!doc) throw notFound();
  return doc;
}

function assertOpen(doc: AppointmentDocument, action: string): void {
  if (INACTIVE_APPOINTMENT_STATUSES.includes(doc.status as AppointmentStatus)) {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: `Cannot ${action} an appointment that is ${doc.status}.`,
    });
  }
}

/** Best-effort notification: failures must not fail the primary operation. */
async function notifyBestEffort(
  appointment: AppointmentDocument,
  type: NotificationType,
  title: string,
  userId: mongoose.Types.ObjectId | string = appointment.assignedTo,
): Promise<boolean> {
  try {
    await createNotification({
      userId,
      type,
      title,
      link: `/app/appointments/${appointment._id.toString()}`,
    });
    return true;
  } catch (err) {
    getLog().error(
      { err, appointmentId: appointment._id.toString(), type },
      'Appointment notification failed (best-effort)',
    );
    return false;
  }
}

async function auditBestEffort(input: {
  auth: AuthContext;
  action: string;
  id: string;
  changes?: unknown;
  requestId?: string;
  ip?: string;
}): Promise<void> {
  try {
    await recordAudit({
      actorType: 'user',
      actorId: input.auth.userId,
      action: input.action,
      entityType: 'appointment',
      entityId: input.id,
      changes: input.changes,
      requestId: input.requestId,
      ip: input.ip,
    });
  } catch (err) {
    getLog().error(
      { err, appointmentId: input.id, action: input.action },
      'Appointment audit failed (best-effort)',
    );
  }
}

export async function listAppointments(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  assignedTo?: string;
  status?: string;
  typeKey?: string;
  from?: string;
  to?: string;
  customerId?: string;
  leadId?: string;
  search?: string;
}): Promise<{ data: AppointmentDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const clauses: Record<string, unknown>[] = [];
  const scope = appointmentScopeFilter(input.auth);
  if (Object.keys(scope).length > 0) clauses.push(scope);

  if (input.assignedTo) clauses.push({ assignedTo: input.assignedTo });
  if (input.status) clauses.push({ status: input.status });
  if (input.typeKey) clauses.push({ typeKey: input.typeKey });
  if (input.customerId) clauses.push({ customerId: input.customerId });
  if (input.leadId) clauses.push({ leadId: input.leadId });
  // Window filter: any appointment overlapping [from, to].
  if (input.from) clauses.push({ endAt: { $gte: new Date(input.from) } });
  if (input.to) clauses.push({ startAt: { $lte: new Date(input.to) } });
  if (input.search?.trim()) {
    const q = new RegExp(escapeRegex(input.search.trim()), 'i');
    clauses.push({ $or: [{ title: q }, { notes: q }] });
  }

  const filter = clauses.length > 0 ? { $and: clauses } : {};
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    AppointmentModel.countDocuments(filter),
    AppointmentModel.find(filter).sort({ startAt: 1, _id: 1 }).skip(skip).limit(limit),
  ]);
  return {
    data: rows.map(toDto),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function getAppointment(id: string, auth: AuthContext): Promise<AppointmentDto> {
  return toDto(await findAppointmentInScope(id, auth));
}

export async function createAppointment(input: {
  auth: AuthContext;
  title: string;
  typeKey: string;
  status?: 'scheduled' | 'confirmed';
  customerId?: string;
  propertyId?: string;
  leadId?: string;
  projectId?: string | null;
  assignedTo?: string;
  startAt: string;
  endAt: string;
  timeZone?: string;
  location?: string;
  notes?: string;
  force?: boolean;
  requestId?: string;
  ip?: string;
}): Promise<AppointmentDto> {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  assertValidRange(startAt, endAt);

  const assignedToId = input.assignedTo ?? input.auth.userId;
  assertMayAssignTo(input.auth, assignedToId);

  await assertActiveAppointmentType(input.typeKey);
  const assignedTo = await assertActiveAssignee(assignedToId);
  await assertLinkedEntities(input.auth, input);
  await assertNoConflicts({ assignedTo, startAt, endAt, force: input.force });

  const created = await AppointmentModel.create({
    title: input.title,
    typeKey: input.typeKey,
    status: input.status ?? 'scheduled',
    customerId: input.customerId,
    propertyId: input.propertyId,
    leadId: input.leadId,
    projectId: input.projectId ?? null,
    assignedTo,
    startAt,
    endAt,
    timeZone: input.timeZone ?? 'America/Chicago',
    location: input.location ?? '',
    notes: input.notes ?? '',
    createdBy: input.auth.userId,
  });

  await notifyBestEffort(created, 'appointment_assigned', 'New appointment assigned to you');
  await auditBestEffort({
    auth: input.auth,
    action: 'appointment.create',
    id: created._id.toString(),
    changes: { typeKey: created.typeKey, assignedTo: assignedTo.toString(), forced: !!input.force },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(created);
}

export async function updateAppointment(input: {
  auth: AuthContext;
  id: string;
  patch: {
    title?: string;
    typeKey?: string;
    status?: 'scheduled' | 'confirmed' | 'completed' | 'no_show';
    customerId?: string | null;
    propertyId?: string | null;
    leadId?: string | null;
    projectId?: string | null;
    assignedTo?: string;
    timeZone?: string;
    location?: string;
    notes?: string;
    force?: boolean;
  };
  requestId?: string;
  ip?: string;
}): Promise<AppointmentDto> {
  const doc = await findAppointmentInScope(input.id, input.auth);
  if (doc.status === 'cancelled') {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Cannot update a cancelled appointment.',
    });
  }
  const { patch } = input;

  if (patch.typeKey !== undefined && patch.typeKey !== doc.typeKey) {
    await assertActiveAppointmentType(patch.typeKey);
  }
  await assertLinkedEntities(input.auth, {
    customerId: patch.customerId,
    propertyId: patch.propertyId,
    leadId: patch.leadId,
  });

  let newAssignee: mongoose.Types.ObjectId | undefined;
  if (patch.assignedTo !== undefined && patch.assignedTo !== doc.assignedTo.toString()) {
    assertMayAssignTo(input.auth, patch.assignedTo);
    newAssignee = await assertActiveAssignee(patch.assignedTo);
    const nextStatus = patch.status ?? (doc.status as AppointmentStatus);
    if (!INACTIVE_APPOINTMENT_STATUSES.includes(nextStatus)) {
      await assertNoConflicts({
        assignedTo: newAssignee,
        startAt: doc.startAt,
        endAt: doc.endAt,
        excludeId: doc._id.toString(),
        force: patch.force,
      });
    }
  }

  if (patch.title !== undefined) doc.title = patch.title;
  if (patch.typeKey !== undefined) doc.typeKey = patch.typeKey;
  if (patch.status !== undefined) doc.status = patch.status;
  if (patch.customerId !== undefined) doc.set('customerId', patch.customerId ?? undefined);
  if (patch.propertyId !== undefined) doc.set('propertyId', patch.propertyId ?? undefined);
  if (patch.leadId !== undefined) doc.set('leadId', patch.leadId ?? undefined);
  if (patch.projectId !== undefined) doc.set('projectId', patch.projectId);
  if (newAssignee) doc.assignedTo = newAssignee;
  if (patch.timeZone !== undefined) doc.timeZone = patch.timeZone;
  if (patch.location !== undefined) doc.location = patch.location;
  if (patch.notes !== undefined) doc.notes = patch.notes;
  await doc.save();

  if (newAssignee) {
    await notifyBestEffort(doc, 'appointment_assigned', 'Appointment assigned to you');
  }

  const { force: _force, ...changes } = patch;
  await auditBestEffort({
    auth: input.auth,
    action: 'appointment.update',
    id: doc._id.toString(),
    changes,
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function cancelAppointment(input: {
  auth: AuthContext;
  id: string;
  reason?: string;
  requestId?: string;
  ip?: string;
}): Promise<AppointmentDto> {
  const doc = await findAppointmentInScope(input.id, input.auth);
  assertOpen(doc, 'cancel');

  doc.status = 'cancelled';
  doc.cancellationReason = input.reason ?? '';
  await doc.save();

  await notifyBestEffort(doc, 'appointment_changed', 'An appointment was cancelled');
  await auditBestEffort({
    auth: input.auth,
    action: 'appointment.cancel',
    id: doc._id.toString(),
    changes: { reason: doc.cancellationReason },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function rescheduleAppointment(input: {
  auth: AuthContext;
  id: string;
  startAt: string;
  endAt: string;
  force?: boolean;
  requestId?: string;
  ip?: string;
}): Promise<AppointmentDto> {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  assertValidRange(startAt, endAt);

  const doc = await findAppointmentInScope(input.id, input.auth);
  assertOpen(doc, 'reschedule');

  await assertNoConflicts({
    assignedTo: doc.assignedTo,
    startAt,
    endAt,
    excludeId: doc._id.toString(),
    force: input.force,
  });

  const previous = { startAt: doc.startAt.toISOString(), endAt: doc.endAt.toISOString() };
  doc.startAt = startAt;
  doc.endAt = endAt;
  await doc.save();

  await notifyBestEffort(doc, 'appointment_changed', 'An appointment was rescheduled');
  await auditBestEffort({
    auth: input.auth,
    action: 'appointment.reschedule',
    id: doc._id.toString(),
    changes: { previous, startAt: input.startAt, endAt: input.endAt, forced: !!input.force },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

/**
 * Record reminder preferences. Email (Resend) and SMS (Twilio) are not configured, so requested
 * channels are marked `not_configured`; nothing is ever reported as delivered.
 */
export async function setAppointmentReminders(input: {
  auth: AuthContext;
  id: string;
  email?: boolean;
  sms?: boolean;
  requestId?: string;
  ip?: string;
}): Promise<AppointmentDto> {
  const doc = await findAppointmentInScope(input.id, input.auth);
  assertOpen(doc, 'set reminders on');

  if (input.email !== undefined) {
    doc.set('reminder.emailRequested', input.email);
    doc.set('reminder.emailStatus', input.email ? 'not_configured' : 'not_requested');
  }
  if (input.sms !== undefined) {
    doc.set('reminder.smsRequested', input.sms);
    doc.set('reminder.smsStatus', input.sms ? 'not_configured' : 'not_requested');
  }

  const notified = await notifyBestEffort(
    doc,
    'appointment_reminder',
    'Reminder: upcoming appointment',
  );
  if (notified) doc.set('reminder.internalNotifiedAt', new Date());
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: 'appointment.reminders',
    id: doc._id.toString(),
    changes: { email: input.email, sms: input.sms },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}
