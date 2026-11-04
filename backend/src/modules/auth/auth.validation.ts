import { z } from 'zod';

export const passwordSchema = z.string().min(12).max(128);

export const loginBodySchema = z
  .object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    password: z.string().min(1),
  })
  .strict();

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .strict();

export const forgotPasswordBodySchema = z
  .object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
  })
  .strict();

export const resetPasswordBodySchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
  })
  .strict();

export const acceptInviteBodySchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
  })
  .strict();
