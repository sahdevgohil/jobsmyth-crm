import { z } from 'zod';
import { ROLES } from '../../config/permissions.js';
import { passwordSchema } from '../auth/auth.validation.js';
import { paginationQuerySchema } from '../../utils/pagination.js';

export const createUserBodySchema = z
  .object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(40).optional(),
    role: z.enum(ROLES),
    temporaryPassword: passwordSchema,
    receivesLeads: z.boolean().optional().default(false),
  })
  .strict();

export const updateUserBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().max(40).optional(),
    role: z.enum(ROLES).optional(),
    receivesLeads: z.boolean().optional(),
    temporaryPassword: passwordSchema.optional(),
  })
  .strict();

export const userIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(ROLES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
