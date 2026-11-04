import type { Request, Response } from 'express';
import type { z } from 'zod';
import { getValidatedQuery } from '../../middleware/validate.js';
import * as auditService from './audit.service.js';
import type { listAuditQuerySchema } from './audit.validation.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = getValidatedQuery<z.infer<typeof listAuditQuerySchema>>(req);
  const result = await auditService.listAuditLogs({
    page: query.page,
    pageSize: query.pageSize,
    action: query.action,
    entityType: query.entityType,
    entityId: query.entityId,
    actorId: query.actorId,
  });
  res.status(200).json(result);
}
