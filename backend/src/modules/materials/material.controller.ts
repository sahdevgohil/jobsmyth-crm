import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as materialService from './material.service.js';
import type {
  createMaterialBodySchema,
  createMaterialRequirementBodySchema,
  listMaterialRequirementsQuerySchema,
  listMaterialsQuerySchema,
  materialIdParamsSchema,
  materialRequirementIdParamsSchema,
  updateMaterialBodySchema,
  updateMaterialRequirementBodySchema,
} from './material.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listMaterialsQuerySchema>>(req);
  const result = await materialService.listMaterials({
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    active: query.active === undefined ? undefined : query.active === 'true',
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createMaterialBodySchema>>(req);
  const data = await materialService.createMaterial({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof materialIdParamsSchema>>(req);
  const data = await materialService.getMaterial(id);
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof materialIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateMaterialBodySchema>>(req);
  const data = await materialService.updateMaterial({
    auth: authCtx(req),
    id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function listRequirements(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listMaterialRequirementsQuerySchema>>(req);
  const result = await materialService.listMaterialRequirements({
    page: query.page,
    pageSize: query.pageSize,
    materialId: query.materialId,
    estimateId: query.estimateId,
    proposalId: query.proposalId,
    projectId: query.projectId,
    status: query.status,
  });
  res.status(200).json(result);
}

export async function createRequirement(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createMaterialRequirementBodySchema>>(req);
  const data = await materialService.createMaterialRequirement({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function updateRequirement(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof materialRequirementIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateMaterialRequirementBodySchema>>(req);
  const data = await materialService.updateMaterialRequirement({
    auth: authCtx(req),
    id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}
