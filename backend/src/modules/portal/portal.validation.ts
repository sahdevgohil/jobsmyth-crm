import { z } from 'zod';
import { passwordSchema } from '../auth/auth.validation.js';

export const portalLoginBodySchema = z
  .object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    password: z.string().min(1),
  })
  .strict();

export const portalChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .strict();

export const portalForgotPasswordBodySchema = z
  .object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
  })
  .strict();

export const portalResetPasswordBodySchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
  })
  .strict();

export const createPortalAccountBodySchema = z
  .object({
    customerId: z.string().min(1),
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    temporaryPassword: passwordSchema,
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
  })
  .strict();

export const portalIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
