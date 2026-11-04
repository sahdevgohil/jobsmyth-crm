import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as userService from './user.service.js';
import type {
  createUserBodySchema,
  listUsersQuerySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from './user.validation.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listUsersQuerySchema>>(req);
  const result = await userService.listUsers({
    page: query.page,
    pageSize: query.pageSize,
    role: query.role,
    isActive: query.isActive,
  });
  res.status(200).json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof userIdParamsSchema>>(req);
  const user = await userService.getUserById(params.id);
  res.status(200).json({ data: user });
}

export async function create(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const body = getValidatedBody<z.infer<typeof createUserBodySchema>>(req);
  const result = await userService.createUser({
    ...body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({
    data: {
      user: result.user,
      // Invite email delivery disabled until INT-03; token returned for Admin to share out-of-band / accept-invite flow.
      inviteToken: result.inviteToken,
      emailDeliveryEnabled: false,
    },
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const params = getValidatedParams<z.infer<typeof userIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateUserBodySchema>>(req);
  const user = await userService.updateUser({
    id: params.id,
    ...body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data: user });
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const params = getValidatedParams<z.infer<typeof userIdParamsSchema>>(req);
  const user = await userService.deactivateUser({
    id: params.id,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data: user });
}
