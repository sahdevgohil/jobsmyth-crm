import { recordAudit } from '../../services/audit.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { AppError } from '../../utils/errors.js';
import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import type { AuthContext } from '../../services/entity-links.js';
import {
  MaterialModel,
  MaterialRequirementModel,
  type MaterialDocument,
  type MaterialRequirementDocument,
  type MaterialRequirementStatus,
} from './material.model.js';

export type MaterialDto = {
  id: string;
  name: string;
  sku: string;
  description: string;
  unit: string;
  costCents: number;
  supplier: string;
  active: boolean;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type MaterialRequirementDto = {
  id: string;
  materialId: string;
  quantity: number;
  unit: string;
  status: MaterialRequirementStatus;
  notes: string;
  estimateId: string | null;
  proposalId: string | null;
  projectId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function toMaterialDto(doc: MaterialDocument): MaterialDto {
  return {
    id: doc._id.toString(),
    name: doc.name,
    sku: doc.sku ?? '',
    description: doc.description ?? '',
    unit: doc.unit,
    costCents: doc.costCents,
    supplier: doc.supplier ?? '',
    active: doc.active,
    notes: doc.notes ?? '',
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toRequirementDto(doc: MaterialRequirementDocument): MaterialRequirementDto {
  return {
    id: doc._id.toString(),
    materialId: doc.materialId.toString(),
    quantity: doc.quantity,
    unit: doc.unit,
    status: doc.status as MaterialRequirementStatus,
    notes: doc.notes ?? '',
    estimateId: doc.estimateId ? doc.estimateId.toString() : null,
    proposalId: doc.proposalId ? doc.proposalId.toString() : null,
    projectId: doc.projectId ? doc.projectId.toString() : null,
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listMaterials(input: {
  page: number;
  pageSize: number;
  search?: string;
  active?: boolean;
}): Promise<{ data: MaterialDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const filter: Record<string, unknown> = {};
  if (input.active !== undefined) filter.active = input.active;
  if (input.search?.trim()) {
    const q = escapeRegex(input.search.trim());
    filter.$or = [{ name: { $regex: q, $options: 'i' } }, { sku: { $regex: q, $options: 'i' } }];
  }
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    MaterialModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    MaterialModel.countDocuments(filter),
  ]);
  return { data: rows.map(toMaterialDto), meta: paginationMeta(total, input.page, input.pageSize) };
}

export async function getMaterial(id: string): Promise<MaterialDto> {
  const doc = await MaterialModel.findById(id);
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Material not found.' });
  }
  return toMaterialDto(doc);
}

export async function createMaterial(input: {
  auth: AuthContext;
  name: string;
  sku?: string;
  description?: string;
  unit?: string;
  costCents?: number;
  supplier?: string;
  notes?: string;
  active?: boolean;
  requestId?: string;
  ip?: string;
}): Promise<MaterialDto> {
  const created = await MaterialModel.create({
    name: input.name.trim(),
    sku: input.sku?.trim() ?? '',
    description: input.description ?? '',
    unit: input.unit?.trim() || 'ea',
    costCents: input.costCents ?? 0,
    supplier: input.supplier ?? '',
    notes: input.notes ?? '',
    active: input.active ?? true,
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'material.created',
    entityType: 'material',
    entityId: created._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toMaterialDto(created);
}

export async function updateMaterial(input: {
  auth: AuthContext;
  id: string;
  patch: Partial<{
    name: string;
    sku: string;
    description: string;
    unit: string;
    costCents: number;
    supplier: string;
    notes: string;
    active: boolean;
  }>;
  requestId?: string;
  ip?: string;
}): Promise<MaterialDto> {
  const doc = await MaterialModel.findById(input.id);
  if (!doc) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Material not found.' });
  }
  if (input.patch.name !== undefined) doc.name = input.patch.name.trim();
  if (input.patch.sku !== undefined) doc.sku = input.patch.sku.trim();
  if (input.patch.description !== undefined) doc.description = input.patch.description;
  if (input.patch.unit !== undefined) doc.unit = input.patch.unit.trim();
  if (input.patch.costCents !== undefined) doc.costCents = input.patch.costCents;
  if (input.patch.supplier !== undefined) doc.supplier = input.patch.supplier;
  if (input.patch.notes !== undefined) doc.notes = input.patch.notes;
  if (input.patch.active !== undefined) doc.active = input.patch.active;
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'material.updated',
    entityType: 'material',
    entityId: doc._id.toString(),
    changes: input.patch,
    requestId: input.requestId,
    ip: input.ip,
  });
  return toMaterialDto(doc);
}

export async function listMaterialRequirements(input: {
  page: number;
  pageSize: number;
  materialId?: string;
  estimateId?: string;
  proposalId?: string;
  projectId?: string;
  status?: MaterialRequirementStatus;
}): Promise<{ data: MaterialRequirementDto[]; meta: ReturnType<typeof paginationMeta> }> {
  const filter: Record<string, unknown> = {};
  if (input.materialId) filter.materialId = input.materialId;
  if (input.estimateId) filter.estimateId = input.estimateId;
  if (input.proposalId) filter.proposalId = input.proposalId;
  if (input.projectId) filter.projectId = input.projectId;
  if (input.status) filter.status = input.status;
  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [rows, total] = await Promise.all([
    MaterialRequirementModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    MaterialRequirementModel.countDocuments(filter),
  ]);
  return {
    data: rows.map(toRequirementDto),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}

export async function createMaterialRequirement(input: {
  auth: AuthContext;
  materialId: string;
  quantity: number;
  unit?: string;
  status?: MaterialRequirementStatus;
  notes?: string;
  estimateId?: string;
  proposalId?: string;
  projectId?: string;
  requestId?: string;
  ip?: string;
}): Promise<MaterialRequirementDto> {
  const material = await MaterialModel.findById(input.materialId);
  if (!material || !material.active) {
    throw new AppError({
      status: 422,
      code: 'INVALID_MATERIAL',
      message: 'Material not found or inactive.',
    });
  }
  const created = await MaterialRequirementModel.create({
    materialId: input.materialId,
    quantity: input.quantity,
    unit: input.unit?.trim() || material.unit,
    status: input.status ?? 'needed',
    notes: input.notes ?? '',
    estimateId: input.estimateId,
    proposalId: input.proposalId,
    projectId: input.projectId,
    createdBy: input.auth.userId,
  });
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'material_requirement.created',
    entityType: 'material_requirement',
    entityId: created._id.toString(),
    requestId: input.requestId,
    ip: input.ip,
  });
  return toRequirementDto(created);
}

export async function updateMaterialRequirement(input: {
  auth: AuthContext;
  id: string;
  patch: Partial<{
    quantity: number;
    unit: string;
    status: MaterialRequirementStatus;
    notes: string;
  }>;
  requestId?: string;
  ip?: string;
}): Promise<MaterialRequirementDto> {
  const doc = await MaterialRequirementModel.findById(input.id);
  if (!doc) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Material requirement not found.',
    });
  }
  if (input.patch.quantity !== undefined) doc.quantity = input.patch.quantity;
  if (input.patch.unit !== undefined) doc.unit = input.patch.unit.trim();
  if (input.patch.status !== undefined) doc.status = input.patch.status;
  if (input.patch.notes !== undefined) doc.notes = input.patch.notes;
  await doc.save();
  await recordAudit({
    actorType: 'user',
    actorId: input.auth.userId,
    action: 'material_requirement.updated',
    entityType: 'material_requirement',
    entityId: doc._id.toString(),
    changes: input.patch,
    requestId: input.requestId,
    ip: input.ip,
  });
  return toRequirementDto(doc);
}
