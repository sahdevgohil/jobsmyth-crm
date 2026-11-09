import { z } from 'zod';

export const listActivitiesQuerySchema = z
  .object({
    entityType: z.enum(['lead', 'customer']),
    entityId: z.string().min(1),
  })
  .strict();

export const createActivityBodySchema = z
  .object({
    entityType: z.enum(['lead', 'customer']),
    entityId: z.string().min(1),
    type: z.enum(['note', 'call', 'follow_up']),
    body: z.string().optional(),
    dueAt: z.string().datetime().optional(),
    assignedTo: z.string().optional(),
  })
  .strict();

export const activityIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
