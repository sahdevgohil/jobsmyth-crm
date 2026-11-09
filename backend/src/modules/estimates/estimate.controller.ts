import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import { acceptEstimate, denyEstimate, reopenEstimate } from './estimate.lifecycle.js';
import * as estimateService from './estimate.service.js';
import type {
  denyEstimateBodySchema,
  reopenEstimateBodySchema,
  createEstimateBodySchema,
  duplicateEstimateBodySchema,
  estimateIdParamsSchema,
  listEstimatesQuerySchema,
  updateEstimateBodySchema,
} from './estimate.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listEstimatesQuerySchema>>(req);
  const result = await estimateService.listEstimates({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    customerId: query.customerId,
    propertyId: query.propertyId,
    inspectionId: query.inspectionId,
    measurementId: query.measurementId,
    leadId: query.leadId,
  });
  res.status(200).json(result);
}

export async function catalog(_req: Request, res: Response): Promise<void> {
  const data = await estimateService.getEstimateCatalog();
  res.status(200).json({ data });
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createEstimateBodySchema>>(req);
  const data = await estimateService.createEstimate({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  const data = await estimateService.getEstimate(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateEstimateBodySchema>>(req);
  const data = await estimateService.updateEstimate({
    auth: authCtx(req),
    id: params.id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function duplicate(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof duplicateEstimateBodySchema>>(req);
  const data = await estimateService.duplicateEstimate({
    auth: authCtx(req),
    id: params.id,
    mode: body.mode,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function voidOne(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  const data = await estimateService.voidEstimate({
    auth: authCtx(req),
    id: params.id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function preview(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  const html = await estimateService.getEstimatePreviewHtml(params.id, authCtx(req));
  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
}

export async function accept(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  res.status(200).json({ data: await acceptEstimate({ auth: authCtx(req), id: params.id, requestId: req.requestId, ip: req.ip }) });
}

export async function deny(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof denyEstimateBodySchema>>(req);
  res.status(200).json({ data: await denyEstimate({ auth: authCtx(req), id: params.id, reason: body.reason, note: body.note, requestId: req.requestId, ip: req.ip }) });
}

export async function reopen(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof estimateIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof reopenEstimateBodySchema>>(req);
  res.status(200).json({ data: await reopenEstimate({ auth: authCtx(req), id: params.id, reason: body.reason, requestId: req.requestId, ip: req.ip }) });
}
