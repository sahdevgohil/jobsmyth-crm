import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { INSPECTION_STATUSES } from './inspection.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const isoDateTimeSchema = z.string().datetime({ offset: true });

const measurementsBodySchema = z
  .object({
    totalAreaSqFt: z.number().nonnegative().nullable().optional(),
    pitch: z.string().trim().max(50).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const listInspectionsQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(INSPECTION_STATUSES).optional(),
    customerId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    appointmentId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .strict();

export const createInspectionBodySchema = z
  .object({
    customerId: objectIdSchema,
    propertyId: objectIdSchema,
    appointmentId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
    inspectionDate: isoDateTimeSchema.optional(),
    typeKey: z.string().trim().min(1).optional(),
    roofCondition: z.string().optional(),
    findings: z.string().optional(),
    damageObservations: z.string().optional(),
    recommendations: z.string().optional(),
    notes: z.string().optional(),
    measurements: measurementsBodySchema.optional(),
  })
  .strict();

export const updateInspectionBodySchema = z
  .object({
    assignedTo: objectIdSchema.optional(),
    inspectionDate: isoDateTimeSchema.optional(),
    typeKey: z.string().trim().min(1).optional(),
    /** `in_progress` starts a draft, or (admin only) reopens a completed inspection. */
    status: z.literal('in_progress').optional(),
    roofCondition: z.string().optional(),
    findings: z.string().optional(),
    damageObservations: z.string().optional(),
    recommendations: z.string().optional(),
    notes: z.string().optional(),
    measurements: measurementsBodySchema.optional(),
  })
  .strict();

export const inspectionIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
