import mongoose from 'mongoose';
import { getEnv } from '../../config/env.js';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import {
  buildStorageKey,
  getStorageAdapter,
} from '../../services/storage/local-storage.adapter.js';
import type { StoredObject } from '../../services/storage/storage.types.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { InspectionModel } from '../inspections/inspection.model.js';
import { inspectionScopeFilter } from '../inspections/inspection.service.js';
import { LeadModel } from '../leads/lead.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { assertSubmissionForUpload } from '../forms/form.service.js';
import {
  ALLOWED_FILE_MIME_TYPES,
  FileModel,
  type FileCategory,
  type FileDocument,
  type FileVisibility,
} from './file.model.js';

let log: Logger | undefined;
function getLog(): Logger {
  if (!log) log = createLogger();
  return log;
}

export type AuthContext = { userId: string; role: Role };

export type FileDto = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  category: FileCategory;
  customerId: string | null;
  propertyId: string | null;
  inspectionId: string | null;
  projectId: string | null;
  leadId: string | null;
  appointmentId: string | null;
  caption: string;
  visibility: FileVisibility;
  uploadedBy: string;
  /** Authenticated API path; the object itself is never publicly addressable. */
  downloadPath: string;
  formSubmissionId: string | null;
  formFieldId: string | null;
  tag: string;
  capturedAt: string | null;
  gps: { lat: number; lng: number } | null;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
};

function idOrNull(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDto(doc: FileDocument): FileDto {
  const id = doc._id.toString();
  return {
    id,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    category: doc.category as FileCategory,
    customerId: idOrNull(doc.customerId),
    propertyId: idOrNull(doc.propertyId),
    inspectionId: idOrNull(doc.inspectionId),
    projectId: idOrNull(doc.projectId),
    leadId: idOrNull(doc.leadId),
    appointmentId: idOrNull(doc.appointmentId),
    caption: doc.caption ?? '',
    visibility: doc.visibility as FileVisibility,
    uploadedBy: doc.uploadedBy.toString(),
    downloadPath: `/api/v1/files/${id}/download`,
    formSubmissionId: idOrNull(doc.formSubmissionId),
    formFieldId: doc.formFieldId ?? null,
    tag: doc.tag ?? '',
    capturedAt: doc.capturedAt ? doc.capturedAt.toISOString() : null,
    gps: doc.gps?.lat != null && doc.gps?.lng != null ? { lat: doc.gps.lat, lng: doc.gps.lng } : null,
    clientId: doc.clientId ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function notFound(): AppError {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'File not found.' });
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
 * Salesperson scope: files they uploaded, or linked to a customer they own, a property of such a
 * customer, a lead/appointment assigned to them, or an inspection in their inspection scope.
 * Admins see everything.
 */
type FileAuth = AuthContext & { companyId?: string; permissions?: readonly string[] };

/** Files created after multi-company support carry a companyId; those must match the caller's company. */
function companyGuard(auth: FileAuth): Record<string, unknown> {
  return auth.companyId ? { $or: [{ companyId: { $exists: false } }, { companyId: new mongoose.Types.ObjectId(auth.companyId) }] } : {};
}

async function fileScopeFilter(auth: FileAuth): Promise<Record<string, unknown>> {
  const guard = companyGuard(auth);
  const inner = await roleScope(auth);
  const parts = [guard, inner].filter((x) => Object.keys(x).length > 0);
  return parts.length === 0 ? {} : parts.length === 1 ? (parts[0] as Record<string, unknown>) : { $and: parts };
}

async function roleScope(auth: AuthContext): Promise<Record<string, unknown>> {
  if (auth.role === 'admin') return {};
  const inspectionScope = await inspectionScopeFilter(auth);
  const [customerIds, leadIds, appointmentIds, inspectionIds] = await Promise.all([
    CustomerModel.find({ ownerId: auth.userId }).distinct('_id'),
    LeadModel.find({ assignedTo: auth.userId }).distinct('_id'),
    AppointmentModel.find({
      $or: [{ assignedTo: auth.userId }, { createdBy: auth.userId }],
    }).distinct('_id'),
    InspectionModel.find(inspectionScope).distinct('_id'),
  ]);
  const propertyIds = await PropertyModel.find({ customerId: { $in: customerIds } }).distinct(
    '_id',
  );
  return {
    $or: [
      { uploadedBy: auth.userId },
      { customerId: { $in: customerIds } },
      { propertyId: { $in: propertyIds } },
      { leadId: { $in: leadIds } },
      { appointmentId: { $in: appointmentIds } },
      { inspectionId: { $in: inspectionIds } },
    ],
  };
}

async function findFileInScope(id: string, auth: AuthContext): Promise<FileDocument> {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const scope = await fileScopeFilter(auth);
  const doc = await FileModel.findOne({ _id: id, ...scope });
  if (!doc) throw notFound();
  return doc;
}

type Links = {
  customerId?: string;
  propertyId?: string;
  projectId?: string;
  inspectionId?: string;
  leadId?: string;
  appointmentId?: string;
};

/** Validate linked entities exist and (for non-admins) are within the caller's scope. */
async function assertLinks(auth: AuthContext, links: Links): Promise<void> {
  const isAdmin = auth.role === 'admin';

  if (links.customerId) {
    const filter: Record<string, unknown> = { _id: links.customerId };
    if (!isAdmin) filter.ownerId = auth.userId;
    if (!(await CustomerModel.exists(filter))) {
      throw validationError('customerId', 'Customer not found');
    }
  }
  if (links.propertyId) {
    const property = await PropertyModel.findById(links.propertyId).select({ customerId: 1 });
    if (!property) throw validationError('propertyId', 'Property not found');
    if (!isAdmin && !(await CustomerModel.exists({ _id: property.customerId, ownerId: auth.userId }))) {
      throw validationError('propertyId', 'Property not found');
    }
    if (links.customerId && property.customerId.toString() !== links.customerId) {
      throw validationError('propertyId', 'Property does not belong to this customer');
    }
  }
  if (links.projectId) {
    const project = mongoose.isValidObjectId(links.projectId)
      ? await ProjectModel.findById(links.projectId).select({ customerId: 1 })
      : null;
    if (!project || (!isAdmin && !(await CustomerModel.exists({ _id: project.customerId, ownerId: auth.userId })))) {
      throw validationError('projectId', 'Project not found');
    }
  }
  if (links.leadId) {
    const filter: Record<string, unknown> = { _id: links.leadId };
    if (!isAdmin) filter.assignedTo = auth.userId;
    if (!(await LeadModel.exists(filter))) {
      throw validationError('leadId', 'Lead not found');
    }
  }
  if (links.appointmentId) {
    const filter: Record<string, unknown> = { _id: links.appointmentId };
    if (!isAdmin) filter.$or = [{ assignedTo: auth.userId }, { createdBy: auth.userId }];
    if (!(await AppointmentModel.exists(filter))) {
      throw validationError('appointmentId', 'Appointment not found');
    }
  }
  if (links.inspectionId) {
    const scope = await inspectionScopeFilter(auth);
    if (!(await InspectionModel.exists({ _id: links.inspectionId, ...scope }))) {
      throw validationError('inspectionId', 'Inspection not found');
    }
  }
}

const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decode a base64 payload (optionally a data URL) and enforce the configured size limit. */
function decodeBase64Payload(contentBase64: string, maxBytes: number): Buffer {
  const commaIndex = contentBase64.startsWith('data:') ? contentBase64.indexOf(',') : -1;
  const raw = (commaIndex >= 0 ? contentBase64.slice(commaIndex + 1) : contentBase64).replace(
    /\s+/g,
    '',
  );

  // Cheap upper bound before decoding so oversized payloads never allocate a big buffer.
  const estimatedBytes = Math.floor((raw.length * 3) / 4);
  if (estimatedBytes > maxBytes + 3) {
    throw tooLarge(maxBytes);
  }
  if (raw.length === 0 || raw.length % 4 !== 0 || !BASE64_BODY.test(raw)) {
    throw validationError('contentBase64', 'contentBase64 must be valid base64');
  }

  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length === 0) {
    throw validationError('contentBase64', 'File content is empty');
  }
  if (buffer.length > maxBytes) throw tooLarge(maxBytes);
  return buffer;
}

function tooLarge(maxBytes: number): AppError {
  return new AppError({
    status: 413,
    code: 'FILE_TOO_LARGE',
    message: `File exceeds the maximum size of ${maxBytes} bytes.`,
    details: [{ path: 'contentBase64', message: `Maximum size is ${maxBytes} bytes` }],
  });
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
      entityType: 'file',
      entityId: input.id,
      changes: input.changes,
      requestId: input.requestId,
      ip: input.ip,
    });
  } catch (err) {
    getLog().error({ err, fileId: input.id, action: input.action }, 'File audit failed (best-effort)');
  }
}

export async function listFiles(input: {
  auth: FileAuth;
  page: number;
  pageSize: number;
  category?: string;
  customerId?: string;
  propertyId?: string;
  inspectionId?: string;
  projectId?: string;
  formSubmissionId?: string;
  formFieldId?: string;
  leadId?: string;
  appointmentId?: string;
  visibility?: string;
  uploadedBy?: string;
}): Promise<{ data: FileDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const clauses: Record<string, unknown>[] = [];
  const scope = await fileScopeFilter(input.auth);
  if (Object.keys(scope).length > 0) clauses.push(scope);

  if (input.category) clauses.push({ category: input.category });
  if (input.customerId) clauses.push({ customerId: input.customerId });
  if (input.propertyId) clauses.push({ propertyId: input.propertyId });
  if (input.inspectionId) clauses.push({ inspectionId: input.inspectionId });
  if (input.projectId) clauses.push({ projectId: input.projectId });
  if (input.formSubmissionId) clauses.push({ formSubmissionId: input.formSubmissionId });
  if (input.formFieldId) clauses.push({ formFieldId: input.formFieldId });
  if (input.leadId) clauses.push({ leadId: input.leadId });
  if (input.appointmentId) clauses.push({ appointmentId: input.appointmentId });
  if (input.visibility) clauses.push({ visibility: input.visibility });
  if (input.uploadedBy) clauses.push({ uploadedBy: input.uploadedBy });

  const filter = clauses.length > 0 ? { $and: clauses } : {};
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    FileModel.countDocuments(filter),
    FileModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
  ]);
  return {
    data: rows.map(toDto),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function getFile(id: string, auth: AuthContext): Promise<FileDto> {
  return toDto(await findFileInScope(id, auth));
}

export async function uploadFile(input: {
  auth: FileAuth;
  filename: string;
  mimeType: string;
  category: FileCategory;
  contentBase64: string;
  caption?: string;
  visibility?: FileVisibility;
  customerId?: string;
  propertyId?: string;
  inspectionId?: string;
  projectId?: string;
  formSubmissionId?: string;
  formFieldId?: string;
  tag?: string;
  capturedAt?: string;
  gps?: { lat: number; lng: number };
  clientId?: string;
  leadId?: string;
  appointmentId?: string;
  requestId?: string;
  ip?: string;
}): Promise<FileDto> {
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!(ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new AppError({
      status: 415,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: `File type "${input.mimeType}" is not allowed.`,
      details: [
        {
          path: 'mimeType',
          message: `Allowed types: ${ALLOWED_FILE_MIME_TYPES.join(', ')}`,
        },
      ],
    });
  }

  // Dynamic-form photo: belongs to a submission field; retried uploads (same clientId) return the stored file.
  let submission: Awaited<ReturnType<typeof assertSubmissionForUpload>> | null = null;
  if (input.formSubmissionId) {
    if (!input.formFieldId || !input.auth.companyId) {
      throw validationError('formFieldId', 'formFieldId is required for form files');
    }
    submission = await assertSubmissionForUpload(
      { userId: input.auth.userId, companyId: input.auth.companyId, role: input.auth.role, permissions: input.auth.permissions ?? [] },
      input.formSubmissionId,
      input.formFieldId,
    );
    if (input.clientId) {
      const dup = await FileModel.findOne({ formSubmissionId: submission._id, clientId: input.clientId });
      if (dup) return toDto(dup);
    }
  }

  const buffer = decodeBase64Payload(input.contentBase64, getEnv().FILE_MAX_BYTES);

  const links: Links = {
    customerId: input.customerId,
    propertyId: input.propertyId,
    inspectionId: input.inspectionId,
    projectId: input.projectId,
    leadId: input.leadId,
    appointmentId: input.appointmentId,
  };
  if (submission) {
    links.customerId ??= submission.customerId?.toString();
    links.propertyId ??= submission.propertyId?.toString();
    links.inspectionId ??= submission.inspectionId?.toString();
    links.projectId ??= submission.projectId?.toString();
  }
  await assertLinks(input.auth, links);

  // A project document always belongs to the project's customer/property (drives scope + customer portal).
  if (links.projectId) {
    const project = await ProjectModel.findById(links.projectId).select({ customerId: 1, propertyId: 1 });
    if (project) {
      links.customerId ??= project.customerId.toString();
      links.propertyId ??= project.propertyId.toString();
    }
  }

  // Inherit customer/property from the inspection so the file is findable from either side.
  if (links.inspectionId && (!links.customerId || !links.propertyId)) {
    const inspection = await InspectionModel.findById(links.inspectionId).select({
      customerId: 1,
      propertyId: 1,
    });
    if (inspection) {
      links.customerId ??= inspection.customerId.toString();
      links.propertyId ??= inspection.propertyId.toString();
    }
  }

  const storageKey = input.auth.companyId ? `${input.auth.companyId}/${buildStorageKey(input.filename)}` : buildStorageKey(input.filename);
  const storage = getStorageAdapter();
  await storage.putObject({ key: storageKey, buffer, contentType: mimeType });

  let created: FileDocument;
  try {
    created = await FileModel.create({
      originalFilename: input.filename,
      storageKey,
      mimeType,
      sizeBytes: buffer.length,
      category: input.category,
      customerId: links.customerId,
      propertyId: links.propertyId,
      inspectionId: links.inspectionId,
      projectId: links.projectId,
      companyId: input.auth.companyId ? new mongoose.Types.ObjectId(input.auth.companyId) : undefined,
      formSubmissionId: submission?._id,
      formFieldId: submission ? input.formFieldId : undefined,
      tag: input.tag ?? '',
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : undefined,
      gps: input.gps,
      clientId: input.clientId,
      leadId: links.leadId,
      appointmentId: links.appointmentId,
      caption: input.caption ?? '',
      visibility: input.visibility ?? 'internal',
      uploadedBy: input.auth.userId,
    });
  } catch (err) {
    // Don't leave an orphaned object behind if the metadata write fails.
    await storage.deleteObject(storageKey).catch(() => undefined);
    throw err;
  }

  await auditBestEffort({
    auth: input.auth,
    action: 'file.uploaded',
    id: created._id.toString(),
    changes: {
      originalFilename: created.originalFilename,
      mimeType,
      sizeBytes: created.sizeBytes,
      category: created.category,
      customerId: links.customerId,
      propertyId: links.propertyId,
      inspectionId: links.inspectionId,
      leadId: links.leadId,
      appointmentId: links.appointmentId,
    },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(created);
}

export async function openFileForDownload(
  id: string,
  auth: AuthContext,
): Promise<{ file: FileDto; object: StoredObject }> {
  const doc = await findFileInScope(id, auth);
  const object = await getStorageAdapter().getObject(doc.storageKey);
  if (!object) {
    getLog().error({ fileId: id }, 'File metadata exists but stored object is missing');
    throw new AppError({
      status: 404,
      code: 'FILE_CONTENT_MISSING',
      message: 'File content is not available.',
    });
  }
  return { file: toDto(doc), object };
}

export async function deleteFile(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<void> {
  const doc = await findFileInScope(input.id, input.auth);

  if (input.auth.role !== 'admin' && doc.uploadedBy.toString() !== input.auth.userId) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Only an admin or the uploader can delete this file.',
    });
  }
  if (doc.visibility !== 'internal') {
    throw new AppError({
      status: 409,
      code: 'FILE_LOCKED',
      message: 'Files shared with the customer cannot be deleted.',
    });
  }
  if (doc.inspectionId) {
    const inspection = await InspectionModel.findById(doc.inspectionId).select({ status: 1 });
    if (inspection?.status === 'completed') {
      throw new AppError({
        status: 409,
        code: 'FILE_LOCKED',
        message: 'Files on a completed inspection cannot be deleted. Reopen the inspection first.',
      });
    }
  }

  await getStorageAdapter().deleteObject(doc.storageKey);
  await doc.deleteOne();

  await auditBestEffort({
    auth: input.auth,
    action: 'file.deleted',
    id: doc._id.toString(),
    changes: {
      originalFilename: doc.originalFilename,
      sizeBytes: doc.sizeBytes,
      category: doc.category,
    },
    requestId: input.requestId,
    ip: input.ip,
  });
}
