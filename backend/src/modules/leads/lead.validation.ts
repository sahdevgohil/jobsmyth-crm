import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  })
  .strict();

/** Optional email: empty / omitted OK; non-empty must be a valid address (V2-14). */
const optionalEmailSchema = z
  .string()
  .optional()
  .refine((v) => v === undefined || v.trim() === '' || z.string().email().safeParse(v).success, {
    message: 'Invalid email address',
  });

export const listLeadsQuerySchema = paginationQuerySchema
  .extend({
    stageId: z.string().optional(),
    sourceKey: z.string().optional(),
    assignedTo: z.string().optional(),
    createdFrom: z.string().optional(),
    createdTo: z.string().optional(),
    hasOverdueFollowUp: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    search: z.string().optional(),
  })
  .strict();

export const createLeadBodySchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    email: optionalEmailSchema,
    phone: z.string().optional(),
    address: addressSchema.optional(),
    sourceKey: z.string().min(1),
    serviceInterestKey: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    referredByCustomerId: z.string().optional(),
    notes: z.string().optional(),
    assignedTo: z.string().optional(),
    stageId: z.string().optional(),
  })
  .strict();

export const updateLeadBodySchema = createLeadBodySchema.partial().omit({ assignedTo: true, stageId: true }).strict();

export const leadIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const changeStageBodySchema = z
  .object({
    stageId: z.string().min(1),
    lostReasonKey: z.string().optional(),
  })
  .strict();

export const assignLeadBodySchema = z
  .object({
    assignedTo: z.string().min(1),
  })
  .strict();

export const convertLeadBodySchema = z
  .object({
    existingCustomerId: z.string().optional(),
  })
  .strict();

export const duplicateCheckBodySchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().optional(),
    address: addressSchema.optional(),
  })
  .strict();

export const websiteLeadBodySchema = z
  .object({
    submissionId: z.string().trim().min(1).max(200),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    email: optionalEmailSchema,
    phone: z.string().optional(),
    address: addressSchema.optional(),
    serviceInterest: z.string().optional(),
    notes: z.string().optional(),
    honeypot: z.string().optional(),
  })
  .strict();
