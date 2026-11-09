import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { PROPOSAL_STATUSES } from './proposal.model.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const paymentScheduleItemSchema = z
  .object({
    label: z.string().trim().min(1),
    percentBps: z.number().int().min(0).max(10000).optional(),
    amountCents: z.number().int().nonnegative().optional(),
  })
  .strict();

export const listProposalsQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(PROPOSAL_STATUSES).optional(),
    customerId: objectIdSchema.optional(),
    estimateId: objectIdSchema.optional(),
    search: z.string().optional(),
  })
  .strict();

export const createProposalBodySchema = z
  .object({
    estimateId: objectIdSchema,
    termsAndConditions: z.string().optional(),
    paymentSchedule: z.array(paymentScheduleItemSchema).optional(),
    expirationDate: z.string().datetime({ offset: true }).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const updateProposalBodySchema = z
  .object({
    termsAndConditions: z.string().optional(),
    paymentSchedule: z.array(paymentScheduleItemSchema).optional(),
    expirationDate: z.string().datetime({ offset: true }).nullable().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const proposalIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const signatureRequestBodySchema = z
  .object({
    recipientEmail: z.string().email(),
    recipientName: z.string().optional(),
  })
  .strict();
