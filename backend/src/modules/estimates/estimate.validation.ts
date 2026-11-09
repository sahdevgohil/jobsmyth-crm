import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { LINE_ITEM_KINDS } from '../settings/company-settings.model.js';
import { ESTIMATE_STATUSES } from './estimate.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const isoDateTimeSchema = z.string().datetime({ offset: true });
const cents = z.number().int().nonnegative().max(1_000_000_000_00);

export const lineItemBodySchema = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    description: z.string().trim().min(1).max(500),
    kind: z.enum(LINE_ITEM_KINDS),
    quantity: z.number().finite().nonnegative().max(10_000_000),
    unit: z.string().trim().min(1).max(20),
    unitCostCents: cents,
    laborCostCents: cents.default(0),
    materialCostCents: cents.default(0),
    /** Verified against the backend calculation if sent; never stored as-is. */
    amountCents: z.number().int().optional(),
  })
  .strict();

/** Optional client-side figures: accepted only to be verified, never trusted. */
const clientTotals = {
  subtotalCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
};

export const listEstimatesQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(ESTIMATE_STATUSES).optional(),
    customerId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    inspectionId: objectIdSchema.optional(),
    measurementId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
  })
  .strict();

export const createEstimateBodySchema = z
  .object({
    customerId: objectIdSchema,
    propertyId: objectIdSchema,
    inspectionId: objectIdSchema.optional(),
    measurementId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
    lineItems: z.array(lineItemBodySchema).max(200).default([]),
    discountCents: cents.default(0),
    taxRateBps: z.number().int().min(0).max(10000).optional(),
    notes: z.string().max(10_000).optional(),
    validUntil: isoDateTimeSchema.optional(),
    ...clientTotals,
  })
  .strict();

export const updateEstimateBodySchema = z
  .object({
    inspectionId: objectIdSchema.nullable().optional(),
    measurementId: objectIdSchema.nullable().optional(),
    leadId: objectIdSchema.nullable().optional(),
    lineItems: z.array(lineItemBodySchema).max(200).optional(),
    discountCents: cents.optional(),
    taxRateBps: z.number().int().min(0).max(10000).optional(),
    notes: z.string().max(10_000).optional(),
    validUntil: isoDateTimeSchema.nullable().optional(),
    /** The only status change allowed through PATCH: lock a draft as sent. */
    status: z.literal('sent').optional(),
    ...clientTotals,
  })
  .strict();

export const duplicateEstimateBodySchema = z
  .object({
    /** `version` bumps the version number of the source; `copy` starts again at version 1. */
    mode: z.enum(['version', 'copy']).default('copy'),
  })
  .strict()
  .default({});

export const estimateIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
