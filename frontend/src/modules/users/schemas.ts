import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['admin', 'salesperson']),
  temporaryPassword: z.string().min(12).max(128),
  receivesLeads: z.boolean().optional(),
});

export type CreateUserValues = z.infer<typeof createUserSchema>;
