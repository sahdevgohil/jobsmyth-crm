import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as activityService from './activity.service.js';
import type {
  activityIdParamsSchema,
  createActivityBodySchema,
  listActivitiesQuerySchema,
} from './activity.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listActivitiesQuerySchema>>(req);
  const data = await activityService.listActivities({
    auth: authCtx(req),
    entityType: query.entityType,
    entityId: query.entityId,
  });
  res.status(200).json({ data });
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createActivityBodySchema>>(req);
  const data = await activityService.createActivity({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function complete(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof activityIdParamsSchema>>(req);
  const data = await activityService.completeActivity({
    auth: authCtx(req),
    id: params.id,
  });
  res.status(200).json({ data });
}
