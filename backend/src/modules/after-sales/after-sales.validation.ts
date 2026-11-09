import { z } from 'zod';

export const listAfterSalesQuerySchema = z
  .object({
    customerId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
  })
  .strict();

export const afterSalesIdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const createAfterSalesBodySchema = z
  .object({
    projectId: z.string().min(1),
    customerId: z.string().min(1),
    propertyId: z.string().min(1).optional(),
    completionConfirmedAt: z.string().datetime().optional(),
    feedbackRating: z.number().int().min(1).max(5).optional(),
    feedbackComment: z.string().max(5000).optional(),
    warrantyLookupKey: z.string().min(1).max(100).optional(),
    warrantyNotes: z.string().max(10_000).optional(),
    followUpDueAt: z.string().datetime().optional(),
    followUpCompletedAt: z.string().datetime().optional(),
    serviceHistoryNotes: z.string().max(20_000).optional(),
    customerNotesVisible: z.string().max(10_000).optional(),
  })
  .strict();

export const updateAfterSalesBodySchema = z
  .object({
    propertyId: z.string().min(1).nullable().optional(),
    completionConfirmedAt: z.string().datetime().nullable().optional(),
    feedbackRating: z.number().int().min(1).max(5).nullable().optional(),
    feedbackComment: z.string().max(5000).optional(),
    warrantyLookupKey: z.string().min(1).max(100).nullable().optional(),
    warrantyNotes: z.string().max(10_000).optional(),
    followUpDueAt: z.string().datetime().nullable().optional(),
    followUpCompletedAt: z.string().datetime().nullable().optional(),
    serviceHistoryNotes: z.string().max(20_000).optional(),
    customerNotesVisible: z.string().max(10_000).optional(),
  })
  .strict();
