import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { CustomerModel, type CustomerDocument } from '../customers/customer.model.js';
import { PropertyModel, type PropertyDocument } from '../customers/property.model.js';
import { FileModel } from '../files/file.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { createNotification } from '../notifications/notification.service.js';
import { ensureCompanySettings } from '../settings/settings.service.js';
import { UserModel } from '../users/user.model.js';
import {
  InspectionModel,
  type InspectionDocument,
  type InspectionStatus,
} from './inspection.model.js';
import { renderInspectionReportHtml } from './inspection.report.js';

let log: Logger | undefined;
function getLog(): Logger {
  if (!log) log = createLogger();
  return log;
}

export type AuthContext = { userId: string; role: Role };

export type InspectionDto = {
  id: string;
  customerId: string;
  propertyId: string;
  appointmentId: string | null;
  leadId: string | null;
  assignedTo: string;
  inspectionDate: string;
  typeKey: string;
  status: InspectionStatus;
  roofCondition: string;
  findings: string;
  damageObservations: string;
  recommendations: string;
  notes: string;
  measurements: { totalAreaSqFt: number | null; pitch: string; notes: string };
  reportGeneratedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type MeasurementsPatch = {
  totalAreaSqFt?: number | null;
  pitch?: string;
  notes?: string;
};

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDto(doc: InspectionDocument): InspectionDto {
  return {
    id: doc._id.toString(),
    customerId: doc.customerId.toString(),
    propertyId: doc.propertyId.toString(),
    appointmentId: idOrNull(doc.appointmentId),
    leadId: idOrNull(doc.leadId),
    assignedTo: doc.assignedTo.toString(),
    inspectionDate: doc.inspectionDate.toISOString(),
    typeKey: doc.typeKey,
    status: doc.status as InspectionStatus,
    roofCondition: doc.roofCondition ?? '',
    findings: doc.findings ?? '',
    damageObservations: doc.damageObservations ?? '',
    recommendations: doc.recommendations ?? '',
    notes: doc.notes ?? '',
    measurements: {
      totalAreaSqFt: doc.measurements?.totalAreaSqFt ?? null,
      pitch: doc.measurements?.pitch ?? '',
      notes: doc.measurements?.notes ?? '',
    },
    reportGeneratedAt: doc.reportGeneratedAt ? doc.reportGeneratedAt.toISOString() : null,
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function notFound(): AppError {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'Inspection not found.' });
}

function validationError(path: string, message: string): AppError {
  return new AppError({
    status: 400,
    code: 'VALIDATION_ERROR',
    message,
    details: [{ path, message }],
  });
}

/**
 * Salesperson scope: inspections assigned to them OR belonging to a customer they own.
 * Admins see everything. Also used by the files module to scope inspection-linked files.
 */
export async function inspectionScopeFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  if (auth.role === 'admin') return {};
  const ownedCustomerIds = await CustomerModel.find({ ownerId: auth.userId }).distinct('_id');
  return {
    $or: [{ assignedTo: auth.userId }, { customerId: { $in: ownedCustomerIds } }],
  };
}

async function findInspectionInScope(id: string, auth: AuthContext): Promise<InspectionDocument> {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const scope = await inspectionScopeFilter(auth);
  const doc = await InspectionModel.findOne({ _id: id, ...scope });
  if (!doc) throw notFound();
  return doc;
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
      message: 'You can only assign inspections to yourself.',
    });
  }
}

async function assertCustomerAndProperty(
  auth: AuthContext,
  customerId: string,
  propertyId: string,
): Promise<{ customer: CustomerDocument; property: PropertyDocument }> {
  const customerFilter: Record<string, unknown> = { _id: customerId };
  if (auth.role !== 'admin') customerFilter.ownerId = auth.userId;
  const customer = await CustomerModel.findOne(customerFilter);
  if (!customer) throw validationError('customerId', 'Customer not found');

  const property = await PropertyModel.findOne({ _id: propertyId });
  if (!property) throw validationError('propertyId', 'Property not found');
  if (property.customerId.toString() !== customer._id.toString()) {
    throw validationError('propertyId', 'Property does not belong to this customer');
  }
  return { customer, property };
}

async function assertOptionalLinks(
  auth: AuthContext,
  input: { customerId: string; appointmentId?: string; leadId?: string },
): Promise<void> {
  if (input.appointmentId) {
    const filter: Record<string, unknown> = { _id: input.appointmentId };
    if (auth.role !== 'admin') filter.$or = [{ assignedTo: auth.userId }, { createdBy: auth.userId }];
    const appointment = await AppointmentModel.findOne(filter).select({ customerId: 1 });
    if (!appointment) throw validationError('appointmentId', 'Appointment not found');
    if (appointment.customerId && appointment.customerId.toString() !== input.customerId) {
      throw validationError('appointmentId', 'Appointment belongs to a different customer');
    }
  }
  if (input.leadId) {
    const filter: Record<string, unknown> = { _id: input.leadId };
    if (auth.role !== 'admin') filter.assignedTo = auth.userId;
    if (!(await LeadModel.exists(filter))) {
      throw validationError('leadId', 'Lead not found');
    }
  }
}

function applyMeasurements(doc: InspectionDocument, patch: MeasurementsPatch): void {
  if (patch.totalAreaSqFt !== undefined) {
    doc.set('measurements.totalAreaSqFt', patch.totalAreaSqFt ?? undefined);
  }
  if (patch.pitch !== undefined) doc.set('measurements.pitch', patch.pitch);
  if (patch.notes !== undefined) doc.set('measurements.notes', patch.notes);
}

/** Best-effort notification: failures must not fail the primary operation. */
async function notifyCompletedBestEffort(doc: InspectionDocument): Promise<void> {
  try {
    await createNotification({
      userId: doc.assignedTo,
      type: 'inspection_completed',
      title: 'Inspection completed',
      link: `/app/inspections/${doc._id.toString()}`,
    });
  } catch (err) {
    getLog().error(
      { err, inspectionId: doc._id.toString() },
      'Inspection notification failed (best-effort)',
    );
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
      entityType: 'inspection',
      entityId: input.id,
      changes: input.changes,
      requestId: input.requestId,
      ip: input.ip,
    });
  } catch (err) {
    getLog().error(
      { err, inspectionId: input.id, action: input.action },
      'Inspection audit failed (best-effort)',
    );
  }
}

export async function listInspections(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  status?: string;
  customerId?: string;
  propertyId?: string;
  appointmentId?: string;
  leadId?: string;
  assignedTo?: string;
  from?: string;
  to?: string;
}): Promise<{ data: InspectionDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const clauses: Record<string, unknown>[] = [];
  const scope = await inspectionScopeFilter(input.auth);
  if (Object.keys(scope).length > 0) clauses.push(scope);

  if (input.status) clauses.push({ status: input.status });
  if (input.customerId) clauses.push({ customerId: input.customerId });
  if (input.propertyId) clauses.push({ propertyId: input.propertyId });
  if (input.appointmentId) clauses.push({ appointmentId: input.appointmentId });
  if (input.leadId) clauses.push({ leadId: input.leadId });
  if (input.assignedTo) clauses.push({ assignedTo: input.assignedTo });
  if (input.from) clauses.push({ inspectionDate: { $gte: new Date(input.from) } });
  if (input.to) clauses.push({ inspectionDate: { $lte: new Date(input.to) } });

  const filter = clauses.length > 0 ? { $and: clauses } : {};
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    InspectionModel.countDocuments(filter),
    InspectionModel.find(filter).sort({ inspectionDate: -1, _id: -1 }).skip(skip).limit(limit),
  ]);
  return {
    data: rows.map(toDto),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function getInspection(id: string, auth: AuthContext): Promise<InspectionDto> {
  return toDto(await findInspectionInScope(id, auth));
}

export async function createInspection(input: {
  auth: AuthContext;
  customerId: string;
  propertyId: string;
  appointmentId?: string;
  leadId?: string;
  assignedTo?: string;
  inspectionDate?: string;
  typeKey?: string;
  roofCondition?: string;
  findings?: string;
  damageObservations?: string;
  recommendations?: string;
  notes?: string;
  measurements?: MeasurementsPatch;
  requestId?: string;
  ip?: string;
}): Promise<InspectionDto> {
  const assignedToId = input.assignedTo ?? input.auth.userId;
  assertMayAssignTo(input.auth, assignedToId);
  const assignedTo = await assertActiveAssignee(assignedToId);
  await assertCustomerAndProperty(input.auth, input.customerId, input.propertyId);
  await assertOptionalLinks(input.auth, input);

  const created = await InspectionModel.create({
    customerId: input.customerId,
    propertyId: input.propertyId,
    appointmentId: input.appointmentId,
    leadId: input.leadId,
    assignedTo,
    inspectionDate: input.inspectionDate ? new Date(input.inspectionDate) : new Date(),
    typeKey: input.typeKey ?? 'standard',
    status: 'draft',
    roofCondition: input.roofCondition ?? '',
    findings: input.findings ?? '',
    damageObservations: input.damageObservations ?? '',
    recommendations: input.recommendations ?? '',
    notes: input.notes ?? '',
    measurements: {
      totalAreaSqFt: input.measurements?.totalAreaSqFt ?? undefined,
      pitch: input.measurements?.pitch ?? '',
      notes: input.measurements?.notes ?? '',
    },
    createdBy: input.auth.userId,
  });

  await auditBestEffort({
    auth: input.auth,
    action: 'inspection.create',
    id: created._id.toString(),
    changes: {
      customerId: input.customerId,
      propertyId: input.propertyId,
      assignedTo: assignedTo.toString(),
    },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(created);
}

export async function updateInspection(input: {
  auth: AuthContext;
  id: string;
  patch: {
    assignedTo?: string;
    inspectionDate?: string;
    typeKey?: string;
    status?: 'in_progress';
    roofCondition?: string;
    findings?: string;
    damageObservations?: string;
    recommendations?: string;
    notes?: string;
    measurements?: MeasurementsPatch;
  };
  requestId?: string;
  ip?: string;
}): Promise<InspectionDto> {
  const doc = await findInspectionInScope(input.id, input.auth);
  const { patch } = input;

  if (doc.status === 'cancelled') {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Cannot update a cancelled inspection.',
    });
  }

  let reopened = false;
  if (doc.status === 'completed') {
    if (patch.status !== 'in_progress') {
      throw new AppError({
        status: 409,
        code: 'INSPECTION_COMPLETED',
        message: 'Completed inspections are read-only. An admin must reopen it first.',
      });
    }
    if (input.auth.role !== 'admin') {
      throw new AppError({
        status: 403,
        code: 'FORBIDDEN',
        message: 'Only an admin can reopen a completed inspection.',
      });
    }
    reopened = true;
  }

  let newAssignee: mongoose.Types.ObjectId | undefined;
  if (patch.assignedTo !== undefined && patch.assignedTo !== doc.assignedTo.toString()) {
    assertMayAssignTo(input.auth, patch.assignedTo);
    newAssignee = await assertActiveAssignee(patch.assignedTo);
  }

  if (patch.status === 'in_progress') doc.status = 'in_progress';
  if (newAssignee) doc.assignedTo = newAssignee;
  if (patch.inspectionDate !== undefined) doc.inspectionDate = new Date(patch.inspectionDate);
  if (patch.typeKey !== undefined) doc.typeKey = patch.typeKey;
  if (patch.roofCondition !== undefined) doc.roofCondition = patch.roofCondition;
  if (patch.findings !== undefined) doc.findings = patch.findings;
  if (patch.damageObservations !== undefined) doc.damageObservations = patch.damageObservations;
  if (patch.recommendations !== undefined) doc.recommendations = patch.recommendations;
  if (patch.notes !== undefined) doc.notes = patch.notes;
  if (patch.measurements) applyMeasurements(doc, patch.measurements);
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: reopened ? 'inspection.reopen' : 'inspection.update',
    id: doc._id.toString(),
    changes: patch,
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function completeInspection(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<InspectionDto> {
  const doc = await findInspectionInScope(input.id, input.auth);
  if (doc.status === 'completed' || doc.status === 'cancelled') {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: `Cannot complete an inspection that is ${doc.status}.`,
    });
  }

  doc.status = 'completed';
  if (!doc.reportGeneratedAt) doc.reportGeneratedAt = new Date();
  await doc.save();

  await notifyCompletedBestEffort(doc);
  await auditBestEffort({
    auth: input.auth,
    action: 'inspection.complete',
    id: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function cancelInspection(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<InspectionDto> {
  const doc = await findInspectionInScope(input.id, input.auth);
  if (doc.status === 'cancelled') {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE',
      message: 'Inspection is already cancelled.',
    });
  }
  const previousStatus = doc.status;
  doc.status = 'cancelled';
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: 'inspection.cancel',
    id: doc._id.toString(),
    changes: { previousStatus },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

/** Printable HTML report. Photos are listed as metadata only (binary is not embedded). */
export async function getInspectionReportHtml(id: string, auth: AuthContext): Promise<string> {
  const doc = await findInspectionInScope(id, auth);
  const [settings, customer, property, inspector, photos] = await Promise.all([
    ensureCompanySettings(),
    CustomerModel.findById(doc.customerId),
    PropertyModel.findById(doc.propertyId),
    UserModel.findById(doc.assignedTo).select({ firstName: 1, lastName: 1 }),
    FileModel.find({ inspectionId: doc._id, category: 'photo' }).sort({ createdAt: 1 }),
  ]);

  const customerName = customer
    ? customer.type === 'business'
      ? customer.companyName || `${customer.firstName} ${customer.lastName}`.trim()
      : `${customer.firstName} ${customer.lastName}`.trim() || customer.companyName
    : '';

  return renderInspectionReportHtml({
    company: {
      name: settings.displayName,
      phone: settings.phone ?? '',
      email: settings.email ?? '',
      website: settings.website ?? '',
      licenseText: settings.licenseText ?? '',
      timeZone: settings.timezone,
    },
    inspection: toDto(doc),
    customer: {
      name: customerName,
      email: customer?.email ?? '',
      phone: customer?.phone ?? '',
    },
    propertyAddress: property
      ? {
          line1: property.address.line1,
          line2: property.address.line2 ?? '',
          city: property.address.city ?? '',
          state: property.address.state ?? '',
          zip: property.address.zip,
        }
      : null,
    inspectorName: inspector ? `${inspector.firstName} ${inspector.lastName}`.trim() : '',
    photos: photos.map((p) => ({
      filename: p.originalFilename,
      caption: p.caption ?? '',
      uploadedAt: p.createdAt.toISOString(),
    })),
  });
}
