import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
} from '../../middleware/validate.js';
import * as settingsService from './settings.service.js';
import * as pipelineStageService from './pipeline-stage.service.js';
import * as pricingService from './pricing.service.js';
import type {
  createLookupBodySchema,
  createPipelineStageBodySchema,
  lookupIdParamsSchema,
  lookupTypeParamsSchema,
  patchCompanyBodySchema,
  patchPricingBodySchema,
  pipelineStageIdParamsSchema,
  reorderPipelineStagesBodySchema,
  updateLookupBodySchema,
  updatePipelineStageBodySchema,
} from './settings.validation.js';

export async function getCompany(_req: Request, res: Response): Promise<void> {
  const data = await settingsService.getCompanySettings();
  res.status(200).json({ data });
}

export async function patchCompany(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const body = getValidatedBody<z.infer<typeof patchCompanyBodySchema>>(req);
  const data = await settingsService.patchCompanySettings({
    patch: body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function listLookups(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof lookupTypeParamsSchema>>(req);
  const includeInactive = req.auth?.role === 'admin';
  const data = await settingsService.listLookups(params.type, includeInactive);
  res.status(200).json({ data });
}

export async function createLookup(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const params = getValidatedParams<z.infer<typeof lookupTypeParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof createLookupBodySchema>>(req);
  const data = await settingsService.createLookup({
    type: params.type,
    ...body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function updateLookup(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const params = getValidatedParams<z.infer<typeof lookupIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateLookupBodySchema>>(req);
  const data = await settingsService.updateLookup({
    type: params.type,
    id: params.id,
    ...body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function listPipelineStages(req: Request, res: Response): Promise<void> {
  const includeInactive = req.auth?.role === 'admin';
  const data = await pipelineStageService.listPipelineStages('lead', includeInactive);
  res.status(200).json({ data });
}

export async function createPipelineStage(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const body = getValidatedBody<z.infer<typeof createPipelineStageBodySchema>>(req);
  const data = await pipelineStageService.createPipelineStage({
    pipeline: 'lead',
    ...body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function updatePipelineStage(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const params = getValidatedParams<z.infer<typeof pipelineStageIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updatePipelineStageBodySchema>>(req);
  const data = await pipelineStageService.updatePipelineStage({
    id: params.id,
    ...body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function reorderPipelineStages(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const body = getValidatedBody<z.infer<typeof reorderPipelineStagesBodySchema>>(req);
  const data = await pipelineStageService.reorderPipelineStages({
    orderedIds: body.orderedIds,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function getPricing(_req: Request, res: Response): Promise<void> {
  const data = await pricingService.getPricingConfig();
  res.status(200).json({ data });
}

export async function patchPricing(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const body = getValidatedBody<z.infer<typeof patchPricingBodySchema>>(req);
  const data = await pricingService.patchPricingConfig({
    patch: body,
    actorId: auth.userId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}
