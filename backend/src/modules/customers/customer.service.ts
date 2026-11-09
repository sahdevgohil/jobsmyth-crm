import mongoose, { type ClientSession, type Types } from 'mongoose';
import type { Role } from '../../config/permissions.js';
import { recordAudit } from '../../services/audit.js';
import { buildAddressKey, normalizeEmail } from '../../utils/address-key.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { normalizePhoneE164 } from '../../utils/phone.js';
import { LookupValueModel } from '../settings/lookup-value.model.js';
import { CustomerModel, type CustomerDocument } from './customer.model.js';
import type { CustomerDto, PropertyDto } from './customer.types.js';
import { PropertyModel, type PropertyDocument } from './property.model.js';

export type AuthContext = { userId: string; role: Role };

function customerScopeFilter(auth: AuthContext): Record<string, unknown> {
  if (auth.role === 'admin') {
    return {};
  }
  return { ownerId: auth.userId };
}

function toCustomerDto(doc: CustomerDocument): CustomerDto {
  return {
    id: doc._id.toString(),
    type: doc.type as 'individual' | 'business',
    firstName: doc.firstName ?? '',
    lastName: doc.lastName ?? '',
    companyName: doc.companyName ?? '',
    email: doc.email ?? '',
    phone: doc.phone ?? '',
    contacts: (doc.contacts ?? []).map((c) => ({
      name: c.name,
      role: c.role ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    })),
    mailingAddress: {
      line1: doc.mailingAddress?.line1 ?? '',
      line2: doc.mailingAddress?.line2 ?? '',
      city: doc.mailingAddress?.city ?? '',
      state: doc.mailingAddress?.state ?? '',
      zip: doc.mailingAddress?.zip ?? '',
    },
    ownerId: doc.ownerId.toString(),
    notes: doc.notes ?? '',
    archivedAt: doc.archivedAt ? doc.archivedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toPropertyDto(doc: PropertyDocument): PropertyDto {
  return {
    id: doc._id.toString(),
    customerId: doc.customerId.toString(),
    address: {
      line1: doc.address.line1,
      line2: doc.address.line2 ?? '',
      city: doc.address.city ?? '',
      state: doc.address.state ?? '',
      zip: doc.address.zip,
    },
    propertyTypeKey: doc.propertyTypeKey ?? '',
    details: {
      stories: doc.details?.stories ?? null,
      roofAgeYears: doc.details?.roofAgeYears ?? null,
      notes: doc.details?.notes ?? '',
    },
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function validateCustomerNames(input: {
  type: 'individual' | 'business';
  firstName?: string;
  companyName?: string;
}): void {
  if (input.type === 'business') {
    if (!input.companyName?.trim()) {
      throw new AppError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Company name is required for business customers.',
        details: [{ path: 'companyName', message: 'Required' }],
      });
    }
  } else if (!input.firstName?.trim()) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'First name is required for individual customers.',
      details: [{ path: 'firstName', message: 'Required' }],
    });
  }
}

function normalizeContactFields(input: { phone?: string; email?: string }): {
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
  return {
    phone,
    phoneE164,
    email,
    emailNormalized: normalizeEmail(email),
  };
}

export async function findDuplicateMatches(input: {
  phone?: string;
  email?: string;
  address?: { line1?: string; zip?: string };
}): Promise<Array<{ entityType: 'customer' | 'lead'; id: string; label: string }>> {
  const phoneE164 = input.phone ? normalizePhoneE164(input.phone) : null;
  const emailNormalized = normalizeEmail(input.email);
  const addressKey = buildAddressKey(input.address);

  const or: Record<string, unknown>[] = [];
  if (phoneE164) or.push({ phoneE164 });
  if (emailNormalized) or.push({ emailNormalized });
  if (addressKey) or.push({ addressKey }); // properties / leads
  if (or.length === 0) return [];

  const customers = await CustomerModel.find({
    archivedAt: null,
    $or: [
      ...(phoneE164 ? [{ phoneE164 }] : []),
      ...(emailNormalized ? [{ emailNormalized }] : []),
    ],
  }).limit(20);

  const matches: Array<{ entityType: 'customer' | 'lead'; id: string; label: string }> = [];
  for (const c of customers) {
    const label =
      c.type === 'business'
        ? c.companyName || c.email || c.phone
        : `${c.firstName} ${c.lastName}`.trim() || c.email || c.phone;
    matches.push({ entityType: 'customer', id: c._id.toString(), label });
  }

  if (addressKey) {
    const props = await PropertyModel.find({ addressKey }).limit(20);
    for (const p of props) {
      if (!matches.some((m) => m.entityType === 'customer' && m.id === p.customerId.toString())) {
        matches.push({
          entityType: 'customer',
          id: p.customerId.toString(),
          label: `${p.address.line1}, ${p.address.zip}`,
        });
      }
    }
  }

  // Lazy import leads to avoid circular dependency at module load for duplicate cross-check
  const { LeadModel } = await import('../leads/lead.model.js');
  const leadOr: Record<string, unknown>[] = [];
  if (phoneE164) leadOr.push({ phoneE164 });
  if (emailNormalized) leadOr.push({ emailNormalized });
  if (addressKey) leadOr.push({ addressKey });
  if (leadOr.length) {
    const leads = await LeadModel.find({ $or: leadOr }).limit(20);
    for (const lead of leads) {
      const label =
        lead.companyName ||
        `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() ||
        lead.email ||
        lead.phone;
      matches.push({ entityType: 'lead', id: lead._id.toString(), label: String(label) });
    }
  }

  return matches;
}

export async function listCustomers(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  search?: string;
  ids?: string;
  includeArchived?: boolean;
}): Promise<{ data: CustomerDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const filter: Record<string, unknown> = {
    ...customerScopeFilter(input.auth),
  };
  if (input.ids) {
    filter._id = { $in: input.ids.split(',') };
  }
  if (!input.includeArchived && !input.ids) {
    filter.archivedAt = null;
  }
  if (input.search?.trim()) {
    const q = escapeRegex(input.search.trim());
    filter.$or = [
      { firstName: new RegExp(q, 'i') },
      { lastName: new RegExp(q, 'i') },
      { companyName: new RegExp(q, 'i') },
      { email: new RegExp(q, 'i') },
      { phone: new RegExp(q, 'i') },
    ];
  }

  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    CustomerModel.countDocuments(filter),
    CustomerModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
  ]);
  return { data: rows.map(toCustomerDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

async function findCustomerInScope(
  id: string,
  auth: AuthContext,
  session?: ClientSession,
): Promise<CustomerDocument> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
  const doc = await CustomerModel.findOne({
    _id: id,
    ...customerScopeFilter(auth),
  }).session(session ?? null);
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Customer not found.' });
  }
  return doc;
}

export async function getCustomer(id: string, auth: AuthContext): Promise<CustomerDto> {
  return toCustomerDto(await findCustomerInScope(id, auth));
}

export async function createCustomer(input: {
  auth: AuthContext;
  type: 'individual' | 'business';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  contacts?: Array<{ name: string; role?: string; phone?: string; email?: string }>;
  mailingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  notes?: string;
  ownerId?: string;
  requestId?: string;
  ip?: string;
  session?: ClientSession;
}): Promise<CustomerDto> {
  validateCustomerNames(input);
  const normalized = normalizeContactFields(input);
  const ownerId =
    input.auth.role === 'admin' && input.ownerId ? input.ownerId : input.auth.userId;

  const docPayload = {
    type: input.type,
    firstName: input.firstName?.trim() ?? '',
    lastName: input.lastName?.trim() ?? '',
    companyName: input.companyName?.trim() ?? '',
    ...normalized,
    contacts: (input.contacts ?? []).map((c) => ({
      name: c.name,
      role: c.role ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    })),
    mailingAddress: {
      line1: input.mailingAddress?.line1 ?? '',
      line2: input.mailingAddress?.line2 ?? '',
      city: input.mailingAddress?.city ?? '',
      state: input.mailingAddress?.state ?? '',
      zip: input.mailingAddress?.zip ?? '',
    },
    ownerId,
    notes: input.notes ?? '',
    createdBy: input.auth.userId,
  };

  const created = input.session
    ? (await CustomerModel.create([docPayload], { session: input.session }))[0]!
    : await CustomerModel.create(docPayload);

  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'customer.created',
    entityType: 'customer',
    entityId: created._id.toString(),
    changes: { type: created.type, ownerId },
    requestId: input.requestId,
    ip: input.ip,
    session: input.session,
  });

  return toCustomerDto(created);
}

export async function updateCustomer(input: {
  auth: AuthContext;
  id: string;
  patch: Record<string, unknown>;
  requestId?: string;
  ip?: string;
}): Promise<CustomerDto> {
  const doc = await findCustomerInScope(input.id, input.auth);
  const before = toCustomerDto(doc);

  if (input.patch.type) {
    doc.type = input.patch.type as 'individual' | 'business';
  }
  if (input.patch.firstName !== undefined) doc.firstName = String(input.patch.firstName);
  if (input.patch.lastName !== undefined) doc.lastName = String(input.patch.lastName);
  if (input.patch.companyName !== undefined) doc.companyName = String(input.patch.companyName);
  if (input.patch.notes !== undefined) doc.notes = String(input.patch.notes);
  if (input.patch.contacts !== undefined) {
    doc.contacts = input.patch.contacts as typeof doc.contacts;
  }
  if (input.patch.mailingAddress !== undefined) {
    const a = input.patch.mailingAddress as Record<string, string>;
    doc.mailingAddress = {
      line1: a.line1 ?? '',
      line2: a.line2 ?? '',
      city: a.city ?? '',
      state: a.state ?? '',
      zip: a.zip ?? '',
    };
  }
  if (input.patch.phone !== undefined || input.patch.email !== undefined) {
    const normalized = normalizeContactFields({
      phone: (input.patch.phone as string | undefined) ?? doc.phone,
      email: (input.patch.email as string | undefined) ?? doc.email,
    });
    doc.phone = normalized.phone;
    doc.phoneE164 = normalized.phoneE164;
    doc.email = normalized.email;
    doc.emailNormalized = normalized.emailNormalized;
  }
  if (input.auth.role === 'admin' && input.patch.ownerId) {
    doc.ownerId = new mongoose.Types.ObjectId(String(input.patch.ownerId));
  }

  validateCustomerNames({
    type: doc.type as 'individual' | 'business',
    firstName: doc.firstName,
    companyName: doc.companyName,
  });

  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'customer.updated',
    entityType: 'customer',
    entityId: doc._id.toString(),
    changes: { before, after: toCustomerDto(doc) },
    requestId: input.requestId,
    ip: input.ip,
  });
  return toCustomerDto(doc);
}

export async function archiveCustomer(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<CustomerDto> {
  const doc = await findCustomerInScope(input.id, input.auth);
  if (!doc.archivedAt) {
    doc.archivedAt = new Date();
    await doc.save();
    await recordAudit({
      actorType: 'user',
      actorId: input.auth.userId,
      action: 'customer.archived',
      entityType: 'customer',
      entityId: doc._id.toString(),
      requestId: input.requestId,
      ip: input.ip,
    });
  }
  return toCustomerDto(doc);
}

export async function deleteCustomer(input: {
  auth: AuthContext;
  id: string;
  requestId?: string;
  ip?: string;
}): Promise<void> {
  if (input.auth.role !== 'admin') {
    throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'Only Admin can delete customers.' });
  }
  const doc = await findCustomerInScope(input.id, input.auth);
  const propCount = await PropertyModel.countDocuments({ customerId: doc._id });
  const { LeadModel } = await import('../leads/lead.model.js');
  const leadCount = await LeadModel.countDocuments({
    $or: [{ convertedCustomerId: doc._id }, { referredByCustomerId: doc._id }],
  });
  if (propCount > 0 || leadCount > 0) {
    throw new AppError({
      status: 422,
      code: 'CUSTOMER_HAS_RELATIONS',
      message: 'Customers with related records must be archived, not deleted.',
    });
  }
  await CustomerModel.deleteOne({ _id: doc._id });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'customer.deleted',
    entityType: 'customer',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
}

export async function getCustomerSummary(input: {
  auth: AuthContext;
  id: string;
}): Promise<{
  customer: CustomerDto;
  properties: PropertyDto[];
  relatedLeadIds: string[];
  relatedLeads: Array<{ id: string; name: string; stageId: string; sourceKey: string; createdAt: string }>;
}> {
  const customer = await findCustomerInScope(input.id, input.auth);
  const properties = await PropertyModel.find({ customerId: customer._id }).sort({ createdAt: 1 });
  const { LeadModel } = await import('../leads/lead.model.js');
  const leads = await LeadModel.find({
    $or: [{ convertedCustomerId: customer._id }, { referredByCustomerId: customer._id }],
  }).select({ firstName: 1, lastName: 1, companyName: 1, stageId: 1, sourceKey: 1, createdAt: 1 });
  return {
    customer: toCustomerDto(customer),
    properties: properties.map(toPropertyDto),
    relatedLeadIds: leads.map((l) => l._id.toString()),
    relatedLeads: leads.map((l) => ({
      id: l._id.toString(),
      name: l.companyName || `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim() || 'Lead',
      stageId: l.stageId.toString(),
      sourceKey: l.sourceKey,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

export async function listProperties(
  customerId: string,
  auth: AuthContext,
): Promise<PropertyDto[]> {
  await findCustomerInScope(customerId, auth);
  const rows = await PropertyModel.find({ customerId }).sort({ createdAt: 1 });
  return rows.map(toPropertyDto);
}

export async function createProperty(input: {
  auth: AuthContext;
  customerId: string;
  address: { line1: string; line2?: string; city?: string; state?: string; zip: string };
  propertyTypeKey?: string;
  details?: { stories?: number; roofAgeYears?: number; notes?: string };
  requestId?: string;
  ip?: string;
  session?: ClientSession;
}): Promise<PropertyDto> {
  await findCustomerInScope(input.customerId, input.auth, input.session);
  if (input.propertyTypeKey) {
    const lookup = await LookupValueModel.findOne({
      type: 'property_type',
      key: input.propertyTypeKey,
      isActive: true,
    }).session(input.session ?? null);
    if (!lookup) {
      throw new AppError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid property type.',
        details: [{ path: 'propertyTypeKey', message: 'Unknown or inactive property type' }],
      });
    }
  }

  const address = {
    line1: input.address.line1.trim(),
    line2: input.address.line2?.trim() ?? '',
    city: input.address.city?.trim() ?? '',
    state: input.address.state?.trim() ?? '',
    zip: input.address.zip.trim(),
  };
  const payload = {
    customerId: input.customerId,
    address,
    addressKey: buildAddressKey(address),
    propertyTypeKey: input.propertyTypeKey ?? '',
    details: {
      stories: input.details?.stories,
      roofAgeYears: input.details?.roofAgeYears,
      notes: input.details?.notes ?? '',
    },
    createdBy: input.auth.userId,
  };

  const created = input.session
    ? (await PropertyModel.create([payload], { session: input.session }))[0]!
    : await PropertyModel.create(payload);

  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'property.created',
    entityType: 'property',
    entityId: created._id.toString(),
    changes: { customerId: input.customerId, address },
    requestId: input.requestId,
    ip: input.ip,
    session: input.session,
  });

  return toPropertyDto(created);
}

export async function getProperty(id: string, auth: AuthContext): Promise<PropertyDto> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Property not found.' });
  }
  const prop = await PropertyModel.findById(id);
  if (!prop) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Property not found.' });
  }
  await findCustomerInScope(prop.customerId.toString(), auth);
  return toPropertyDto(prop);
}

export async function updateProperty(input: {
  auth: AuthContext;
  id: string;
  patch: {
    address?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string };
    propertyTypeKey?: string;
    details?: { stories?: number; roofAgeYears?: number; notes?: string };
  };
  requestId?: string;
  ip?: string;
}): Promise<PropertyDto> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Property not found.' });
  }
  const prop = await PropertyModel.findById(input.id);
  if (!prop) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Property not found.' });
  }
  await findCustomerInScope(prop.customerId.toString(), input.auth);

  if (input.patch.address) {
    prop.address = {
      line1: input.patch.address.line1 ?? prop.address.line1,
      line2: input.patch.address.line2 ?? prop.address.line2 ?? '',
      city: input.patch.address.city ?? prop.address.city ?? '',
      state: input.patch.address.state ?? prop.address.state ?? '',
      zip: input.patch.address.zip ?? prop.address.zip,
    };
    prop.addressKey = buildAddressKey(prop.address);
  }
  if (input.patch.propertyTypeKey !== undefined) {
    prop.propertyTypeKey = input.patch.propertyTypeKey;
  }
  if (input.patch.details) {
    prop.details = {
      stories: input.patch.details.stories ?? prop.details?.stories,
      roofAgeYears: input.patch.details.roofAgeYears ?? prop.details?.roofAgeYears,
      notes: input.patch.details.notes ?? prop.details?.notes ?? '',
    };
  }
  await prop.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'property.updated',
    entityType: 'property',
    entityId: prop._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toPropertyDto(prop);
}

/** Used by lead conversion — creates customer owned by assignee. */
export async function createCustomerFromLead(input: {
  auth: AuthContext;
  type: 'individual' | 'business';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  mailingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  notes?: string;
  ownerId: string;
  requestId?: string;
  ip?: string;
  session: ClientSession;
}): Promise<{ customerId: Types.ObjectId; customer: CustomerDto }> {
  const dto = await createCustomer({
    ...input,
    ownerId: input.ownerId,
  });
  return { customerId: new mongoose.Types.ObjectId(dto.id), customer: dto };
}

export async function searchProperties(input: {
  auth: AuthContext;
  page: number;
  pageSize: number;
  search?: string;
  customerId?: string;
}): Promise<{
  data: Array<PropertyDto & { customerName: string }>;
  meta: ReturnType<typeof paginationMeta>;
}> {
  const filter: Record<string, unknown> = {};
  if (input.auth.role !== 'admin') {
    filter.customerId = { $in: await CustomerModel.find({ ownerId: input.auth.userId }).distinct('_id') };
  }
  if (input.customerId) {
    if (!mongoose.isValidObjectId(input.customerId)) {
      throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid customerId.' });
    }
    filter.$and = [{ customerId: input.customerId }];
  }
  if (input.search?.trim()) {
    const q = new RegExp(escapeRegex(input.search.trim()), 'i');
    filter.$or = [{ 'address.line1': q }, { 'address.city': q }, { 'address.zip': q }];
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    PropertyModel.countDocuments(filter),
    PropertyModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
  ]);
  const customers = await CustomerModel.find({ _id: { $in: rows.map((r) => r.customerId) } })
    .select({ firstName: 1, lastName: 1, companyName: 1 })
    .lean();
  const names = new Map(
    customers.map((c) => [String(c._id), c.companyName || `${c.firstName} ${c.lastName}`.trim()]),
  );
  return {
    data: rows.map((r) => ({ ...toPropertyDto(r), customerName: names.get(String(r.customerId)) ?? '' })),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}
