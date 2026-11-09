import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination.js';

export const listNotificationsQuerySchema = paginationQuerySchema
  .extend({
    unreadOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();

export const notificationIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
