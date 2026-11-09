import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import {
  customerOrInspectionScopeFilter,
  resolveCustomerPropertyTarget,
  type AuthContext,
} from '../../services/entity-links.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import {
  MeasurementModel,
  type MeasurementDocument,
  type MeasurementProvider,
  type MeasurementProviderStatus,
  type MeasurementSource,
  type MeasurementUnits,
} from './measurement.model.js';

export type { AuthContext };

let log: Logger | undefined;
function getLog(): Logger {
  if (!log) log = createLogger();
  return log;
}

export type SolarDetail = {
  isDemo: boolean;
  revision: number;
  supersedesId: string | null;
  supersededById: string | null;
  automated: unknown;
  fieldSources: Record<string, string>;
  verified: Record<string, boolean>;
  edges: unknown;
  counts: Record<string, number>;
  corrections: unknown[];
  reportFileId: string | null;
};

export type MeasurementDto = {
  id: string;
  propertyId: string;
  inspectionId: string | null;
  customerId: string;
  source: MeasurementSource;
  provider: MeasurementProvider;
  providerStatus: MeasurementProviderStatus;
  measurementDate: string;
  units: MeasurementUnits;
  totalArea: number | null;
  facets: number | null;
  pitch: string;
  ridge: number | null;
  hip: number | null;
  valley: number | null;
  eave: number | null;
  rake: number | null;
  notes: string;
  importedFilename: string | null;
  /** Present for automated (Google Solar) and demo records; null for manual ones. */
  solar: SolarDetail | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type MeasurementFieldsInput = {
  provider?: MeasurementProvider;
  measurementDate?: string;
  units?: MeasurementUnits;
  totalArea?: number;
  facets?: number;
  pitch?: string;
  ridge?: number;
  hip?: number;
  valley?: number;
  eave?: number;
  rake?: number;
  notes?: string;
};

const NUMERIC_FIELDS = ['totalArea', 'facets', 'ridge', 'hip', 'valley', 'eave', 'rake'] as const;

export function toDto(doc: MeasurementDocument): MeasurementDto {
  return {
    id: doc._id.toString(),
    propertyId: doc.propertyId.toString(),
    inspectionId: doc.inspectionId ? doc.inspectionId.toString() : null,
    customerId: doc.customerId.toString(),
    source: doc.source as MeasurementSource,
    provider: doc.provider as MeasurementProvider,
    providerStatus: doc.providerStatus as MeasurementProviderStatus,
    measurementDate: doc.measurementDate.toISOString(),
    units: doc.units as MeasurementUnits,
    totalArea: doc.totalArea ?? null,
    facets: doc.facets ?? null,
    pitch: doc.pitch ?? '',
    ridge: doc.ridge ?? null,
    hip: doc.hip ?? null,
    valley: doc.valley ?? null,
    eave: doc.eave ?? null,
    rake: doc.rake ?? null,
    notes: doc.notes ?? '',
    importedFilename: doc.importedFilename ?? null,
    solar: doc.automated || doc.isDemo || doc.source === 'google_solar'
      ? {
          isDemo: Boolean(doc.isDemo),
          revision: doc.revision ?? 1,
          supersedesId: doc.supersedesId ? doc.supersedesId.toString() : null,
          supersededById: doc.supersededById ? doc.supersededById.toString() : null,
          automated: doc.automated ?? null,
          fieldSources: (doc.fieldSources ?? {}) as Record<string, string>,
          verified: (doc.verified ?? {}) as Record<string, boolean>,
          edges: doc.edges ?? null,
          counts: (doc.counts ?? {}) as Record<string, number>,
          corrections: (doc.corrections ?? []) as unknown[],
          reportFileId: doc.reportFileId ? doc.reportFileId.toString() : null,
        }
      : null,
    createdBy: doc.createdBy.toString(),
    // Records written outside mongoose (seed scripts, imports) may lack timestamps: fall back instead of failing the whole list.
    createdAt: (doc.createdAt ?? doc.measurementDate).toISOString(),
    updatedAt: (doc.updatedAt ?? doc.createdAt ?? doc.measurementDate).toISOString(),
  };
}

function notFound(): AppError {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'Measurement not found.' });
}

/** Salesperson scope: customer owner, or measurement linked to an inspection assigned to them. */
export async function measurementScopeFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  return customerOrInspectionScopeFilter(auth);
}

export async function findMeasurementInScope(id: string, auth: AuthContext): Promise<MeasurementDocument> {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const scope = await measurementScopeFilter(auth);
  const doc = await MeasurementModel.findOne({ _id: id, ...scope });
  if (!doc) throw notFound();
  return doc;
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
      entityType: 'measurement',
      entityId: input.id,
      changes: input.changes,
      requestId: input.requestId,
      ip: input.ip,
    });
  } catch (err) {
    getLog().error(
      { err, measurementId: input.id, action: input.action },
      'Measurement audit failed (best-effort)',
    );
  }
}

export async function listMeasurements(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  customerId?: string;
  propertyId?: string;
  inspectionId?: string;
  source?: string;
}): Promise<{ data: MeasurementDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const clauses: Record<string, unknown>[] = [];
  const scope = await measurementScopeFilter(input.auth);
  if (Object.keys(scope).length > 0) clauses.push(scope);
  if (input.customerId) clauses.push({ customerId: input.customerId });
  if (input.propertyId) clauses.push({ propertyId: input.propertyId });
  if (input.inspectionId) clauses.push({ inspectionId: input.inspectionId });
  if (input.source) clauses.push({ source: input.source });

  const filter = clauses.length > 0 ? { $and: clauses } : {};
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    MeasurementModel.countDocuments(filter),
    MeasurementModel.find(filter)
      .sort({ measurementDate: -1, _id: -1 })
      .skip(skip)
      .limit(limit),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getMeasurement(id: string, auth: AuthContext): Promise<MeasurementDto> {
  return toDto(await findMeasurementInScope(id, auth));
}

export async function createMeasurement(input: {
  auth: AuthContext;
  propertyId: string;
  customerId?: string;
  inspectionId?: string;
  /** `import` only via {@link importMeasurement}. */
  source?: MeasurementSource;
  importedFilename?: string;
  fields: MeasurementFieldsInput;
  requestId?: string;
  ip?: string;
}): Promise<MeasurementDto> {
  const target = await resolveCustomerPropertyTarget(input.auth, {
    customerId: input.customerId,
    propertyId: input.propertyId,
    inspectionId: input.inspectionId,
  });
  const { fields } = input;

  const created = await MeasurementModel.create({
    propertyId: target.propertyId,
    customerId: target.customerId,
    inspectionId: target.inspection?._id,
    source: input.source ?? 'manual',
    provider: fields.provider ?? 'none',
    // No live provider integration exists: records are always manual-only.
    providerStatus: 'manual_only',
    measurementDate: fields.measurementDate ? new Date(fields.measurementDate) : new Date(),
    units: fields.units ?? 'sq_ft',
    totalArea: fields.totalArea,
    facets: fields.facets,
    pitch: fields.pitch ?? '',
    ridge: fields.ridge,
    hip: fields.hip,
    valley: fields.valley,
    eave: fields.eave,
    rake: fields.rake,
    notes: fields.notes ?? '',
    importedFilename: input.importedFilename,
    createdBy: input.auth.userId,
  });

  await auditBestEffort({
    auth: input.auth,
    action: input.source === 'import' ? 'measurement.import' : 'measurement.create',
    id: created._id.toString(),
    changes: {
      propertyId: input.propertyId,
      source: created.source,
      provider: created.provider,
      importedFilename: input.importedFilename,
    },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(created);
}

/** Manual data entry from a file the user read; stored with source=import. Not a provider sync. */
export async function importMeasurement(input: {
  auth: AuthContext;
  propertyId: string;
  customerId?: string;
  inspectionId?: string;
  importedFilename: string;
  fields: MeasurementFieldsInput;
  requestId?: string;
  ip?: string;
}): Promise<MeasurementDto> {
  return createMeasurement({ ...input, source: 'import' });
}

export async function updateMeasurement(input: {
  auth: AuthContext;
  id: string;
  patch: MeasurementFieldsInput & { importedFilename?: string };
  requestId?: string;
  ip?: string;
}): Promise<MeasurementDto> {
  const doc = await findMeasurementInScope(input.id, input.auth);
  const { patch } = input;

  if (patch.provider !== undefined) doc.provider = patch.provider;
  if (patch.measurementDate !== undefined) doc.measurementDate = new Date(patch.measurementDate);
  if (patch.units !== undefined) doc.units = patch.units;
  if (patch.pitch !== undefined) doc.pitch = patch.pitch;
  if (patch.notes !== undefined) doc.notes = patch.notes;
  if (patch.importedFilename !== undefined) doc.importedFilename = patch.importedFilename;
  for (const field of NUMERIC_FIELDS) {
    const value = patch[field];
    if (value !== undefined) doc.set(field, value);
  }
  await doc.save();

  await auditBestEffort({
    auth: input.auth,
    action: 'measurement.update',
    id: doc._id.toString(),
    changes: patch,
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export type IntegrationStatusDto = {
  providers: Array<{ id: 'roofr' | 'eagleview' | 'hover'; status: 'not_configured'; message: string }>;
};

/** Honest status: no provider API is validated or configured. Never reports `connected`. */
export function getIntegrationStatus(): IntegrationStatusDto {
  const providers = [
    { id: 'roofr', name: 'Roofr' },
    { id: 'eagleview', name: 'EagleView' },
    { id: 'hover', name: 'HOVER' },
  ] as const;
  return {
    providers: providers.map((p) => ({
      id: p.id,
      status: 'not_configured' as const,
      message: `${p.name} live sync is not configured. Enter measurements manually or record data from a downloaded report.`,
    })),
  };
}
