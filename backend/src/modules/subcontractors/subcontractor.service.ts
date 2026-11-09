import { recordAudit } from '../../services/audit.js';
import type { AuthContext } from '../../services/entity-links.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { SubcontractorModel, type SubcontractorDocument } from './subcontractor.model.js';

export type SubcontractorDto = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  serviceCategories: string[];
  notes: string;
  active: boolean;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function toDto(doc: SubcontractorDocument): SubcontractorDto {
  return {
    id: doc._id.toString(),
    companyName: doc.companyName,
    contactName: doc.contactName ?? '',
    email: doc.email ?? '',
    phone: doc.phone ?? '',
    address: {
      line1: doc.address?.line1 ?? '',
      line2: doc.address?.line2 ?? '',
      city: doc.address?.city ?? '',
      state: doc.address?.state ?? '',
      zip: doc.address?.zip ?? '',
    },
    serviceCategories: doc.serviceCategories ?? [],
    notes: doc.notes ?? '',
    active: doc.active,
    archivedAt: doc.archivedAt ? doc.archivedAt.toISOString() : null,
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listSubcontractors(input: {
  page: number;
  pageSize: number;
  search?: string;
  active?: boolean;
}): Promise<{ data: SubcontractorDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const filter: Record<string, unknown> = {};
  if (input.active !== undefined) filter.active = input.active;
  if (input.search?.trim()) {
    const q = escapeRegex(input.search.trim());
    filter.$or = [
      { companyName: { $regex: q, $options: 'i' } },
      { contactName: { $regex: q, $options: 'i' } },
    ];
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    SubcontractorModel.find(filter).sort({ companyName: 1 }).skip(skip).limit(limit),
    SubcontractorModel.countDocuments(filter),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getSubcontractor(id: string): Promise<SubcontractorDto> {
  const doc = await SubcontractorModel.findById(id);
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Subcontractor not found.' });
  }
  return toDto(doc);
}

export async function createSubcontractor(input: {
  auth: AuthContext;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: Partial<SubcontractorDto['address']>;
  serviceCategories?: string[];
  notes?: string;
  requestId?: string;
  ip?: string;
}): Promise<SubcontractorDto> {
  const created = await SubcontractorModel.create({
    companyName: input.companyName.trim(),
    contactName: input.contactName ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    address: {
      line1: input.address?.line1 ?? '',
      line2: input.address?.line2 ?? '',
      city: input.address?.city ?? '',
      state: input.address?.state ?? '',
      zip: input.address?.zip ?? '',
    },
    serviceCategories: input.serviceCategories ?? [],
    notes: input.notes ?? '',
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'subcontractor.created',
    entityType: 'subcontractor',
    entityId: created._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(created);
}

export async function updateSubcontractor(input: {
  auth: AuthContext;
  id: string;
  patch: Partial<{
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    address: Partial<SubcontractorDto['address']>;
    serviceCategories: string[];
    notes: string;
    active: boolean;
  }>;
  requestId?: string;
  ip?: string;
}): Promise<SubcontractorDto> {
  const doc = await SubcontractorModel.findById(input.id);
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Subcontractor not found.' });
  }
  const p = input.patch;
  if (p.companyName !== undefined) doc.companyName = p.companyName.trim();
  if (p.contactName !== undefined) doc.contactName = p.contactName;
  if (p.email !== undefined) doc.email = p.email;
  if (p.phone !== undefined) doc.phone = p.phone;
  if (p.notes !== undefined) doc.notes = p.notes;
  if (p.serviceCategories !== undefined) doc.serviceCategories = p.serviceCategories;
  if (p.address) {
    doc.address = {
      line1: p.address.line1 ?? doc.address?.line1 ?? '',
      line2: p.address.line2 ?? doc.address?.line2 ?? '',
      city: p.address.city ?? doc.address?.city ?? '',
      state: p.address.state ?? doc.address?.state ?? '',
      zip: p.address.zip ?? doc.address?.zip ?? '',
    };
  }
  if (p.active !== undefined) {
    doc.active = p.active;
    doc.archivedAt = p.active ? null : new Date();
  }
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'subcontractor.updated',
    entityType: 'subcontractor',
    entityId: doc._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toDto(doc);
}
