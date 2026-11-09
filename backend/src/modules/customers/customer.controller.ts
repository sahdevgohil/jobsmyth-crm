import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as customerService from './customer.service.js';
import type {
  createCustomerBodySchema,
  createPropertyBodySchema,
  customerIdParamsSchema,
  duplicateCheckBodySchema,
  listCustomersQuerySchema,
  propertyIdParamsSchema,
  updateCustomerBodySchema,
  updatePropertyBodySchema,
} from './customer.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listCustomersQuerySchema>>(req);
  const result = await customerService.listCustomers({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    ids: query.ids,
    includeArchived: query.includeArchived,
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createCustomerBodySchema>>(req);
  const data = await customerService.createCustomer({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof customerIdParamsSchema>>(req);
  const data = await customerService.getCustomer(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof customerIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateCustomerBodySchema>>(req);
  const data = await customerService.updateCustomer({
    auth: authCtx(req),
    id: params.id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function archive(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof customerIdParamsSchema>>(req);
  const data = await customerService.archiveCustomer({
    auth: authCtx(req),
    id: params.id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof customerIdParamsSchema>>(req);
  await customerService.deleteCustomer({
    auth: authCtx(req),
    id: params.id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(204).send();
}

export async function summary(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof customerIdParamsSchema>>(req);
  const data = await customerService.getCustomerSummary({
    auth: authCtx(req),
    id: params.id,
  });
  res.status(200).json({ data });
}

export async function duplicateCheck(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof duplicateCheckBodySchema>>(req);
  const data = await customerService.findDuplicateMatches(body);
  res.status(200).json({ data });
}

export async function listProperties(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof customerIdParamsSchema>>(req);
  const data = await customerService.listProperties(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function createProperty(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof customerIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof createPropertyBodySchema>>(req);
  const data = await customerService.createProperty({
    auth: authCtx(req),
    customerId: params.id,
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function getProperty(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof propertyIdParamsSchema>>(req);
  const data = await customerService.getProperty(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function updateProperty(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof propertyIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updatePropertyBodySchema>>(req);
  const data = await customerService.updateProperty({
    auth: authCtx(req),
    id: params.id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}
