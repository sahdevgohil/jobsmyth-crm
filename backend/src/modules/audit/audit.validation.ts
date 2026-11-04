import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

export const listAuditQuerySchema = paginationQuerySchema.extend({
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
});
