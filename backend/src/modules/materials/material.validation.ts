import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { MATERIAL_REQUIREMENT_STATUSES } from './material.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const listMaterialsQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const createMaterialBodySchema = z
  .object({
    name: z.string().trim().min(1),
    sku: z.string().optional(),
    description: z.string().optional(),
    unit: z.string().trim().min(1).optional(),
    costCents: z.number().int().nonnegative().optional(),
    supplier: z.string().optional(),
    notes: z.string().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const updateMaterialBodySchema = createMaterialBodySchema.partial().strict();

export const materialIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const listMaterialRequirementsQuerySchema = paginationQuerySchema
  .extend({
    materialId: objectIdSchema.optional(),
    estimateId: objectIdSchema.optional(),
    proposalId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
    status: z.enum(MATERIAL_REQUIREMENT_STATUSES).optional(),
  })
  .strict();

export const createMaterialRequirementBodySchema = z
  .object({
    materialId: objectIdSchema,
    quantity: z.number().nonnegative(),
    unit: z.string().trim().min(1).optional(),
    status: z.enum(MATERIAL_REQUIREMENT_STATUSES).optional(),
    notes: z.string().optional(),
    estimateId: objectIdSchema.optional(),
    proposalId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
  })
  .strict();

export const updateMaterialRequirementBodySchema = z
  .object({
    quantity: z.number().nonnegative().optional(),
    unit: z.string().trim().min(1).optional(),
    status: z.enum(MATERIAL_REQUIREMENT_STATUSES).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const materialRequirementIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
