import mongoose, { type ClientSession } from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import { buildAddressKey, normalizeEmail } from '../../utils/address-key.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { normalizePhoneE164 } from '../../utils/phone.js';
import * as activityService from '../activities/activity.service.js';
import * as customerService from '../customers/customer.service.js';
import { createNotification } from '../notifications/notification.service.js';
import { LookupValueModel } from '../settings/lookup-value.model.js';
import {
  getDefaultOpenLeadStage,
  getLeadStageById,
  getWonLeadStage,
} from '../settings/pipeline-stage.service.js';
import {
  assertAssignableSalesperson,
  assignRoundRobin,
} from './lead-assignment.service.js';
import { LeadModel, type LeadDocument } from './lead.model.js';

let log: Logger | undefined;
function getLog(): Logger {
  if (!log) log = createLogger();
  return log;
}

export type AuthContext = { userId: string; role: Role };

export type LeadDto = {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  sourceKey: string;
  stageId: string;
  assignedTo: string;
  serviceInterestKey: string;
  priority: 'low' | 'normal' | 'high';
  referredByCustomerId: string | null;
  possibleDuplicateOf: Array<{ entityType: string; entityId: string }>;
  lostReasonKey: string | null;
  convertedCustomerId: string | null;
  convertedAt: string | null;
  notes: string;
  hasOverdueFollowUp?: boolean;
  createdAt: string;
  updatedAt: string;
};

function leadScopeFilter(auth: AuthContext): Record<string, unknown> {
  if (auth.role === 'admin') return {};
  return { assignedTo: auth.userId };
}

function toDto(doc: LeadDocument, overdueIds?: Set<string>): LeadDto {
  return {
    id: doc._id.toString(),
    firstName: doc.firstName ?? '',
    lastName: doc.lastName ?? '',
    companyName: doc.companyName ?? '',
    email: doc.email ?? '',
    phone: doc.phone ?? '',
    address: {
      line1: doc.address?.line1 ?? '',
      line2: doc.address?.line2 ?? '',
      city: doc.address?.city ?? '',
      state: doc.address?.state ?? '',
      zip: doc.address?.zip ?? '',
    },
    sourceKey: doc.sourceKey,
    stageId: doc.stageId.toString(),
    assignedTo: doc.assignedTo.toString(),
    serviceInterestKey: doc.serviceInterestKey ?? '',
    priority: (doc.priority as LeadDto['priority'] | undefined) ?? 'normal',
    referredByCustomerId: doc.referredByCustomerId
      ? doc.referredByCustomerId.toString()
      : null,
    possibleDuplicateOf: (doc.possibleDuplicateOf ?? []).map((d) => ({
      entityType: d.entityType,
      entityId: d.entityId.toString(),
    })),
    lostReasonKey: doc.lostReasonKey ?? null,
    convertedCustomerId: doc.convertedCustomerId
      ? doc.convertedCustomerId.toString()
      : null,
    convertedAt: doc.convertedAt ? doc.convertedAt.toISOString() : null,
    notes: doc.notes ?? '',
    hasOverdueFollowUp: overdueIds?.has(doc._id.toString()) ?? false,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function validateLeadIdentity(input: {
  firstName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
}): void {
  if (!input.firstName?.trim() && !input.companyName?.trim()) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'First name or company name is required.',
      details: [{ path: 'firstName', message: 'Provide first name or company name' }],
    });
  }
  if (!input.phone?.trim() && !input.email?.trim()) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Phone or email is required.',
      details: [{ path: 'phone', message: 'Provide phone or email' }],
    });
  }
}

function normalizeLeadContact(input: { phone?: string; email?: string }): {
  phone: string;
  phoneE164: string | null;
  email: string;
  emailNormalized: string | null;
} {
  const phone = input.phone?.trim() ?? '';
  const email = input.email?.trim() ?? '';
  let phoneE164: string | null = null;
  if (phone) {
    phoneE164 = normalizePhoneE164(phone);
    if (!phoneE164) {
      throw new AppError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid phone number.',
        details: [{ path: 'phone', message: 'Invalid phone number' }],
      });
    }
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid email address.',
      details: [{ path: 'email', message: 'Invalid email address' }],
    });
  }
  return { phone, phoneE164, email, emailNormalized: normalizeEmail(email) };
}

async function assertActiveLookup(type: string, key: string): Promise<void> {
  const row = await LookupValueModel.findOne({ type, key, isActive: true });
  if (!row) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: `Invalid or inactive ${type}.`,
      details: [{ path: type === 'lead_source' ? 'sourceKey' : 'key', message: 'Unknown value' }],
    });
  }
}

async function findLeadInScope(
  id: string,
  auth: AuthContext,
  session?: ClientSession,
): Promise<LeadDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Lead not found.' });
  }
  const doc = await LeadModel.findOne({
    _id: id,
    ...leadScopeFilter(auth),
  }).session(session ?? null);
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Lead not found.' });
  }
  return doc;
}

export async function findDuplicateMatches(input: {
  phone?: string;
  email?: string;
  address?: { line1?: string; zip?: string };
}): Promise<Array<{ entityType: 'lead' | 'customer'; id: string; label: string }>> {
  return customerService.findDuplicateMatches(input);
}

export async function listLeads(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  stageId?: string;
  sourceKey?: string;
  assignedTo?: string;
  createdFrom?: string;
  createdTo?: string;
  hasOverdueFollowUp?: boolean;
  search?: string;
}): Promise<{ data: LeadDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const filter: Record<string, unknown> = { ...leadScopeFilter(input.auth) };
  if (input.stageId) filter.stageId = input.stageId;
  if (input.sourceKey) filter.sourceKey = input.sourceKey;
  if (input.assignedTo && input.auth.role === 'admin') filter.assignedTo = input.assignedTo;
  if (input.createdFrom || input.createdTo) {
    const createdAt: Record<string, Date> = {};
    if (input.createdFrom) createdAt.$gte = new Date(input.createdFrom);
    if (input.createdTo) createdAt.$lte = new Date(input.createdTo);
    filter.createdAt = createdAt;
  }
  if (input.search?.trim()) {
    const q = escapeRegex(input.search.trim());
    filter.$or = [
      { firstName: new RegExp(q, 'i') },
      { lastName: new RegExp(q, 'i') },
      { companyName: new RegExp(q, 'i') },
      { email: new RegExp(q, 'i') },
      { phone: new RegExp(q, 'i') },
      { 'address.line1': new RegExp(q, 'i') },
    ];
  }

  const overdueIds = new Set(await activityService.leadIdsWithOverdueFollowUps(input.auth));
  if (input.hasOverdueFollowUp) {
    filter._id = { $in: [...overdueIds] };
  }

  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    LeadModel.countDocuments(filter),
    LeadModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  return {
    data: rows.map((r) => toDto(r, overdueIds)),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function getLead(id: string, auth: AuthContext): Promise<LeadDto> {
  const overdueIds = new Set(await activityService.leadIdsWithOverdueFollowUps(auth));
  return toDto(await findLeadInScope(id, auth), overdueIds);
}

export async function createLead(input: {
  auth: AuthContext;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  sourceKey: string;
  serviceInterestKey?: string;
  priority?: 'low' | 'normal' | 'high';
  referredByCustomerId?: string;
  notes?: string;
  assignedTo?: string;
  stageId?: string;
  possibleDuplicateOf?: Array<{ entityType: 'lead' | 'customer'; entityId: string }>;
  externalSubmissionId?: string;
  notify?: boolean;
  requestId?: string;
  ip?: string;
  actorType?: 'user' | 'system';
  session?: ClientSession;
}): Promise<LeadDto> {
  validateLeadIdentity(input);
  await assertActiveLookup('lead_source', input.sourceKey);
  if (input.serviceInterestKey) {
    await assertActiveLookup('project_category', input.serviceInterestKey);
  }

  const contact = normalizeLeadContact(input);
  const address = {
    line1: input.address?.line1 ?? '',
    line2: input.address?.line2 ?? '',
    city: input.address?.city ?? '',
    state: input.address?.state ?? '',
    zip: input.address?.zip ?? '',
  };

  let assignedTo: mongoose.Types.ObjectId;
  if (input.auth.role === 'salesperson') {
    assignedTo = new mongoose.Types.ObjectId(input.auth.userId);
  } else if (input.assignedTo) {
    assignedTo = await assertAssignableSalesperson(input.assignedTo, input.session);
  } else {
    assignedTo = await assignRoundRobin(input.session);
  }

  const stage = input.stageId
    ? await getLeadStageById(input.stageId)
    : await getDefaultOpenLeadStage();
  if (!stage.isActive) {
    throw new AppError({
      status: 422,
      code: 'STAGE_INACTIVE',
      message: 'Cannot create a lead in an inactive stage.',
    });
  }
  if (stage.category === 'won') {
    throw new AppError({
      status: 422,
      code: 'USE_CONVERT',
      message: 'Use convert to place a lead in the won stage.',
    });
  }

  const payload = {
    firstName: input.firstName?.trim() ?? '',
    lastName: input.lastName?.trim() ?? '',
    companyName: input.companyName?.trim() ?? '',
    ...contact,
    address,
    addressKey: buildAddressKey(address),
    sourceKey: input.sourceKey,
    stageId: stage._id,
    assignedTo,
    serviceInterestKey: input.serviceInterestKey ?? '',
    priority: input.priority ?? 'normal',
    referredByCustomerId: input.referredByCustomerId ?? null,
    possibleDuplicateOf: input.possibleDuplicateOf ?? [],
    notes: input.notes ?? '',
    createdBy: input.auth.userId !== 'system' ? input.auth.userId : undefined,
    ...(input.externalSubmissionId
      ? { externalSubmissionId: input.externalSubmissionId }
      : {}),
  };

  const created = input.session
    ? (await LeadModel.create([payload], { session: input.session }))[0]!
    : await LeadModel.create(payload);

  await activityService.recordSystemActivity(
    {
      entityType: 'lead',
      entityId: created._id.toString(),
      type: 'assignment',
      body: 'Lead assigned',
      createdBy: input.auth.userId === 'system' ? assignedTo.toString() : input.auth.userId,
      assignedTo: assignedTo.toString(),
      metadata: { assignedTo: assignedTo.toString() },
    },
    input.session,
  );

  await recordAudit({
    actorType: input.actorType ?? 'user',
    actorId: input.auth.userId === 'system' ? undefined : input.auth.userId,
    action: 'lead.created',
    entityType: 'lead',
    entityId: created._id.toString(),
    changes: { assignedTo: assignedTo.toString(), sourceKey: input.sourceKey },
    requestId: input.requestId,
    ip: input.ip,
    session: input.session,
  });

  if (input.notify !== false) {
    await createNotification(
      {
        userId: assignedTo,
        type: 'lead_assigned',
        title: 'New lead assigned to you',
        link: `/app/leads/${created._id.toString()}`,
      },
      input.session,
    );
  }

  return toDto(created);
}

export async function updateLead(input: {
  auth: AuthContext;
  id: string;
  patch: Record<string, unknown>;
  requestId?: string;
  ip?: string;
}): Promise<LeadDto> {
  const doc = await findLeadInScope(input.id, input.auth);
  if (doc.convertedCustomerId) {
    throw new AppError({
      status: 409,
      code: 'LEAD_CONVERTED',
      message: 'Converted leads cannot be edited.',
    });
  }
  const before = toDto(doc);

  if (input.patch.firstName !== undefined) doc.firstName = String(input.patch.firstName);
  if (input.patch.lastName !== undefined) doc.lastName = String(input.patch.lastName);
  if (input.patch.companyName !== undefined) doc.companyName = String(input.patch.companyName);
  if (input.patch.notes !== undefined) doc.notes = String(input.patch.notes);
  if (input.patch.serviceInterestKey !== undefined) {
    doc.serviceInterestKey = String(input.patch.serviceInterestKey);
  }
  if (input.patch.priority !== undefined) {
    doc.priority = String(input.patch.priority) as 'low' | 'normal' | 'high';
  }
  if (input.patch.sourceKey !== undefined) {
    await assertActiveLookup('lead_source', String(input.patch.sourceKey));
    doc.sourceKey = String(input.patch.sourceKey);
  }
  if (input.patch.address !== undefined) {
    const a = input.patch.address as Record<string, string>;
    doc.address = {
      line1: a.line1 ?? '',
      line2: a.line2 ?? '',
      city: a.city ?? '',
      state: a.state ?? '',
      zip: a.zip ?? '',
    };
    doc.addressKey = buildAddressKey(doc.address);
  }
  if (input.patch.phone !== undefined || input.patch.email !== undefined) {
    const contact = normalizeLeadContact({
      phone: (input.patch.phone as string | undefined) ?? doc.phone,
      email: (input.patch.email as string | undefined) ?? doc.email,
    });
    Object.assign(doc, contact);
  }

  validateLeadIdentity({
    firstName: doc.firstName,
    companyName: doc.companyName,
    phone: doc.phone,
    email: doc.email,
  });

  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'lead.updated',
    entityType: 'lead',
    entityId: doc._id.toString(),
    changes: { before, after: toDto(doc) },
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(doc);
}

export async function changeStage(input: {
  auth: AuthContext;
  id: string;
  stageId: string;
  lostReasonKey?: string;
  requestId?: string;
  ip?: string;
}): Promise<LeadDto> {
  const doc = await findLeadInScope(input.id, input.auth);
  if (doc.convertedCustomerId) {
    throw new AppError({
      status: 409,
      code: 'LEAD_CONVERTED',
      message: 'Converted leads cannot change stage.',
    });
  }
  const stage = await getLeadStageById(input.stageId);
  if (!stage.isActive) {
    throw new AppError({
      status: 422,
      code: 'STAGE_INACTIVE',
      message: 'Cannot move lead to an inactive stage.',
    });
  }
  if (stage.category === 'lost') {
    if (!input.lostReasonKey) {
      throw new AppError({
        status: 422,
        code: 'LOST_REASON_REQUIRED',
        message: 'A lost reason is required.',
        details: [{ path: 'lostReasonKey', message: 'Required' }],
      });
    }
    await assertActiveLookup('lost_reason', input.lostReasonKey);
    doc.lostReasonKey = input.lostReasonKey;
  } else {
    doc.lostReasonKey = null;
  }
  if (stage.category === 'won') {
    throw new AppError({
      status: 422,
      code: 'USE_CONVERT',
      message: 'Use convert to move a lead to the won stage.',
    });
  }

  const previousStageId = doc.stageId.toString();
  doc.stageId = stage._id;
  await doc.save();

  await activityService.recordSystemActivity({
    entityType: 'lead',
    entityId: doc._id.toString(),
    type: 'stage_change',
    body: `Stage changed to ${stage.name}`,
    createdBy: input.auth.userId,
    metadata: { previousStageId, newStageId: stage._id.toString(), lostReasonKey: doc.lostReasonKey },
  });

  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'lead.stage_changed',
    entityType: 'lead',
    entityId: doc._id.toString(),
    changes: { previousStageId, newStageId: stage._id.toString(), lostReasonKey: doc.lostReasonKey },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function assignLead(input: {
  auth: AuthContext;
  id: string;
  assignedTo: string;
  requestId?: string;
  ip?: string;
}): Promise<LeadDto> {
  const doc = await findLeadInScope(input.id, input.auth);
  const assigneeId = await assertAssignableSalesperson(input.assignedTo);
  const previous = doc.assignedTo.toString();
  doc.assignedTo = assigneeId;
  await doc.save();

  await activityService.recordSystemActivity({
    entityType: 'lead',
    entityId: doc._id.toString(),
    type: 'assignment',
    body: 'Lead reassigned',
    createdBy: input.auth.userId,
    assignedTo: input.assignedTo,
    metadata: { previousAssignedTo: previous, assignedTo: input.assignedTo },
  });

  await createNotification({
    userId: input.assignedTo,
    type: 'lead_assigned',
    title: 'Lead assigned to you',
    link: `/app/leads/${doc._id.toString()}`,
  });

  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'lead.assigned',
    entityType: 'lead',
    entityId: doc._id.toString(),
    changes: { previousAssignedTo: previous, assignedTo: input.assignedTo },
    requestId: input.requestId,
    ip: input.ip,
  });

  return toDto(doc);
}

export async function convertLead(input: {
  auth: AuthContext;
  id: string;
  existingCustomerId?: string;
  requestId?: string;
  ip?: string;
}): Promise<{ lead: LeadDto; customerId: string }> {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const doc = await findLeadInScope(input.id, input.auth, session);
    if (doc.convertedCustomerId) {
      await session.commitTransaction();
      return {
        lead: toDto(doc),
        customerId: doc.convertedCustomerId.toString(),
      };
    }

    const won = await getWonLeadStage();
    let customerId: string;

    if (input.existingCustomerId) {
      const existing = await customerService.getCustomer(input.existingCustomerId, input.auth);
      customerId = existing.id;
    } else {
      const type =
        doc.companyName && doc.companyName.trim() ? 'business' : 'individual';
      const created = await customerService.createCustomer({
        auth: input.auth,
        type,
        firstName: doc.firstName,
        lastName: doc.lastName,
        companyName: doc.companyName,
        email: doc.email,
        phone: doc.phone,
        mailingAddress: {
          line1: doc.address?.line1,
          line2: doc.address?.line2,
          city: doc.address?.city,
          state: doc.address?.state,
          zip: doc.address?.zip,
        },
        notes: doc.notes,
        ownerId: doc.assignedTo.toString(),
        requestId: input.requestId,
        ip: input.ip,
        session,
      });
      customerId = created.id;

      const hasAddress = Boolean(doc.address?.line1?.trim() && doc.address?.zip?.trim());
      if (hasAddress) {
        await customerService.createProperty({
          auth: { ...input.auth, role: 'admin' },
          customerId,
          address: {
            line1: doc.address!.line1!,
            line2: doc.address?.line2,
            city: doc.address?.city,
            state: doc.address?.state,
            zip: doc.address!.zip!,
          },
          requestId: input.requestId,
          ip: input.ip,
          session,
        });
      }
    }

    doc.convertedCustomerId = new mongoose.Types.ObjectId(customerId);
    doc.convertedAt = new Date();
    doc.stageId = won._id;
    doc.lostReasonKey = null;
    await doc.save({ session });

    await activityService.recordSystemActivity(
      {
        entityType: 'lead',
        entityId: doc._id.toString(),
        type: 'conversion',
        body: 'Lead converted to customer',
        createdBy: input.auth.userId,
        metadata: { customerId },
      },
      session,
    );

    await recordAudit({
      actorType: 'user',
      actorId: input.auth.userId,
      action: 'lead.converted',
      entityType: 'lead',
      entityId: doc._id.toString(),
      changes: { customerId, stageId: won._id.toString() },
      requestId: input.requestId,
      ip: input.ip,
      session,
    });

    await session.commitTransaction();
    return { lead: toDto(doc), customerId };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function ingestWebsiteLead(input: {
  submissionId: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  serviceInterest?: string;
  notes?: string;
  honeypot?: string;
  requestId?: string;
  ip?: string;
}): Promise<{ created: boolean; leadId: string | null }> {
  if (input.honeypot && input.honeypot.trim()) {
    return { created: false, leadId: null };
  }

  const maxAttempts = 3;
  let lead: LeadDto | undefined;
  let duplicates: Awaited<ReturnType<typeof findDuplicateMatches>> = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const existing = await LeadModel.findOne({ externalSubmissionId: input.submissionId });
    if (existing) {
      return { created: false, leadId: existing._id.toString() };
    }

    duplicates = await findDuplicateMatches({
      phone: input.phone,
      email: input.email,
      address: input.address,
    });

    const auth: AuthContext = { userId: 'system', role: 'admin' };
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      lead = await createLead({
        auth,
        firstName: input.firstName,
        lastName: input.lastName,
        companyName: input.companyName,
        email: input.email,
        phone: input.phone,
        address: input.address,
        sourceKey: 'website',
        serviceInterestKey: input.serviceInterest,
        notes: input.notes,
        externalSubmissionId: input.submissionId,
        possibleDuplicateOf: duplicates.map((d) => ({
          entityType: d.entityType,
          entityId: d.id,
        })),
        notify: false,
        actorType: 'system',
        requestId: input.requestId,
        ip: input.ip,
        session,
      });
      await session.commitTransaction();
      break;
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch {
        // Session may already be aborted after a write conflict.
      }
      // Concurrent duplicates: winner commits; loser may see E11000 / write conflict.
      // Aborted txn rolls back RR cursor. Prefer existing lead; otherwise retry briefly.
      const raced = await LeadModel.findOne({ externalSubmissionId: input.submissionId });
      if (raced) {
        return { created: false, leadId: raced._id.toString() };
      }
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    } finally {
      session.endSession();
    }
  }

  if (!lead) {
    throw new AppError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Website lead intake failed unexpectedly.',
    });
  }

  // Best-effort notifications after commit (V2-04): failures must not 500 a successful create.
  try {
    await createNotification({
      userId: lead.assignedTo,
      type: 'website_lead_received',
      title: 'New website lead received',
      link: `/app/leads/${lead.id}`,
    });
    if (duplicates.length > 0) {
      await createNotification({
        userId: lead.assignedTo,
        type: 'possible_duplicate',
        title: 'Website lead may be a duplicate',
        link: `/app/leads/${lead.id}`,
      });
    }
  } catch (notifyError) {
    getLog().error(
      { err: notifyError, leadId: lead.id, submissionId: input.submissionId },
      'Website lead notification failed after successful create (best-effort)',
    );
  }

  try {
    await recordAudit({
      actorType: 'system',
      action: 'lead.website_intake',
      entityType: 'lead',
      entityId: lead.id,
      changes: { submissionId: input.submissionId },
      requestId: input.requestId,
      ip: input.ip,
    });
  } catch (auditError) {
    getLog().error(
      { err: auditError, leadId: lead.id },
      'Website lead audit failed after successful create (best-effort)',
    );
  }

  return { created: true, leadId: lead.id };
}
