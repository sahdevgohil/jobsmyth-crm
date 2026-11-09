import type { ClientSession, Types } from 'mongoose';
import { AuditLogModel } from '../modules/audit/audit-log.model.js';

export type AuditInput = {
  actorType: 'user' | 'system' | 'customer';
  actorId?: Types.ObjectId | string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: unknown;
  requestId?: string;
  ip?: string;
  session?: ClientSession;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  const doc = {
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    changes: input.changes,
    requestId: input.requestId,
    ip: input.ip,
  };

  if (input.session) {
    await AuditLogModel.create([doc], { session: input.session });
    return;
  }
  await AuditLogModel.create(doc);
}
