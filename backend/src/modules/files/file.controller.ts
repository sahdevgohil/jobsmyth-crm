import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as fileService from './file.service.js';
import type {
  fileIdParamsSchema,
  listFilesQuerySchema,
  uploadFileBodySchema,
} from './file.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role, companyId: auth.companyId, permissions: auth.permissions };
}

/** Build a safe `Content-Disposition: attachment` value (ASCII fallback + RFC 5987 name). */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listFilesQuerySchema>>(req);
  const result = await fileService.listFiles({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    category: query.category,
    customerId: query.customerId,
    propertyId: query.propertyId,
    inspectionId: query.inspectionId,
    projectId: query.projectId,
    formSubmissionId: query.formSubmissionId,
    formFieldId: query.formFieldId,
    leadId: query.leadId,
    appointmentId: query.appointmentId,
    visibility: query.visibility,
    uploadedBy: query.uploadedBy,
  });
  res.status(200).json(result);
}

export async function upload(req: Request, res: Response): Promise<void> {
  const body = getValidatedBody<z.infer<typeof uploadFileBodySchema>>(req);
  const data = await fileService.uploadFile({
    auth: authCtx(req),
    filename: body.filename,
    mimeType: body.mimeType,
    category: body.category,
    contentBase64: body.contentBase64,
    caption: body.caption,
    visibility: body.visibility,
    customerId: body.customerId,
    propertyId: body.propertyId,
    inspectionId: body.inspectionId,
    projectId: body.projectId,
    formSubmissionId: body.formSubmissionId,
    formFieldId: body.formFieldId,
    tag: body.tag,
    capturedAt: body.capturedAt,
    gps: body.gps,
    clientId: body.clientId,
    leadId: body.leadId,
    appointmentId: body.appointmentId,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof fileIdParamsSchema>>(req);
  const data = await fileService.getFile(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function download(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof fileIdParamsSchema>>(req);
  const { file, object } = await fileService.openFileForDownload(params.id, authCtx(req));
  res.status(200);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', object.sizeBytes.toString());
  res.setHeader('Content-Disposition', attachmentDisposition(file.originalFilename));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  await pipeline(object.body, res);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof fileIdParamsSchema>>(req);
  await fileService.deleteFile({
    auth: authCtx(req),
    id: params.id,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(204).end();
}
