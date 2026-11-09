import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import { getValidatedBody, getValidatedQuery } from '../../middleware/validate.js';
import * as service from './communication.service.js';
import type {
  createEmailBodySchema,
  createInternalNoteBodySchema,
  createSmsBodySchema,
  listCommunicationsQuerySchema,
} from './communication.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listCommunicationsQuerySchema>>(req);
  const data = await service.listCommunications({
    auth: authCtx(req),
    customerId: query.customerId,
    leadId: query.leadId,
    projectId: query.projectId,
    channel: query.channel,
  });
  res.status(200).json({ data });
}

export async function createNote(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createInternalNoteBodySchema>>(req);
  const data = await service.createInternalNote({
    auth: authCtx(req),
    ...body,
  });
  res.status(201).json({ data });
}

export async function createEmail(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createEmailBodySchema>>(req);
  const data = await service.createEmailAttempt({
    auth: authCtx(req),
    ...body,
  });
  res.status(201).json({ data });
}

export async function createSms(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createSmsBodySchema>>(req);
  const data = await service.createSmsAttempt({
    auth: authCtx(req),
    ...body,
  });
  res.status(201).json({ data });
}
