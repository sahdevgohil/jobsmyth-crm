import { z } from 'zod';
import { COMMUNICATION_CHANNELS } from './communication.model.js';

export const listCommunicationsQuerySchema = z
  .object({
    customerId: z.string().min(1).optional(),
    leadId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    channel: z.enum(COMMUNICATION_CHANNELS).optional(),
  })
  .strict()
  .refine((q) => Boolean(q.customerId || q.leadId || q.projectId), {
    message: 'At least one of customerId, leadId, or projectId is required.',
  });

export const createInternalNoteBodySchema = z
  .object({
    customerId: z.string().min(1),
    leadId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    subject: z.string().max(500).optional(),
    body: z.string().min(1).max(20_000),
  })
  .strict();

export const createEmailBodySchema = z
  .object({
    customerId: z.string().min(1),
    leadId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    recipient: z.string().email(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(50_000),
  })
  .strict();

export const createSmsBodySchema = z
  .object({
    customerId: z.string().min(1),
    leadId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    recipient: z.string().min(5).max(40),
    body: z.string().min(1).max(1600),
  })
  .strict();
