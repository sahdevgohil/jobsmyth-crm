import type { Request, Response } from 'express';
import type { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import { AppError } from '../../utils/errors.js';
import * as leadService from './lead.service.js';
import type {
  assignLeadBodySchema,
  changeStageBodySchema,
  convertLeadBodySchema,
  createLeadBodySchema,
  duplicateCheckBodySchema,
  leadIdParamsSchema,
  listLeadsQuerySchema,
  updateLeadBodySchema,
  websiteLeadBodySchema,
} from './lead.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listLeadsQuerySchema>>(req);
  const result = await leadService.listLeads({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    stageId: query.stageId,
    sourceKey: query.sourceKey,
    assignedTo: query.assignedTo,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    hasOverdueFollowUp: query.hasOverdueFollowUp,
    search: query.search,
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createLeadBodySchema>>(req);
  const data = await leadService.createLead({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof leadIdParamsSchema>>(req);
  const data = await leadService.getLead(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof leadIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateLeadBodySchema>>(req);
  const data = await leadService.updateLead({
    auth: authCtx(req),
    id: params.id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function changeStage(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof leadIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof changeStageBodySchema>>(req);
  const data = await leadService.changeStage({
    auth: authCtx(req),
    id: params.id,
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function assign(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof leadIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof assignLeadBodySchema>>(req);
  const data = await leadService.assignLead({
    auth: authCtx(req),
    id: params.id,
    assignedTo: body.assignedTo,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function convert(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof leadIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof convertLeadBodySchema>>(req);
  const data = await leadService.convertLead({
    auth: authCtx(req),
    id: params.id,
    existingCustomerId: body.existingCustomerId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function duplicateCheck(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof duplicateCheckBodySchema>>(req);
  const data = await leadService.findDuplicateMatches(body);
  res.status(200).json({ data });
}

export async function websiteIntake(req: Request, res: Response): Promise<void> {
  const secret = getEnv().WEBSITE_LEAD_INTAKE_SECRET;
  if (!secret) {
    throw new AppError({
      status: 503,
      code: 'INTAKE_NOT_CONFIGURED',
      message: 'Website lead intake is not configured.',
    });
  }
  const provided = req.header('x-website-lead-secret') ?? '';
  if (provided !== secret) {
    throw new AppError({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid intake secret.',
    });
  }

  const body = getValidatedBody<z.infer<typeof websiteLeadBodySchema>>(req);
  const result = await leadService.ingestWebsiteLead({
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });

  // Honeypot: look like success without revealing
  res.status(201).json({
    data: {
      accepted: true,
      leadId: result.leadId,
      created: result.created,
    },
  });
}
