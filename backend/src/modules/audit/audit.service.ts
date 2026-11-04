import { paginationMeta, skipLimit } from '../../utils/pagination.js';
import { AuditLogModel } from './audit-log.model.js';

export type AuditLogDto = {
  id: string;
  actorType: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: unknown;
  requestId?: string;
  ip?: string;
  createdAt: string;
};

export async function listAuditLogs(input: {
  page: number;
  pageSize: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
}): Promise<{ data: AuditLogDto[]; meta: { page: number; pageSize: number; total: number } }> {
  const filter: Record<string, unknown> = {};
  if (input.action) filter.action = input.action;
  if (input.entityType) filter.entityType = input.entityType;
  if (input.entityId) filter.entityId = input.entityId;
  if (input.actorId) filter.actorId = input.actorId;

  const { skip, limit } = skipLimit(input.page, input.pageSize);
  const [total, rows] = await Promise.all([
    AuditLogModel.countDocuments(filter),
    AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);

  return {
    data: rows.map((row) => ({
      id: row._id.toString(),
      actorType: row.actorType,
      actorId: row.actorId?.toString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      changes: row.changes,
      requestId: row.requestId ?? undefined,
      ip: row.ip ?? undefined,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: paginationMeta(total, input.page, input.pageSize),
  };
}
