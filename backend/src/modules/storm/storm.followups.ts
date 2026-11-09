/**
 * Past-customer follow-up flags: a completed job whose property later has a qualifying report nearby.
 * One flag per (project, event). A flag is never re-created once it exists, so a dismissed one stays dismissed.
 * It does not say the roof is damaged.
 */
import mongoose, { type Types } from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { ActivityModel } from '../activities/activity.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { distanceMiles, milesToRadians, validLatLng } from './geo.js';
import { StormEventModel, StormFollowUpFlagModel } from './storm.model.js';
import { POINT_PRECISIONS } from './storm.types.js';
import { companyCustomerIds, type StormCtx } from './storm.zones.js';

export const FOLLOW_UP_WORDING = 'Nearby storm activity detected after completed roof work — follow-up may be appropriate.';
export const DEFAULT_FOLLOWUP_RADIUS = 3;

export type DetectResult = { projectsChecked: number; projectsWithoutLocation: number; projectsWithoutCompletionDate: number; flagsCreated: number; existingFlags: number };

/** Finds new flags for completed jobs. `customerId` limits the scan to one customer. */
export async function detectFlags(ctx: StormCtx, o: { radiusMiles?: number; customerId?: string } = {}): Promise<DetectResult> {
  const radius = Math.min(10, Math.max(1, o.radiusMiles ?? Number(process.env.STORM_FOLLOWUP_RADIUS_MILES ?? DEFAULT_FOLLOWUP_RADIUS)));
  const customers = await companyCustomerIds(ctx.companyId);
  const projects = await ProjectModel.find({ customerId: o.customerId && mongoose.isValidObjectId(o.customerId) ? o.customerId : { $in: customers }, status: { $in: ['completed', 'closed'] } }).limit(5000);
  if (o.customerId && !customers.some((c) => c.toString() === o.customerId)) return { projectsChecked: 0, projectsWithoutLocation: 0, projectsWithoutCompletionDate: 0, flagsCreated: 0, existingFlags: 0 };
  const props = new Map((await PropertyModel.find({ _id: { $in: projects.map((p) => p.propertyId) } }).select('location').lean()).map((p) => [String(p._id), p.location]));
  const out: DetectResult = { projectsChecked: 0, projectsWithoutLocation: 0, projectsWithoutCompletionDate: 0, flagsCreated: 0, existingFlags: 0 };
  for (const p of projects) {
    const loc = props.get(String(p.propertyId));
    if (loc?.lat == null || loc?.lng == null || !validLatLng(loc.lat, loc.lng)) { out.projectsWithoutLocation += 1; continue; }
    if (!p.actualEndAt) { out.projectsWithoutCompletionDate += 1; continue; }
    out.projectsChecked += 1;
    const events = await StormEventModel.find({
      qualifies: true,
      coordinatePrecision: { $in: POINT_PRECISIONS },
      eventDate: { $gt: p.actualEndAt },
      location: { $geoWithin: { $centerSphere: [[loc.lng, loc.lat], milesToRadians(radius)] } },
    }).sort({ eventDate: -1 }).limit(25).lean();
    for (const e of events) {
      const d = distanceMiles({ lat: loc.lat, lng: loc.lng }, { lat: e.latitude as number, lng: e.longitude as number });
      const r = await StormFollowUpFlagModel.updateOne(
        { projectId: p._id, eventId: e._id },
        { $setOnInsert: { companyId: ctx.companyId, customerId: p.customerId, propertyId: p.propertyId, projectId: p._id, eventId: e._id, completedAt: p.actualEndAt, eventDate: e.eventDate, eventType: e.eventType, magnitude: e.eventType === 'hail' ? e.hailSizeInches : e.windSpeedMph, distanceMiles: Math.round(d * 10) / 10, radiusMiles: radius, status: 'new', note: '' } },
        { upsert: true },
      );
      if (r.upsertedCount > 0) out.flagsCreated += 1; else out.existingFlags += 1;
    }
  }
  if (out.flagsCreated > 0) await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.followup_flags_created', entityType: 'storm_follow_up', entityId: 'scan', changes: { ...out, radius }, requestId: ctx.requestId, ip: ctx.ip }).catch(() => undefined);
  return out;
}

export type FlagDto = {
  id: string; status: string; message: string;
  customer: { id: string; name: string }; property: { id: string; address: string } | null; projectId: string;
  completedAt: string; event: { id: string; type: string; date: string; magnitude: number | null; label: string }; distanceMiles: number; radiusMiles: number;
  note: string; reviewedAt: string | null;
};

const customerName = (c: { type?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null }): string => (c.type === 'business' && c.companyName ? c.companyName : `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()) || 'Unnamed customer';

export async function listFlags(ctx: StormCtx, q: { status?: string; customerId?: string; page: number; pageSize: number }) {
  const customers = await companyCustomerIds(ctx.companyId);
  let scope: Types.ObjectId[] = customers;
  if (ctx.role !== 'admin') {
    const mine = new Set((await CustomerModel.find({ ownerId: ctx.userId }).distinct('_id')).map(String));
    scope = customers.filter((c) => mine.has(c.toString()));
  }
  const filter: Record<string, unknown> = { customerId: { $in: scope } };
  if (q.status) filter.status = q.status;
  if (q.customerId && mongoose.isValidObjectId(q.customerId)) filter.customerId = scope.find((c) => c.toString() === q.customerId) ?? { $in: [] };
  const [rows, total] = await Promise.all([
    StormFollowUpFlagModel.find(filter).sort({ eventDate: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    StormFollowUpFlagModel.countDocuments(filter),
  ]);
  const [cs, ps] = await Promise.all([
    CustomerModel.find({ _id: { $in: rows.map((r) => r.customerId) } }).select('type firstName lastName companyName').lean(),
    PropertyModel.find({ _id: { $in: rows.map((r) => r.propertyId) } }).select('address').lean(),
  ]);
  const cm = new Map(cs.map((c) => [String(c._id), customerName(c)]));
  const pm = new Map(ps.map((p) => [String(p._id), [p.address?.line1, p.address?.city, [p.address?.state, p.address?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]));
  return {
    data: rows.map((r): FlagDto => ({
      id: String(r._id), status: r.status, message: FOLLOW_UP_WORDING,
      customer: { id: String(r.customerId), name: cm.get(String(r.customerId)) ?? 'Unknown customer' },
      property: pm.has(String(r.propertyId)) ? { id: String(r.propertyId), address: pm.get(String(r.propertyId)) as string } : null,
      projectId: String(r.projectId), completedAt: r.completedAt.toISOString(),
      event: { id: String(r.eventId), type: r.eventType, date: r.eventDate.toISOString(), magnitude: r.magnitude ?? null, label: r.eventType === 'hail' ? `${(r.magnitude ?? 0).toFixed(2)} in hail` : `${Math.round(r.magnitude ?? 0)} mph wind` },
      distanceMiles: r.distanceMiles, radiusMiles: r.radiusMiles, note: r.note ?? '', reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    })),
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    disclaimer: 'A storm report near a completed job is a reason to check in with the customer. It does not mean the roof is damaged.',
  };
}

async function loadFlag(ctx: StormCtx, id: string) {
  if (!mongoose.isValidObjectId(id)) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Flag not found.' });
  const f = await StormFollowUpFlagModel.findById(id);
  const customers = f ? await companyCustomerIds(ctx.companyId) : [];
  if (!f || !customers.some((c) => c.equals(f.customerId))) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Flag not found.' });
  if (ctx.role !== 'admin') {
    const c = await CustomerModel.findById(f.customerId).select('ownerId').lean();
    if (!c || c.ownerId.toString() !== ctx.userId) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Flag not found.' });
  }
  return f;
}

export async function reviewFlag(ctx: StormCtx, id: string, action: 'reviewed' | 'dismissed', note = ''): Promise<void> {
  const f = await loadFlag(ctx, id);
  f.status = action;
  f.reviewedBy = new mongoose.Types.ObjectId(ctx.userId) as never;
  f.reviewedAt = new Date();
  if (note) f.note = note;
  await f.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: `storm.followup_${action}`, entityType: 'storm_follow_up', entityId: id, changes: { note }, requestId: ctx.requestId, ip: ctx.ip });
}

/** Creates a normal CRM activity (follow-up task, call reminder or note) on the customer, linked back to the flag. */
export async function createFlagActivity(ctx: StormCtx, id: string, a: { type: 'follow_up' | 'call' | 'note'; dueAt?: Date; body?: string; assignedTo?: string }) {
  const f = await loadFlag(ctx, id);
  if (a.type !== 'note' && !a.dueAt) throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'A task or call reminder needs a due date.' });
  const text = a.body?.trim() || `${FOLLOW_UP_WORDING} (${f.eventType === 'hail' ? `${(f.magnitude ?? 0).toFixed(2)} in hail` : `${Math.round(f.magnitude ?? 0)} mph wind`}, ${f.distanceMiles} mi from the property, ${f.eventDate.toISOString().slice(0, 10)})`;
  const owner = a.assignedTo ?? (await CustomerModel.findById(f.customerId).select('ownerId').lean())?.ownerId?.toString();
  const act = await ActivityModel.create({ entityType: 'customer', entityId: f.customerId, type: a.type, body: text, dueAt: a.dueAt ?? null, assignedTo: a.type === 'note' ? null : owner ?? ctx.userId, metadata: { stormFlagId: f._id.toString(), stormEventId: f.eventId.toString() }, createdBy: ctx.userId });
  f.activityIds.push(act._id as never);
  if (f.status === 'new') { f.status = 'reviewed'; f.reviewedBy = new mongoose.Types.ObjectId(ctx.userId) as never; f.reviewedAt = new Date(); }
  await f.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.followup_activity_created', entityType: 'storm_follow_up', entityId: id, changes: { type: a.type, activityId: act._id.toString() }, requestId: ctx.requestId, ip: ctx.ip });
  return { activityId: act._id.toString(), flagStatus: f.status };
}
