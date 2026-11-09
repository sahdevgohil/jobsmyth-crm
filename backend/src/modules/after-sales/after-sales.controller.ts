import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as service from './after-sales.service.js';
import type {
  afterSalesIdParamsSchema,
  createAfterSalesBodySchema,
  listAfterSalesQuerySchema,
  updateAfterSalesBodySchema,
} from './after-sales.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listAfterSalesQuerySchema>>(req);
  const data = await service.listAfterSales({
    auth: authCtx(req),
    customerId: query.customerId,
    projectId: query.projectId,
  });
  res.status(200).json({ data });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof afterSalesIdParamsSchema>>(req);
  const data = await service.getAfterSales({ auth: authCtx(req), id: params.id });
  res.status(200).json({ data });
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createAfterSalesBodySchema>>(req);
  const data = await service.createAfterSales({
    auth: authCtx(req),
    ...body,
  });
  res.status(201).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof afterSalesIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateAfterSalesBodySchema>>(req);
  const data = await service.updateAfterSales({
    auth: authCtx(req),
    id: params.id,
    ...body,
  });
  res.status(200).json({ data });
}
