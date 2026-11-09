import { isDeepStrictEqual } from 'node:util';
import mongoose from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { ensureDefaultCompany } from '../companies/company.service.js';
import { FileModel } from '../files/file.model.js';
import { InspectionModel } from '../inspections/inspection.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { UserModel } from '../users/user.model.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import { DEFAULT_TEMPLATES } from './default-templates.js';
import {
  breakingChanges,
  computeDerived,
  redactSensitive,
  stripHidden,
  validateAnswers,
  validateDefinition,
  type Answers,
  type FormDefinition,
  type Issue,
} from './engine.js';
import {
  FORM_KINDS,
  FormSubmissionModel,
  FormTemplateModel,
  FormTemplateVersionModel,
  type FormKind,
  type FormSubmissionDocument,
  type FormTemplateDocument,
} from './form.model.js';

/** Authenticated caller. `companyId` always comes from the server (never the request body). */
export type FormCtx = { userId: string; companyId: string; role: Role; permissions: readonly string[] };

const notFound = (what: string): AppError => new AppError({ status: 404, code: 'NOT_FOUND', message: `${what} not found.` });
const invalid = (message: string, details?: Array<{ path: string; message: string }>): AppError =>
  new AppError({ status: 422, code: 'VALIDATION_ERROR', message, details });

const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);
const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

// ---------------------------------------------------------------- DTOs

export type TemplateDto = {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: FormKind;
  serviceType: string;
  isActive: boolean;
  systemKey: string;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  definition: FormDefinition;
  updatedAt: string;
};

function toTemplateDto(d: FormTemplateDocument, latest?: { definition: unknown }): TemplateDto {
  return {
    id: d._id.toString(),
    key: d.key,
    name: d.name,
    description: d.description ?? '',
    kind: d.kind as FormKind,
    serviceType: d.serviceType ?? '',
    isActive: d.isActive,
    systemKey: d.systemKey ?? '',
    publishedVersion: d.publishedVersion,
    hasUnpublishedChanges: d.publishedVersion === 0 || (latest ? !isDeepStrictEqual(JSON.parse(JSON.stringify(latest.definition)), JSON.parse(JSON.stringify(d.definition))) : false),
    definition: d.definition as FormDefinition,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export type SubmissionDto = {
  id: string;
  clientId: string;
  templateId: string;
  templateKey: string;
  templateVersion: number;
  kind: FormKind;
  status: 'draft' | 'completed';
  revision: number;
  answers: Answers;
  customerId: string | null;
  propertyId: string | null;
  leadId: string | null;
  appointmentId: string | null;
  inspectionId: string | null;
  projectId: string | null;
  assignedTo: string | null;
  completedAt: string | null;
  reportFileId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const idOrNull = (v: unknown): string | null => (v ? String(v) : null);

function toSubmissionDto(d: FormSubmissionDocument, answers: Answers): SubmissionDto {
  return {
    id: d._id.toString(),
    clientId: d.clientId,
    templateId: d.templateId.toString(),
    templateKey: d.templateKey,
    templateVersion: d.templateVersion,
    kind: d.kind as FormKind,
    status: d.status as 'draft' | 'completed',
    revision: d.revision,
    answers,
    customerId: idOrNull(d.customerId),
    propertyId: idOrNull(d.propertyId),
    leadId: idOrNull(d.leadId),
    appointmentId: idOrNull(d.appointmentId),
    inspectionId: idOrNull(d.inspectionId),
    projectId: idOrNull(d.projectId),
    assignedTo: idOrNull(d.assignedTo),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    reportFileId: idOrNull(d.reportFileId),
    createdBy: d.createdBy.toString(),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- company helpers

/** Company of a user; accounts that predate multi-company support belong to the default company. */
async function userCompanyId(userId: unknown): Promise<string | null> {
  if (!userId) return null;
  const u = await UserModel.findById(userId).select({ companyId: 1 }).lean();
  if (!u) return null;
  return u.companyId ? u.companyId.toString() : (await ensureDefaultCompany())._id.toString();
}

async function assertOwnerInCompany(ownerId: unknown, ctx: FormCtx, label: string): Promise<void> {
  if ((await userCompanyId(ownerId)) !== ctx.companyId) throw notFound(label);
}

export type Links = {
  customerId?: string;
  propertyId?: string;
  leadId?: string;
  appointmentId?: string;
  inspectionId?: string;
  projectId?: string;
};

/**
 * Linked CRM records must exist, belong to this company (via their owner) and, for salespeople, to
 * records they own. Cross-company ids behave exactly like missing ids (404).
 */
export async function assertLinks(ctx: FormCtx, links: Links): Promise<void> {
  const admin = ctx.role === 'admin';
  if (links.customerId) {
    if (!validId(links.customerId)) throw notFound('Customer');
    const c = await CustomerModel.findById(links.customerId).select({ ownerId: 1 }).lean();
    if (!c) throw notFound('Customer');
    await assertOwnerInCompany(c.ownerId, ctx, 'Customer');
    if (!admin && c.ownerId.toString() !== ctx.userId) throw notFound('Customer');
  }
  if (links.propertyId) {
    if (!validId(links.propertyId)) throw notFound('Property');
    const p = await PropertyModel.findById(links.propertyId).select({ customerId: 1 }).lean();
    if (!p) throw notFound('Property');
    if (links.customerId && p.customerId.toString() !== links.customerId) {
      throw invalid('Property does not belong to this customer.', [{ path: 'propertyId', message: 'Mismatch' }]);
    }
    const c = await CustomerModel.findById(p.customerId).select({ ownerId: 1 }).lean();
    if (!c) throw notFound('Property');
    await assertOwnerInCompany(c.ownerId, ctx, 'Property');
    if (!admin && c.ownerId.toString() !== ctx.userId) throw notFound('Property');
  }
  if (links.leadId) {
    const l = validId(links.leadId) ? await LeadModel.findById(links.leadId).select({ assignedTo: 1 }).lean() : null;
    if (!l) throw notFound('Lead');
    await assertOwnerInCompany(l.assignedTo, ctx, 'Lead');
    if (!admin && l.assignedTo.toString() !== ctx.userId) throw notFound('Lead');
  }
  if (links.appointmentId) {
    const a = validId(links.appointmentId) ? await AppointmentModel.findById(links.appointmentId).select({ assignedTo: 1 }).lean() : null;
    if (!a) throw notFound('Appointment');
    await assertOwnerInCompany(a.assignedTo, ctx, 'Appointment');
    if (!admin && a.assignedTo.toString() !== ctx.userId) throw notFound('Appointment');
  }
  if (links.inspectionId) {
    const i = validId(links.inspectionId) ? await InspectionModel.findById(links.inspectionId).select({ assignedTo: 1, customerId: 1 }).lean() : null;
    if (!i) throw notFound('Inspection');
    await assertOwnerInCompany(i.assignedTo, ctx, 'Inspection');
    if (!admin && i.assignedTo.toString() !== ctx.userId) throw notFound('Inspection');
  }
  if (links.projectId) {
    const pr = validId(links.projectId) ? await ProjectModel.findById(links.projectId).select({ customerId: 1 }).lean() : null;
    if (!pr) throw notFound('Project');
    const c = await CustomerModel.findById(pr.customerId).select({ ownerId: 1 }).lean();
    if (!c) throw notFound('Project');
    await assertOwnerInCompany(c.ownerId, ctx, 'Project');
    if (!admin && c.ownerId.toString() !== ctx.userId) throw notFound('Project');
  }
}

// ---------------------------------------------------------------- templates

function assertDefinition(def: unknown): asserts def is FormDefinition {
  const errors = validateDefinition(def as FormDefinition);
  if (errors.length > 0) {
    throw invalid('The form definition is invalid.', errors.map((message) => ({ path: 'definition', message })));
  }
}

/** Intake templates must keep the core field ids the intake workflow maps to the customer, property and lead. */
export const INTAKE_REQUIRED_FIELDS = ['first_name', 'last_name', 'mobile_phone', 'email', 'property_address', 'owner_or_renter', 'property_type', 'services', 'reason_for_call', 'lead_source', 'assigned_rep'] as const;

function assertIntakeCore(kind: string, def: FormDefinition): void {
  if (kind !== 'intake') return;
  const ids = new Set(def.sections.flatMap((s) => s.fields.map((f) => f.id)));
  const missing = INTAKE_REQUIRED_FIELDS.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw invalid('Intake forms must keep the core customer fields.', missing.map((id) => ({ path: 'definition', message: `Missing required intake field "${id}".` })));
  }
}

export async function listTemplates(ctx: FormCtx, q: { kind?: string; active?: boolean }): Promise<TemplateDto[]> {
  const filter: Record<string, unknown> = { companyId: oid(ctx.companyId) };
  if (q.kind) filter.kind = q.kind;
  if (q.active !== undefined) filter.isActive = q.active;
  const rows = await FormTemplateModel.find(filter).sort({ kind: 1, name: 1 });
  const out: TemplateDto[] = [];
  for (const r of rows) {
    const latest = r.publishedVersion > 0 ? await FormTemplateVersionModel.findOne({ templateId: r._id, version: r.publishedVersion }).lean() : null;
    out.push(toTemplateDto(r, latest ?? undefined));
  }
  return out;
}

async function findTemplate(ctx: FormCtx, id: string): Promise<FormTemplateDocument> {
  const t = validId(id) ? await FormTemplateModel.findOne({ _id: id, companyId: oid(ctx.companyId) }) : null;
  if (!t) throw notFound('Form template');
  return t;
}

export async function getTemplate(ctx: FormCtx, idOrKey: string): Promise<TemplateDto> {
  const raw: string = idOrKey;
  const t = validId(raw)
    ? await FormTemplateModel.findOne({ _id: raw, companyId: oid(ctx.companyId) })
    : await FormTemplateModel.findOne({ key: String(raw).toLowerCase(), companyId: oid(ctx.companyId) });
  if (!t) throw notFound('Form template');
  const latest = t.publishedVersion > 0 ? await FormTemplateVersionModel.findOne({ templateId: t._id, version: t.publishedVersion }).lean() : null;
  return toTemplateDto(t, latest ?? undefined);
}

export async function createTemplate(
  ctx: FormCtx,
  input: { key: string; name: string; description?: string; kind: FormKind; serviceType?: string; definition: FormDefinition; systemKey?: string; requestId?: string; ip?: string },
): Promise<TemplateDto> {
  assertDefinition(input.definition);
  assertIntakeCore(input.kind, input.definition);
  try {
    const t = await FormTemplateModel.create({
      companyId: oid(ctx.companyId),
      key: input.key,
      name: input.name,
      description: input.description ?? '',
      kind: input.kind,
      serviceType: input.serviceType ?? '',
      systemKey: input.systemKey ?? '',
      definition: input.definition,
      createdBy: oid(ctx.userId),
      updatedBy: oid(ctx.userId),
    });
    await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'form_template.created', entityType: 'form_template', entityId: t._id.toString(), changes: { key: t.key, kind: t.kind }, requestId: input.requestId, ip: input.ip });
    return toTemplateDto(t);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError({ status: 409, code: 'TEMPLATE_KEY_EXISTS', message: `A form with key "${input.key}" already exists.` });
    }
    throw err;
  }
}

export async function updateTemplate(
  ctx: FormCtx,
  id: string,
  patch: { name?: string; description?: string; serviceType?: string; isActive?: boolean; definition?: FormDefinition },
  meta: { requestId?: string; ip?: string } = {},
): Promise<TemplateDto & { warnings: string[] }> {
  const t = await findTemplate(ctx, id);
  const warnings: string[] = [];
  if (patch.definition) {
    assertDefinition(patch.definition);
    assertIntakeCore(t.kind, patch.definition);
    const lastPublished = t.publishedVersion > 0 ? await FormTemplateVersionModel.findOne({ templateId: t._id, version: t.publishedVersion }).lean() : null;
    if (lastPublished) warnings.push(...breakingChanges(lastPublished.definition as FormDefinition, patch.definition));
    t.definition = patch.definition;
    t.markModified('definition');
  }
  if (patch.name !== undefined) t.name = patch.name;
  if (patch.description !== undefined) t.description = patch.description;
  if (patch.serviceType !== undefined) t.serviceType = patch.serviceType;
  if (patch.isActive !== undefined) t.isActive = patch.isActive;
  t.updatedBy = oid(ctx.userId);
  await t.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'form_template.updated', entityType: 'form_template', entityId: t._id.toString(), changes: { fields: Object.keys(patch), warnings }, requestId: meta.requestId, ip: meta.ip });
  const latest = t.publishedVersion > 0 ? await FormTemplateVersionModel.findOne({ templateId: t._id, version: t.publishedVersion }).lean() : null;
  return { ...toTemplateDto(t, latest ?? undefined), warnings };
}

/** Freezes the current working definition as the next immutable version. New submissions use it; old ones keep theirs. */
export async function publishTemplate(ctx: FormCtx, id: string, changeNote: string | undefined, meta: { requestId?: string; ip?: string } = {}): Promise<TemplateDto> {
  const t = await findTemplate(ctx, id);
  assertDefinition(t.definition);
  assertIntakeCore(t.kind, t.definition as FormDefinition);
  const next = t.publishedVersion + 1;
  await FormTemplateVersionModel.create({
    companyId: t.companyId,
    templateId: t._id,
    key: t.key,
    version: next,
    name: t.name,
    kind: t.kind,
    definition: JSON.parse(JSON.stringify(t.definition)),
    changeNote: changeNote ?? '',
    publishedBy: oid(ctx.userId),
  });
  t.publishedVersion = next;
  await t.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'form_template.published', entityType: 'form_template', entityId: t._id.toString(), changes: { version: next, changeNote }, requestId: meta.requestId, ip: meta.ip });
  return toTemplateDto(t, { definition: t.definition });
}

export async function listVersions(ctx: FormCtx, id: string): Promise<Array<{ version: number; name: string; changeNote: string; publishedAt: string }>> {
  const t = await findTemplate(ctx, id);
  const rows = await FormTemplateVersionModel.find({ templateId: t._id, companyId: oid(ctx.companyId) }).sort({ version: -1 });
  return rows.map((r) => ({ version: r.version, name: r.name, changeNote: r.changeNote ?? '', publishedAt: (r.publishedAt ?? new Date()).toISOString() }));
}

export async function getVersion(ctx: FormCtx, id: string, version: number): Promise<{ version: number; name: string; kind: FormKind; definition: FormDefinition }> {
  const t = await findTemplate(ctx, id);
  const v = await FormTemplateVersionModel.findOne({ templateId: t._id, companyId: oid(ctx.companyId), version });
  if (!v) throw notFound('Form version');
  return { version: v.version, name: v.name, kind: v.kind as FormKind, definition: v.definition as FormDefinition };
}

/** Installs (or leaves untouched) the platform default templates for this company, published as v1. */
export async function installDefaultTemplates(ctx: FormCtx): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];
  for (const d of DEFAULT_TEMPLATES) {
    const found = await FormTemplateModel.findOne({ companyId: oid(ctx.companyId), key: d.key }).select({ _id: 1 });
    if (found) {
      existing.push(d.key);
      continue;
    }
    const t = await createTemplate(ctx, { key: d.key, name: d.name, description: d.description, kind: d.kind, serviceType: d.serviceType, definition: d.definition, systemKey: d.key });
    await publishTemplate(ctx, t.id, 'Installed from platform defaults');
    created.push(d.key);
  }
  return { created, existing };
}

// ---------------------------------------------------------------- submissions

function submissionScope(ctx: FormCtx): Record<string, unknown> {
  const base: Record<string, unknown> = { companyId: oid(ctx.companyId) };
  if (ctx.role === 'admin') return base;
  return { ...base, $or: [{ createdBy: oid(ctx.userId) }, { assignedTo: oid(ctx.userId) }] };
}

async function loadSubmission(ctx: FormCtx, id: string): Promise<FormSubmissionDocument> {
  const s = validId(id) ? await FormSubmissionModel.findOne({ _id: id, ...submissionScope(ctx) }) : null;
  if (!s) throw notFound('Form submission');
  return s;
}

async function versionDefinition(companyId: string, templateId: mongoose.Types.ObjectId, version: number): Promise<FormDefinition> {
  const v = await FormTemplateVersionModel.findOne({ companyId: oid(companyId), templateId, version });
  if (!v) throw notFound('Form version');
  return v.definition as FormDefinition;
}

/** Unknown ids are rejected (hidden-field answers are stripped silently, unknown ones are client bugs or stale versions). */
function assertKnownFields(def: FormDefinition, answers: Answers): void {
  const known = new Set(def.sections.flatMap((x) => x.fields.map((f) => f.id)));
  const unknown = Object.keys(answers).filter((k) => !known.has(k));
  if (unknown.length > 0) throw invalid('Some answers are invalid.', unknown.map((k) => ({ path: k, message: 'Unknown field for this form version.' })));
}

function present(ctx: FormCtx, d: FormSubmissionDocument, def: FormDefinition): SubmissionDto {
  const answers = (d.answers ?? {}) as Answers;
  return toSubmissionDto(d, ctx.permissions.includes('intake:sensitive') ? answers : redactSensitive(def, answers));
}

async function photoCounts(submissionId: mongoose.Types.ObjectId): Promise<{ counts: Record<string, number>; fileIds: Set<string> }> {
  const rows = await FileModel.find({ formSubmissionId: submissionId }).select({ formFieldId: 1 }).lean();
  const counts: Record<string, number> = {};
  const fileIds = new Set<string>();
  for (const r of rows) {
    fileIds.add(r._id.toString());
    if (r.formFieldId) counts[r.formFieldId] = (counts[r.formFieldId] ?? 0) + 1;
  }
  return { counts, fileIds };
}

export type CreateSubmissionInput = {
  clientId: string;
  templateKey?: string;
  templateId?: string;
  /** Offline clients send the version they rendered; it is honoured if that version exists. */
  templateVersion?: number;
  answers?: Answers;
  links?: Links;
  assignedTo?: string;
  clientCreatedAt?: string;
  requestId?: string;
  ip?: string;
};

async function resolveTemplate(ctx: FormCtx, input: { templateKey?: string; templateId?: string }): Promise<FormTemplateDocument> {
  const t = input.templateId && validId(input.templateId)
    ? await FormTemplateModel.findOne({ _id: input.templateId, companyId: oid(ctx.companyId) })
    : input.templateKey
      ? await FormTemplateModel.findOne({ key: input.templateKey.toLowerCase(), companyId: oid(ctx.companyId) })
      : null;
  if (!t) throw notFound('Form template');
  if (t.publishedVersion === 0) throw new AppError({ status: 409, code: 'TEMPLATE_NOT_PUBLISHED', message: 'This form has not been published yet.' });
  return t;
}

/** Idempotent on (company, clientId): retrying the same offline create returns the original record. */
export async function createSubmission(ctx: FormCtx, input: CreateSubmissionInput): Promise<{ created: boolean; submission: SubmissionDto }> {
  const existing = await FormSubmissionModel.findOne({ companyId: oid(ctx.companyId), clientId: input.clientId });
  if (existing) {
    // A clientId belongs to whoever created it; never reveal another user's draft.
    if (ctx.role !== 'admin' && existing.createdBy.toString() !== ctx.userId) throw notFound('Form submission');
    const def = await versionDefinition(ctx.companyId, existing.templateId, existing.templateVersion);
    return { created: false, submission: present(ctx, existing, def) };
  }
  const t = await resolveTemplate(ctx, input);
  if (!t.isActive) throw new AppError({ status: 409, code: 'TEMPLATE_INACTIVE', message: 'This form is turned off.' });
  const version = input.templateVersion && input.templateVersion <= t.publishedVersion ? input.templateVersion : t.publishedVersion;
  const def = await versionDefinition(ctx.companyId, t._id, version);
  const links = input.links ?? {};
  await assertLinks(ctx, links);
  const assignedTo = input.assignedTo ?? ctx.userId;
  if (assignedTo !== ctx.userId) {
    if (ctx.role !== 'admin') throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'Only admins can assign a submission to someone else.' });
    await assertOwnerInCompany(assignedTo, ctx, 'User');
  }
  assertKnownFields(def, input.answers ?? {});
  const answers = computeDerived(def, stripHidden(def, input.answers ?? {}));
  const issues = validateAnswers(def, answers, { mode: 'draft' });
  if (issues.length > 0) throw invalid('Some answers are invalid.', issues.map((i) => ({ path: i.fieldId, message: i.message })));
  try {
    const doc = await FormSubmissionModel.create({
      companyId: oid(ctx.companyId),
      clientId: input.clientId,
      templateId: t._id,
      templateKey: t.key,
      templateVersion: version,
      kind: t.kind,
      answers,
      customerId: links.customerId ? oid(links.customerId) : undefined,
      propertyId: links.propertyId ? oid(links.propertyId) : undefined,
      leadId: links.leadId ? oid(links.leadId) : undefined,
      appointmentId: links.appointmentId ? oid(links.appointmentId) : undefined,
      inspectionId: links.inspectionId ? oid(links.inspectionId) : undefined,
      projectId: links.projectId ? oid(links.projectId) : undefined,
      assignedTo: oid(assignedTo),
      createdBy: oid(ctx.userId),
      clientCreatedAt: input.clientCreatedAt ? new Date(input.clientCreatedAt) : undefined,
    });
    await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'form_submission.created', entityType: 'form_submission', entityId: doc._id.toString(), changes: { template: t.key, version }, requestId: input.requestId, ip: input.ip });
    return { created: true, submission: present(ctx, doc, def) };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const raced = await FormSubmissionModel.findOne({ companyId: oid(ctx.companyId), clientId: input.clientId });
      if (raced) return { created: false, submission: present(ctx, raced, def) };
    }
    throw err;
  }
}

export class RevisionConflict extends AppError {
  constructor(public readonly server: SubmissionDto) {
    super({ status: 409, code: 'REVISION_CONFLICT', message: 'This form was changed elsewhere. Review the differences before saving.' });
  }
}

export async function getSubmission(ctx: FormCtx, id: string): Promise<SubmissionDto> {
  const s = await loadSubmission(ctx, id);
  return present(ctx, s, await versionDefinition(ctx.companyId, s.templateId, s.templateVersion));
}

/** Saves answers. `expectedRevision` (the revision the client last saw) protects against silently overwriting newer data. */
export async function updateSubmission(
  ctx: FormCtx,
  id: string,
  input: { answers: Answers; expectedRevision?: number; links?: Links; requestId?: string; ip?: string },
): Promise<{ changed: boolean; submission: SubmissionDto }> {
  const s = await loadSubmission(ctx, id);
  const def = await versionDefinition(ctx.companyId, s.templateId, s.templateVersion);
  if (s.status === 'completed') throw new AppError({ status: 409, code: 'SUBMISSION_COMPLETED', message: 'Completed forms cannot be edited.' });
  if (input.expectedRevision !== undefined && input.expectedRevision !== s.revision) throw new RevisionConflict(present(ctx, s, def));
  // The "[restricted]" mask a user without intake:sensitive sees must never overwrite the real value.
  // Entering a new sensitive value is allowed (reps collect policy numbers); only reading is restricted.
  const current = (s.answers ?? {}) as Answers;
  const incoming: Answers = { ...input.answers };
  assertKnownFields(def, incoming);
  for (const f of def.sections.flatMap((x) => x.fields)) {
    if (f.sensitive && incoming[f.id] === '[restricted]') {
      if (f.id in current) incoming[f.id] = current[f.id];
      else delete incoming[f.id];
    }
  }
  const answers = computeDerived(def, stripHidden(def, incoming));
  const issues = validateAnswers(def, answers, { mode: 'draft' });
  if (issues.length > 0) throw invalid('Some answers are invalid.', issues.map((i) => ({ path: i.fieldId, message: i.message })));
  if (input.links) {
    await assertLinks(ctx, input.links);
    for (const [k, v] of Object.entries(input.links)) if (v) (s as unknown as Record<string, unknown>)[k] = oid(v);
  }
  if (isDeepStrictEqual(JSON.parse(JSON.stringify(current)), JSON.parse(JSON.stringify(answers))) && !input.links) {
    return { changed: false, submission: present(ctx, s, def) };
  }
  s.answers = answers;
  s.markModified('answers');
  s.revision += 1;
  await s.save();
  return { changed: true, submission: present(ctx, s, def) };
}

export async function completeSubmission(
  ctx: FormCtx,
  id: string,
  input: { expectedRevision?: number; requestId?: string; ip?: string },
): Promise<SubmissionDto> {
  const s = await loadSubmission(ctx, id);
  const def = await versionDefinition(ctx.companyId, s.templateId, s.templateVersion);
  if (s.status === 'completed') return present(ctx, s, def);
  if (input.expectedRevision !== undefined && input.expectedRevision !== s.revision) throw new RevisionConflict(present(ctx, s, def));
  const answers = computeDerived(def, stripHidden(def, (s.answers ?? {}) as Answers));
  const { counts, fileIds } = await photoCounts(s._id);
  const issues: Issue[] = validateAnswers(def, answers, { mode: 'complete', photoCounts: counts, fileIds });
  if (issues.length > 0) {
    throw invalid('The form is not complete.', issues.map((i) => ({ path: i.fieldId, message: i.message })));
  }
  s.answers = answers;
  s.markModified('answers');
  s.status = 'completed';
  s.completedAt = new Date();
  s.completedBy = oid(ctx.userId);
  s.revision += 1;
  await s.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'form_submission.completed', entityType: 'form_submission', entityId: s._id.toString(), changes: { template: s.templateKey, version: s.templateVersion }, requestId: input.requestId, ip: input.ip });
  return present(ctx, s, def);
}

export async function listSubmissions(
  ctx: FormCtx,
  q: { customerId?: string; propertyId?: string; inspectionId?: string; templateKey?: string; status?: string; kind?: string; page: number; pageSize: number },
): Promise<{ data: SubmissionDto[]; total: number }> {
  const filter: Record<string, unknown> = { ...submissionScope(ctx) };
  if (q.customerId && validId(q.customerId)) filter.customerId = oid(q.customerId);
  if (q.propertyId && validId(q.propertyId)) filter.propertyId = oid(q.propertyId);
  if (q.inspectionId && validId(q.inspectionId)) filter.inspectionId = oid(q.inspectionId);
  if (q.templateKey) filter.templateKey = q.templateKey;
  if (q.status) filter.status = q.status;
  if (q.kind && (FORM_KINDS as readonly string[]).includes(q.kind)) filter.kind = q.kind;
  const [rows, total] = await Promise.all([
    FormSubmissionModel.find(filter).sort({ updatedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
    FormSubmissionModel.countDocuments(filter),
  ]);
  // Lists never include answers (they may hold sensitive intake or insurance data).
  return { data: rows.map((r) => toSubmissionDto(r, {})), total };
}

// ---------------------------------------------------------------- offline sync

export type SyncInput = {
  clientId: string;
  templateKey: string;
  templateVersion?: number;
  answers: Answers;
  /** Revision the device last saw from the server (0/undefined for a never-synced draft). */
  baseRevision?: number;
  links?: Links;
  complete?: boolean;
  clientCreatedAt?: string;
  requestId?: string;
  ip?: string;
};

export type SyncResult =
  | { status: 'created' | 'updated' | 'unchanged' | 'completed'; submission: SubmissionDto }
  | { status: 'conflict'; submission: SubmissionDto }
  | { status: 'invalid'; issues: Issue[]; submission?: SubmissionDto };

/**
 * One idempotent call per offline submission: create-or-update with conflict detection.
 * Retrying the same payload yields `unchanged`; a stale `baseRevision` yields `conflict` (nothing is overwritten).
 */
export async function syncSubmission(ctx: FormCtx, input: SyncInput): Promise<SyncResult> {
  try {
    let created = false;
    let sub: SubmissionDto;
    const existing = await FormSubmissionModel.findOne({ companyId: oid(ctx.companyId), clientId: input.clientId });
    if (!existing) {
      const r = await createSubmission(ctx, { clientId: input.clientId, templateKey: input.templateKey, templateVersion: input.templateVersion, answers: input.answers, links: input.links, clientCreatedAt: input.clientCreatedAt, requestId: input.requestId, ip: input.ip });
      created = r.created;
      sub = r.submission;
    } else {
      sub = await getSubmission(ctx, existing._id.toString());
      if (sub.status === 'completed') {
        const same = isDeepStrictEqual(JSON.parse(JSON.stringify(sub.answers)), JSON.parse(JSON.stringify(input.answers)));
        return same ? { status: 'unchanged', submission: sub } : { status: 'conflict', submission: sub };
      }
      if ((input.baseRevision ?? 0) !== sub.revision) {
        // Same content already stored (a retry after a lost response) is not a conflict.
        const def = await versionDefinition(ctx.companyId, new mongoose.Types.ObjectId(sub.templateId), sub.templateVersion);
        const incoming = computeDerived(def, stripHidden(def, input.answers));
        if (!isDeepStrictEqual(JSON.parse(JSON.stringify(sub.answers)), JSON.parse(JSON.stringify(incoming)))) return { status: 'conflict', submission: sub };
      } else {
        const r = await updateSubmission(ctx, sub.id, { answers: input.answers, expectedRevision: sub.revision, links: input.links, requestId: input.requestId, ip: input.ip });
        sub = r.submission;
        if (!input.complete) return { status: r.changed ? 'updated' : 'unchanged', submission: sub };
      }
    }
    if (input.complete) {
      const done = await completeSubmission(ctx, sub.id, { requestId: input.requestId, ip: input.ip });
      return { status: 'completed', submission: done };
    }
    return { status: created ? 'created' : 'unchanged', submission: sub };
  } catch (err) {
    if (err instanceof RevisionConflict) return { status: 'conflict', submission: err.server };
    if (err instanceof AppError && err.status === 422 && err.details) {
      return { status: 'invalid', issues: err.details.map((d) => ({ fieldId: d.path, message: d.message })) };
    }
    throw err;
  }
}

/** Used by file upload: the submission a photo is attached to must be in the caller's scope and not completed. */
export async function assertSubmissionForUpload(ctx: FormCtx, submissionId: string, fieldId: string): Promise<FormSubmissionDocument> {
  const s = await loadSubmission(ctx, submissionId);
  if (s.status === 'completed') throw new AppError({ status: 409, code: 'SUBMISSION_COMPLETED', message: 'Completed forms cannot receive new files.' });
  const def = await versionDefinition(ctx.companyId, s.templateId, s.templateVersion);
  const field = def.sections.flatMap((x) => x.fields).find((f) => f.id === fieldId);
  if (!field || !['photos', 'signature', 'file', 'condition_rating'].includes(field.type)) {
    throw invalid('This field does not accept files.', [{ path: 'formFieldId', message: 'Unknown or non-file field' }]);
  }
  return s;
}
