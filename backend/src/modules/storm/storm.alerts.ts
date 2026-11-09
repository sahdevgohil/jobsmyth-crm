/**
 * Territory alerts. A rule watches one zone. When a new qualifying report falls in (or near) that zone the zone's
 * representative, optionally the admins and any named recipients are notified, once per rule and event.
 * Delivery results are recorded per channel exactly as they happened: email and SMS report "not_configured" until a
 * provider is wired in, and the alert never claims otherwise.
 */
import mongoose, { type Types } from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { sendEmail } from '../../services/email/email.adapter.js';
import { sendSms } from '../../services/sms/sms.adapter.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { createNotification } from '../notifications/notification.service.js';
import { UserModel } from '../users/user.model.js';
import { distanceMiles } from './geo.js';
import { StormAlertModel, StormAlertRuleModel, StormEventModel, StormZoneModel, type StormAlertRuleDocument, type StormZoneDocument } from './storm.model.js';
import { HAIL_MIN_INCHES, WIND_MIN_MPH } from './storm.types.js';
import { companyUserIds, loadZone, type StormCtx } from './storm.zones.js';

let log: Logger | undefined;
const getLog = (): Logger => (log ??= createLogger());

/** Only events from the last few days alert; a historical backfill must never flood anyone. */
export const ALERT_WINDOW_DAYS = 3;

export type RuleInput = {
  name: string;
  zoneId: string;
  enabled?: boolean;
  radiusMiles?: number;
  hailMinInches?: number;
  windMinMph?: number;
  notifyAssignee?: boolean;
  notifyAdmins?: boolean;
  recipientUserIds?: string[];
  channels?: { inApp?: boolean; email?: boolean; sms?: boolean };
};

const notFound = (): AppError => new AppError({ status: 404, code: 'NOT_FOUND', message: 'Alert rule not found.' });

function ruleDto(r: StormAlertRuleDocument, zoneName?: string) {
  return {
    id: r._id.toString(), name: r.name, enabled: r.enabled, zoneId: r.zoneId.toString(), zoneName: zoneName ?? '',
    radiusMiles: r.radiusMiles, hailMinInches: r.hailMinInches, windMinMph: r.windMinMph,
    notifyAssignee: r.notifyAssignee, notifyAdmins: r.notifyAdmins, recipientUserIds: r.recipientUserIds.map(String),
    channels: { inApp: r.channels?.inApp ?? true, email: r.channels?.email ?? false, sms: r.channels?.sms ?? false },
    createdAt: (r as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

function validate(i: Partial<RuleInput>): void {
  const bad = (m: string): never => { throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: m }); };
  if (i.hailMinInches !== undefined && i.hailMinInches < HAIL_MIN_INCHES) bad(`The hail threshold cannot be below ${HAIL_MIN_INCHES.toFixed(2)} inch.`);
  if (i.windMinMph !== undefined && i.windMinMph < WIND_MIN_MPH) bad(`The wind threshold cannot be below ${WIND_MIN_MPH} mph.`);
  if (i.radiusMiles !== undefined && (i.radiusMiles < 0 || i.radiusMiles > 50)) bad('The event radius must be between 0 and 50 miles.');
}

async function checkRecipients(ctx: StormCtx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const allowed = new Set((await companyUserIds(ctx.companyId)).map(String));
  if (ids.some((i) => !allowed.has(i))) throw new AppError({ status: 422, code: 'INVALID_USER', message: 'A recipient is not in your company.' });
}

export async function listRules(ctx: StormCtx) {
  const rules = await StormAlertRuleModel.find({ companyId: ctx.companyId }).sort({ createdAt: -1 }).limit(200);
  const zones = await StormZoneModel.find({ _id: { $in: rules.map((r) => r.zoneId) } }).select('name').lean();
  const zn = new Map(zones.map((z) => [String(z._id), z.name]));
  return rules.map((r) => ruleDto(r, zn.get(String(r.zoneId))));
}

export async function createRule(ctx: StormCtx, i: RuleInput) {
  validate(i);
  const zone = await loadZone(ctx, i.zoneId);
  await checkRecipients(ctx, i.recipientUserIds ?? []);
  const r = await StormAlertRuleModel.create({
    companyId: ctx.companyId, name: i.name.trim(), zoneId: zone._id, enabled: i.enabled ?? true, radiusMiles: i.radiusMiles ?? 0,
    hailMinInches: i.hailMinInches ?? HAIL_MIN_INCHES, windMinMph: i.windMinMph ?? WIND_MIN_MPH,
    notifyAssignee: i.notifyAssignee ?? true, notifyAdmins: i.notifyAdmins ?? false, recipientUserIds: i.recipientUserIds ?? [],
    channels: { inApp: i.channels?.inApp ?? true, email: i.channels?.email ?? false, sms: i.channels?.sms ?? false }, createdBy: ctx.userId,
  });
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.alert_rule_created', entityType: 'storm_alert_rule', entityId: r._id.toString(), changes: i, requestId: ctx.requestId, ip: ctx.ip });
  return ruleDto(r, zone.name);
}

export async function updateRule(ctx: StormCtx, id: string, i: Partial<RuleInput>) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const r = await StormAlertRuleModel.findOne({ _id: id, companyId: ctx.companyId });
  if (!r) throw notFound();
  validate(i);
  const before = ruleDto(r);
  if (i.zoneId) r.zoneId = (await loadZone(ctx, i.zoneId))._id as never;
  if (i.recipientUserIds) { await checkRecipients(ctx, i.recipientUserIds); r.recipientUserIds = i.recipientUserIds.map((x) => new mongoose.Types.ObjectId(x)) as never; }
  if (i.name !== undefined) r.name = i.name.trim();
  if (i.enabled !== undefined) r.enabled = i.enabled;
  if (i.radiusMiles !== undefined) r.radiusMiles = i.radiusMiles;
  if (i.hailMinInches !== undefined) r.hailMinInches = i.hailMinInches;
  if (i.windMinMph !== undefined) r.windMinMph = i.windMinMph;
  if (i.notifyAssignee !== undefined) r.notifyAssignee = i.notifyAssignee;
  if (i.notifyAdmins !== undefined) r.notifyAdmins = i.notifyAdmins;
  if (i.channels) r.channels = { inApp: i.channels.inApp ?? r.channels?.inApp ?? true, email: i.channels.email ?? r.channels?.email ?? false, sms: i.channels.sms ?? r.channels?.sms ?? false } as never;
  await r.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.alert_rule_changed', entityType: 'storm_alert_rule', entityId: id, changes: { before, patch: i }, requestId: ctx.requestId, ip: ctx.ip });
  return ruleDto(r);
}

export async function deleteRule(ctx: StormCtx, id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const r = await StormAlertRuleModel.findOneAndDelete({ _id: id, companyId: ctx.companyId });
  if (!r) throw notFound();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.alert_rule_deleted', entityType: 'storm_alert_rule', entityId: id, changes: { name: r.name }, requestId: ctx.requestId, ip: ctx.ip });
}

// ------------------------------------------------------------------ matching

/** Shortest distance in miles from a point to a polygon ring (0 when inside). Local equirectangular projection: fine for zone sizes. */
export function distanceToRingMiles(p: { lat: number; lng: number }, ring: Array<[number, number]>, inside: boolean): number {
  if (inside) return 0;
  const kx = Math.cos((p.lat * Math.PI) / 180) * 69.172;
  const ky = 69.0;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = [((ring[i] as [number, number])[0] - p.lng) * kx, ((ring[i] as [number, number])[1] - p.lat) * ky];
    const [x2, y2] = [((ring[i + 1] as [number, number])[0] - p.lng) * kx, ((ring[i + 1] as [number, number])[1] - p.lat) * ky];
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / l2));
    best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy));
  }
  return best;
}

type EventLite = { _id: Types.ObjectId; eventType: 'hail' | 'wind'; hailSizeInches?: number | null; windSpeedMph?: number | null; latitude?: number | null; longitude?: number | null; county?: string; state?: string; eventDate: Date; coordinatePrecision: string; locationDescription?: string };

/** Distance to the zone in miles (0 = inside) or null when the event is outside the zone and the rule's radius. */
export function matchDistance(rule: Pick<StormAlertRuleDocument, 'radiusMiles'>, zone: StormZoneDocument, e: EventLite): number | null {
  const slack = rule.radiusMiles ?? 0;
  if (zone.kind === 'county') {
    const hit = (zone.counties ?? []).some((c) => (c.state ?? '').toUpperCase() === (e.state ?? '').toUpperCase() && (c.county ?? '').toLowerCase() === (e.county ?? '').toLowerCase());
    return hit ? 0 : null;
  }
  if (e.latitude == null || e.longitude == null || !['exact', 'approximate'].includes(e.coordinatePrecision)) return null;
  const p = { lat: e.latitude, lng: e.longitude };
  if (zone.kind === 'radius' && zone.center?.lat != null && zone.center.lng != null) {
    const d = distanceMiles({ lat: zone.center.lat, lng: zone.center.lng }, p);
    const out = d - (zone.radiusMiles ?? 0);
    return out <= slack ? Math.max(0, Math.round(out * 10) / 10) : null;
  }
  const ring = (zone.polygon as unknown as number[][]).map((q) => [q[0], q[1]] as [number, number]);
  const closed = ring[0]?.join() === ring[ring.length - 1]?.join() ? ring : [...ring, ring[0] as [number, number]];
  let inside = false;
  for (let i = 0, j = closed.length - 1; i < closed.length; j = i++) {
    const [xi, yi] = closed[i] as [number, number];
    const [xj, yj] = closed[j] as [number, number];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  const d = distanceToRingMiles(p, closed, inside);
  return d <= slack ? Math.round(d * 10) / 10 : null;
}

const meets = (rule: StormAlertRuleDocument, e: EventLite): boolean =>
  e.eventType === 'hail' ? (e.hailSizeInches ?? 0) >= Math.max(HAIL_MIN_INCHES, rule.hailMinInches) : (e.windSpeedMph ?? 0) > 0 && (e.windSpeedMph ?? 0) >= Math.max(WIND_MIN_MPH + 0.0001, rule.windMinMph) && (e.windSpeedMph as number) > WIND_MIN_MPH;

// ------------------------------------------------------------------ evaluation and delivery

export type EvaluateResult = { alertsCreated: number; skippedDuplicates: number; eventsChecked: number };

export async function evaluateEvents(eventIds: Array<Types.ObjectId | string>, opts: { now?: Date } = {}): Promise<EvaluateResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - ALERT_WINDOW_DAYS * 86_400_000);
  const events = (await StormEventModel.find({ _id: { $in: eventIds }, qualifies: true, eventDate: { $gte: since } }).lean()) as unknown as EventLite[];
  const rules = await StormAlertRuleModel.find({ enabled: true });
  const result: EvaluateResult = { alertsCreated: 0, skippedDuplicates: 0, eventsChecked: events.length };
  if (events.length === 0 || rules.length === 0) return result;
  const zones = new Map((await StormZoneModel.find({ _id: { $in: rules.map((r) => r.zoneId) }, archivedAt: { $exists: false } })).map((z) => [z._id.toString(), z]));
  for (const rule of rules) {
    const zone = zones.get(rule.zoneId.toString());
    if (!zone) continue;
    for (const e of events) {
      if (!meets(rule, e)) continue;
      const dist = matchDistance(rule, zone, e);
      if (dist === null) continue;
      const magnitude = e.eventType === 'hail' ? (e.hailSizeInches ?? undefined) : (e.windSpeedMph ?? undefined);
      const message = `${e.eventType === 'hail' ? `${(e.hailSizeInches ?? 0).toFixed(2)} in hail` : `${Math.round(e.windSpeedMph ?? 0)} mph wind`} reported ${dist === 0 ? 'inside' : `${dist} mi from`} ${zone.name}${e.locationDescription ? ` (${e.locationDescription}, ${e.county ?? ''} ${e.state ?? ''})` : ''}. A report is not confirmed damage.`;
      let alertId: Types.ObjectId;
      try {
        const created = await StormAlertModel.create({ companyId: rule.companyId, ruleId: rule._id, zoneId: zone._id, eventId: e._id, eventType: e.eventType, magnitude, distanceMiles: dist, recipients: [], channelResults: {}, message });
        alertId = created._id;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) { result.skippedDuplicates += 1; continue; }
        throw err;
      }
      try {
        const { recipients, channelResults } = await deliver(rule, zone, e, message);
        await StormAlertModel.updateOne({ _id: alertId }, { $set: { recipients, channelResults } });
        result.alertsCreated += 1;
      } catch (err) {
        getLog().error({ err, ruleId: String(rule._id), eventId: String(e._id) }, 'Storm alert delivery failed');
        await StormAlertModel.updateOne({ _id: alertId }, { $set: { channelResults: { error: err instanceof Error ? err.message : String(err) } } });
      }
    }
  }
  return result;
}

async function deliver(rule: StormAlertRuleDocument, zone: StormZoneDocument, e: EventLite, message: string) {
  const ids = new Set<string>();
  if (rule.notifyAssignee && zone.assignedUserId) ids.add(zone.assignedUserId.toString());
  for (const r of rule.recipientUserIds) ids.add(r.toString());
  if (rule.notifyAdmins) {
    const cu = await companyUserIds(rule.companyId.toString());
    for (const a of await UserModel.find({ _id: { $in: cu }, role: 'admin', isActive: { $ne: false } }).select('_id').lean()) ids.add(a._id.toString());
  }
  const users = await UserModel.find({ _id: { $in: [...ids] } }).select('email phone isActive').lean();
  const channels = { inApp: rule.channels?.inApp ?? true, email: rule.channels?.email ?? false, sms: rule.channels?.sms ?? false };
  const inApp: Record<string, string> = {};
  const email: Record<string, string> = {};
  const sms: Record<string, string> = {};
  const link = `/app/storm/map?event=${e._id.toString()}`;
  const title = `Storm alert: ${message}`.slice(0, 280);
  for (const u of users) {
    const uid = u._id.toString();
    if (channels.inApp) {
      await createNotification({ userId: u._id, type: 'storm_alert', title, link });
      inApp[uid] = 'sent';
    }
    if (channels.email) {
      if (!u.email) email[uid] = 'no_email_address';
      else email[uid] = (await sendEmail({ to: u.email, subject: 'Storm alert', text: `${message}\n${link}` })).status;
    }
    if (channels.sms) {
      if (!u.phone) sms[uid] = 'no_phone_number';
      else sms[uid] = (await sendSms({ to: u.phone, body: message })).status;
    }
  }
  return { recipients: users.map((u) => u._id), channelResults: { inApp: channels.inApp ? inApp : 'off', email: channels.email ? email : 'off', sms: channels.sms ? sms : 'off' } };
}

/** Re-checks events imported in the alert window. Duplicates are skipped, so this is safe to run repeatedly. */
export async function evaluateRecent(now = new Date()): Promise<EvaluateResult> {
  const since = new Date(now.getTime() - ALERT_WINDOW_DAYS * 86_400_000);
  const ids = await StormEventModel.find({ qualifies: true, eventDate: { $gte: since } }).select('_id').limit(5000).lean();
  return evaluateEvents(ids.map((i) => i._id), { now });
}

export async function alertHistory(ctx: StormCtx, q: { page: number; pageSize: number; ruleId?: string }) {
  const filter: Record<string, unknown> = { companyId: ctx.companyId };
  if (q.ruleId && mongoose.isValidObjectId(q.ruleId)) filter.ruleId = q.ruleId;
  if (ctx.role !== 'admin') filter.recipients = ctx.userId; // salespeople see only alerts sent to them
  const [rows, total] = await Promise.all([
    StormAlertModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    StormAlertModel.countDocuments(filter),
  ]);
  const zones = await StormZoneModel.find({ _id: { $in: rows.map((r) => r.zoneId) } }).select('name').lean();
  const rules = await StormAlertRuleModel.find({ _id: { $in: rows.map((r) => r.ruleId) } }).select('name').lean();
  const users = await UserModel.find({ _id: { $in: rows.flatMap((r) => r.recipients) } }).select('firstName lastName').lean();
  const zn = new Map(zones.map((z) => [String(z._id), z.name]));
  const rn = new Map(rules.map((r) => [String(r._id), r.name]));
  const un = new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  return {
    data: rows.map((r) => ({ id: String(r._id), at: (r as unknown as { createdAt: Date }).createdAt.toISOString(), ruleName: rn.get(String(r.ruleId)) ?? '', zoneName: zn.get(String(r.zoneId)) ?? '', eventId: String(r.eventId), eventType: r.eventType, magnitude: r.magnitude ?? null, distanceMiles: r.distanceMiles ?? null, message: r.message, recipients: r.recipients.map((id) => un.get(String(id)) ?? 'Unknown user'), channelResults: r.channelResults })),
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
  };
}

export function channelStatus(): { inApp: string; email: string; sms: string } {
  return {
    inApp: 'Active: alerts appear in the notification bell.',
    email: 'Not configured: the email provider has no credentials, so no email is sent.',
    sms: 'Not configured: the SMS provider has no credentials, so no text is sent.',
  };
}
