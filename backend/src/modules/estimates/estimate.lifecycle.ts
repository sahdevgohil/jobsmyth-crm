import mongoose from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { syncPipelineFromEstimate } from '../pipeline/pipeline.hooks.js';
import type { EstimateDocument } from './estimate.model.js';
import { findEstimateInScope, toDto, type AuthContext, type EstimateDto } from './estimate.service.js';

type Ctx = { auth: AuthContext; id: string; requestId?: string; ip?: string };

function bad(code: string, message: string, status = 409): AppError {
  return new AppError({ status, code, message });
}

function log(doc: EstimateDocument, from: string, to: string, by: string, reason = '', note = ''): void {
  doc.statusHistory.push({ from, to, at: new Date(), by: new mongoose.Types.ObjectId(by), reason, note });
}

async function audit(c: Ctx, doc: EstimateDocument, action: string, changes: Record<string, unknown>): Promise<void> {
  await recordAudit({ actorType: 'user', actorId: c.auth.userId, action, entityType: 'estimate', entityId: doc._id.toString(), changes, requestId: c.requestId, ip: c.ip });
}

/** A sent estimate the customer approved. Moves the job to Estimates Accepted. */
export async function acceptEstimate(c: Ctx & { source?: 'staff' | 'proposal' }): Promise<EstimateDto> {
  const doc = await findEstimateInScope(c.id, c.auth);
  if (doc.status === 'accepted') return toDto(doc); // idempotent
  if (doc.status !== 'sent') throw bad('INVALID_STATE', `Only a sent estimate can be accepted (this one is ${doc.status}).`);
  const from = doc.status;
  doc.status = 'accepted';
  doc.acceptedAt = new Date();
  doc.acceptedBy = new mongoose.Types.ObjectId(c.auth.userId);
  log(doc, from, 'accepted', c.auth.userId, c.source === 'proposal' ? 'Proposal accepted' : '');
  await doc.save();
  await audit(c, doc, 'estimate.accepted', { from, totalCents: doc.totalCents });
  await syncPipelineFromEstimate(doc._id.toString(), { actorId: c.auth.userId, trigger: 'estimate_accepted' });
  return toDto(doc);
}

/** The customer declined. The estimate is kept (never deleted) and leaves every active pipeline total. */
export async function denyEstimate(c: Ctx & { reason: string; note?: string }): Promise<EstimateDto> {
  const doc = await findEstimateInScope(c.id, c.auth);
  if (doc.status === 'denied') throw bad('INVALID_STATE', 'This estimate is already denied.');
  if (doc.status !== 'sent' && doc.status !== 'accepted') throw bad('INVALID_STATE', `Only a sent or accepted estimate can be denied (this one is ${doc.status}).`);
  const projectStarted = await mongoose.connection.collection('projects').countDocuments({ estimateId: doc._id, status: { $nin: ['cancelled', 'awaiting_approval'] } });
  if (projectStarted > 0) throw bad('PROJECT_EXISTS', 'A project already exists for this estimate. Cancel the project instead of denying the estimate.');
  const from = doc.status;
  doc.status = 'denied';
  doc.deniedAt = new Date();
  doc.deniedBy = new mongoose.Types.ObjectId(c.auth.userId);
  doc.denialReason = c.reason.trim();
  doc.denialNote = (c.note ?? '').trim();
  log(doc, from, 'denied', c.auth.userId, doc.denialReason, doc.denialNote);
  await doc.save();
  await audit(c, doc, 'estimate.denied', { from, reason: doc.denialReason, note: doc.denialNote, totalCents: doc.totalCents });
  await syncPipelineFromEstimate(doc._id.toString(), { actorId: c.auth.userId, trigger: 'estimate_denied' });
  return toDto(doc);
}

/** Puts a denied estimate back in front of the customer (Estimates Out). History keeps the denial. */
export async function reopenEstimate(c: Ctx & { reason?: string }): Promise<EstimateDto> {
  const doc = await findEstimateInScope(c.id, c.auth);
  if (doc.status !== 'denied' && String(doc.status) !== 'rejected') throw bad('INVALID_STATE', 'Only a denied estimate can be reopened.');
  const from = doc.status;
  doc.status = 'sent';
  doc.sentAt = new Date();
  log(doc, from, 'sent', c.auth.userId, c.reason?.trim() || 'Reopened');
  await doc.save();
  await audit(c, doc, 'estimate.reopened', { from, reason: c.reason ?? '' });
  await syncPipelineFromEstimate(doc._id.toString(), { actorId: c.auth.userId, trigger: 'estimate_reopened' });
  return toDto(doc);
}
