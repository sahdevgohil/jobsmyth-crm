import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as proposalService from './proposal.service.js';
import type {
  createProposalBodySchema,
  listProposalsQuerySchema,
  proposalIdParamsSchema,
  signatureRequestBodySchema,
  updateProposalBodySchema,
} from './proposal.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listProposalsQuerySchema>>(req);
  const result = await proposalService.listProposals({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    customerId: query.customerId,
    estimateId: query.estimateId,
    search: query.search,
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof createProposalBodySchema>>(req);
  const data = await proposalService.createProposalFromEstimate({
    auth: authCtx(req),
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const data = await proposalService.getProposal(id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateProposalBodySchema>>(req);
  const data = await proposalService.updateProposal({
    auth: authCtx(req),
    id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function send(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const result = await proposalService.sendProposal({
    auth: authCtx(req),
    id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({
    data: result.proposal,
    meta: { emailDelivery: result.emailDelivery },
  });
}

export async function accept(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const data = await proposalService.acceptProposal({
    auth: authCtx(req),
    id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function reject(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const data = await proposalService.rejectProposal({
    auth: authCtx(req),
    id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function signatureRequest(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof signatureRequestBodySchema>>(req);
  const data = await proposalService.requestSignature({
    auth: authCtx(req),
    id,
    ...body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export async function duplicate(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const data = await proposalService.duplicateProposal({
    auth: authCtx(req),
    id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function preview(req: Request, res: Response): Promise<void> {
  const { id } = getValidatedParams<z.infer<typeof proposalIdParamsSchema>>(req);
  const html = await proposalService.previewProposalHtml(id, authCtx(req));
  res.status(200).type('html').send(html);
}

export async function signatureStatus(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: proposalService.signatureIntegrationStatus() });
}
