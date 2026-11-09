import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as inspectionService from './inspection.service.js';
import type {
  createInspectionBodySchema,
  inspectionIdParamsSchema,
  listInspectionsQuerySchema,
  updateInspectionBodySchema,
} from './inspection.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listInspectionsQuerySchema>>(req);
  const result = await inspectionService.listInspections({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    customerId: query.customerId,
    propertyId: query.propertyId,
    appointmentId: query.appointmentId,
    leadId: query.leadId,
    assignedTo: query.assignedTo,
    from: query.from,
    to: query.to,
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createInspectionBodySchema>>(req);
  const data = await inspectionService.createInspection({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof inspectionIdParamsSchema>>(req);
  const data = await inspectionService.getInspection(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof inspectionIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateInspectionBodySchema>>(req);
  const data = await inspectionService.updateInspection({
    auth: authCtx(req),
    id: params.id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function complete(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof inspectionIdParamsSchema>>(req);
  const data = await inspectionService.completeInspection({
    auth: authCtx(req),
    id: params.id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof inspectionIdParamsSchema>>(req);
  const data = await inspectionService.cancelInspection({
    auth: authCtx(req),
    id: params.id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function report(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof inspectionIdParamsSchema>>(req);
  const html = await inspectionService.getInspectionReportHtml(params.id, authCtx(req));
  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
}
