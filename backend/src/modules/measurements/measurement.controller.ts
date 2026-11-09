import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import * as measurementService from './measurement.service.js';
import type {
  createMeasurementBodySchema,
  importMeasurementBodySchema,
  listMeasurementsQuerySchema,
  measurementIdParamsSchema,
  updateMeasurementBodySchema,
} from './measurement.validation.js';

function authCtx(req: Request) {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listMeasurementsQuerySchema>>(req);
  const result = await measurementService.listMeasurements({
    auth: authCtx(req),
    page: query.page,
    pageSize: query.pageSize,
    customerId: query.customerId,
    propertyId: query.propertyId,
    inspectionId: query.inspectionId,
    source: query.source,
  });
  res.status(200).json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { propertyId, customerId, inspectionId, source, ...fields } =
    getValidatedBody<z.infer<typeof createMeasurementBodySchema>>(req);
  const data = await measurementService.createMeasurement({
    auth: authCtx(req),
    propertyId,
    customerId,
    inspectionId,
    source,
    fields,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function importRecord(req: Request, res: Response): Promise<void> {
  const { propertyId, customerId, inspectionId, importedFilename, ...fields } =
    getValidatedBody<z.infer<typeof importMeasurementBodySchema>>(req);
  const data = await measurementService.importMeasurement({
    auth: authCtx(req),
    propertyId,
    customerId,
    inspectionId,
    importedFilename,
    fields,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function get(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof measurementIdParamsSchema>>(req);
  const data = await measurementService.getMeasurement(params.id, authCtx(req));
  res.status(200).json({ data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = getValidatedParams<z.infer<typeof measurementIdParamsSchema>>(req);
  const body = getValidatedBody<z.infer<typeof updateMeasurementBodySchema>>(req);
  const data = await measurementService.updateMeasurement({
    auth: authCtx(req),
    id: params.id,
    patch: body,
    requestId: req.requestId,
    ip: req.ip,
  });
  res.status(200).json({ data });
}

export function integrationStatus(_req: Request, res: Response): void {
  res.status(200).json({ data: measurementService.getIntegrationStatus() });
}
