import mongoose, { type Types } from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { ensureDefaultCompany } from '../companies/company.service.js';
import { LeadModel } from '../leads/lead.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { UserModel } from '../users/user.model.js';
import { distanceMiles, milesToRadians, pointInRing } from './geo.js';
import { StormEventModel, StormZoneModel, type StormZoneDocument } from './storm.model.js';
import { HAIL_MIN_INCHES, POINT_PRECISIONS, WIND_MIN_MPH } from './storm.types.js';

export type StormCtx = { userId: string; role: 'admin' | 'salesperson'; companyId: string; requestId?: string; ip?: string };

const notFound = (): AppError => new AppError({ status: 404, code: 'NOT_FOUND', message: 'Zone not found.' });

export async function companyUserIds(companyId: string): Promise<Types.ObjectId[]> {
  const def = await ensureDefaultCompany();
  const isDefault = def._id.toString() === companyId;
  const users = await UserModel.find(isDefault ? { $or: [{ companyId }, { companyId: { $exists: false } }, { companyId: null }] } : { companyId }).select('_id').lean();
  return users.map((u) => u._id);
}

export async function companyCustomerIds(companyId: string): Promise<Types.ObjectId[]> {
  return (await CustomerModel.find({ ownerId: { $in: await companyUserIds(companyId) } }).distinct('_id')) as Types.ObjectId[];
}

// ------------------------------------------------------------------ geometry of a zone

export type ZoneInput = {
  name: string;
  kind: 'radius' | 'polygon' | 'county';
  center?: { lat: number; lng: number };
  radiusMiles?: number;
  polygon?: Array<[number, number]>;
  counties?: Array<{ state: string; county: string }>;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  minHailInches?: number;
  minWindMph?: number;
  notes?: string;
  assignedUserId?: string | null;
};

export function validateZone(z: ZoneInput): void {
  const bad = (m: string): never => { throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: m }); };
  if (z.kind === 'radius' && (!z.center || !z.radiusMiles || z.radiusMiles <= 0 || z.radiusMiles > 100)) bad('A radius zone needs a centre point and a radius between 0 and 100 miles.');
  if (z.kind === 'polygon') {
    if (!z.polygon || z.polygon.length < 4) bad('A drawn zone needs at least three corners.');
    const ring = z.polygon as Array<[number, number]>;
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    if (Math.max(...lngs) - Math.min(...lngs) > 6 || Math.max(...lats) - Math.min(...lats) > 6) bad('A drawn zone cannot be larger than about 6 degrees across. Use several zones.');
  }
  if (z.kind === 'county' && (!z.counties || z.counties.length === 0)) bad('Pick at least one county.');
  if (z.dateFrom && z.dateTo && z.dateFrom > z.dateTo) bad('The zone start date is after its end date.');
}

/** Mongo filter selecting the events of a zone (location part only). */
export function zoneLocationFilter(z: Pick<StormZoneDocument, 'kind' | 'center' | 'radiusMiles' | 'polygon' | 'counties'>, extraRadiusMiles = 0): Record<string, unknown> {
  if (z.kind === 'radius' && z.center?.lat != null && z.center.lng != null) {
    return { coordinatePrecision: { $in: POINT_PRECISIONS }, location: { $geoWithin: { $centerSphere: [[z.center.lng, z.center.lat], milesToRadians((z.radiusMiles ?? 0) + extraRadiusMiles)] } } };
  }
  if (z.kind === 'polygon') {
    const ring = (z.polygon as unknown as number[][]).map((p) => [p[0], p[1]]);
    const closed = ring[0]?.join() === ring[ring.length - 1]?.join() ? ring : [...ring, ring[0] as number[]];
    return { coordinatePrecision: { $in: POINT_PRECISIONS }, location: { $geoWithin: { $geometry: { type: 'Polygon', coordinates: [closed] } } } };
  }
  const or = (z.counties ?? []).map((c) => ({ state: (c.state ?? '').toUpperCase(), county: { $regex: `^${(c.county ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }));
  return { $or: or.length > 0 ? or : [{ _id: null }] };
}

function inZone(z: Pick<StormZoneDocument, 'kind' | 'center' | 'radiusMiles' | 'polygon'>, lat: number, lng: number): boolean {
  if (z.kind === 'radius' && z.center?.lat != null && z.center.lng != null) return distanceMiles({ lat: z.center.lat, lng: z.center.lng }, { lat, lng }) <= (z.radiusMiles ?? 0);
  if (z.kind === 'polygon') return pointInRing({ lat, lng }, (z.polygon as unknown as number[][]).map((p) => [p[0], p[1]] as [number, number]));
  return false;
}

// ------------------------------------------------------------------ statistics and ranking

export type Weights = { hail: number; wind: number; recency: number };
export const DEFAULT_WEIGHTS: Weights = { hail: 1, wind: 0.5, recency: 1 };
export const SCORE_FORMULA =
  'Score = hail weight x (sum over storm days of the largest hail size that day, in inches) + wind weight x (sum over storm days of the highest wind that day divided by 50 mph) + recency weight x (1 if the latest event was within 30 days, falling to 0 at 365 days). Using one value per day keeps several reports from the same storm from being counted as separate damage events.';

export type ZoneStats = {
  hailReports: number;
  windReports: number;
  stormDays: number;
  maxHailInches: number | null;
  maxWindMph: number | null;
  latestEvent: string | null;
  crm: { customers: number; leads: number; pastCustomers: number; propertiesWithLocation: number; leadsNotLocated: number; note: string };
  score: { total: number; hailPoints: number; windPoints: number; recencyPoints: number; weights: Weights; formula: string };
};

async function eventStats(z: StormZoneDocument, o: { from?: Date | null; to?: Date | null; minHail?: number; minWind?: number }, weights: Weights, now: Date) {
  const from = o.from ?? z.dateFrom ?? undefined;
  const to = o.to ?? z.dateTo ?? undefined;
  const minHail = Math.max(HAIL_MIN_INCHES, o.minHail ?? z.minHailInches ?? 1);
  const minWind = Math.max(WIND_MIN_MPH, o.minWind ?? z.minWindMph ?? 50);
  const match: Record<string, unknown> = {
    $and: [
      zoneLocationFilter(z),
      { $or: [{ eventType: 'hail', hailSizeInches: { $gte: minHail } }, { eventType: 'wind', windSpeedMph: minWind > WIND_MIN_MPH ? { $gte: minWind } : { $gt: WIND_MIN_MPH } }] },
      ...(from || to ? [{ eventDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } }] : []),
    ],
  };
  const rows = await StormEventModel.aggregate<{ _id: { t: string; day: string }; n: number; maxHail: number | null; maxWind: number | null; latest: Date }>([
    { $match: match },
    { $group: { _id: { t: '$eventType', day: { $dateToString: { format: '%Y-%m-%d', date: '$eventDate' } } }, n: { $sum: 1 }, maxHail: { $max: '$hailSizeInches' }, maxWind: { $max: '$windSpeedMph' }, latest: { $max: '$eventDate' } } },
  ]).option({ maxTimeMS: 20_000 });
  const hail = rows.filter((r) => r._id.t === 'hail');
  const wind = rows.filter((r) => r._id.t === 'wind');
  const latest = rows.reduce<Date | null>((m, r) => (!m || r.latest > m ? r.latest : m), null);
  const hailPoints = weights.hail * hail.reduce((a, r) => a + (r.maxHail ?? 0), 0);
  const windPoints = weights.wind * wind.reduce((a, r) => a + (r.maxWind ?? 0) / 50, 0);
  const ageDays = latest ? (now.getTime() - latest.getTime()) / 86_400_000 : Infinity;
  const recency = ageDays <= 30 ? 1 : ageDays >= 365 ? 0 : 1 - (ageDays - 30) / 335;
  const recencyPoints = weights.recency * recency;
  const r1 = (n: number): number => Math.round(n * 100) / 100;
  return {
    hailReports: hail.reduce((a, r) => a + r.n, 0),
    windReports: wind.reduce((a, r) => a + r.n, 0),
    stormDays: new Set(rows.map((r) => r._id.day)).size,
    maxHailInches: hail.length > 0 ? Math.max(...hail.map((r) => r.maxHail ?? 0)) : null,
    maxWindMph: wind.length > 0 ? Math.max(...wind.map((r) => r.maxWind ?? 0)) : null,
    latestEvent: latest ? latest.toISOString() : null,
    score: { total: r1(hailPoints + windPoints + recencyPoints), hailPoints: r1(hailPoints), windPoints: r1(windPoints), recencyPoints: r1(recencyPoints), weights, formula: SCORE_FORMULA },
  };
}

async function crmCounts(z: StormZoneDocument, companyId: string) {
  const customerIds = await companyCustomerIds(companyId);
  const props = await PropertyModel.find({ customerId: { $in: customerIds }, 'location.lat': { $exists: true } }).select('customerId location addressKey address').limit(50_000).lean();
  const located = props.filter((p) => p.location?.lat != null && p.location?.lng != null);
  const inside = z.kind === 'county' ? [] : located.filter((p) => inZone(z, p.location!.lat as number, p.location!.lng as number));
  const propIds = inside.map((p) => p._id);
  const customers = new Set(inside.map((p) => String(p.customerId)));
  const keys = inside.map((p) => p.addressKey).filter((k): k is string => Boolean(k));
  const [leads, leadsTotal, past] = await Promise.all([
    keys.length > 0 ? LeadModel.countDocuments({ addressKey: { $in: keys }, convertedCustomerId: null }) : 0,
    LeadModel.countDocuments({ convertedCustomerId: null }),
    ProjectModel.distinct('customerId', { propertyId: { $in: propIds }, status: { $in: ['completed', 'closed'] } }),
  ]);
  return {
    customers: customers.size,
    leads,
    pastCustomers: past.length,
    propertiesWithLocation: located.length,
    leadsNotLocated: Math.max(0, leadsTotal - leads),
    note: z.kind === 'county'
      ? 'CRM counts are not available for county zones because properties are stored with coordinates, not counties. Use a radius or drawn zone for CRM counts.'
      : 'Customers, past customers and leads are counted from properties that have a saved location. A lead is counted when its address matches such a property; other leads cannot be placed on the map yet.',
  };
}

export async function zoneStats(z: StormZoneDocument, ctx: StormCtx, o: { from?: Date | null; to?: Date | null; minHail?: number; minWind?: number; weights?: Weights; now?: Date } = {}): Promise<ZoneStats> {
  const [ev, crm] = await Promise.all([eventStats(z, o, o.weights ?? DEFAULT_WEIGHTS, o.now ?? new Date()), crmCounts(z, ctx.companyId)]);
  return { ...ev, crm };
}

// ------------------------------------------------------------------ CRUD

export type ZoneDto = {
  id: string; name: string; kind: string; center: { lat: number; lng: number } | null; radiusMiles: number | null; polygon: Array<[number, number]> | null; counties: Array<{ state: string; county: string }>;
  dateFrom: string | null; dateTo: string | null; minHailInches: number; minWindMph: number; notes: string;
  assignedUser: { id: string; name: string } | null; assignmentHistory: Array<{ user: string | null; at: string; by: string; note: string }>; archived: boolean; createdAt: string;
};

async function names(ids: unknown[]): Promise<Map<string, string>> {
  const users = await UserModel.find({ _id: { $in: ids.filter(Boolean) } }).select('firstName lastName').lean();
  return new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
}

async function toDto(z: StormZoneDocument): Promise<ZoneDto> {
  const nm = await names([z.assignedUserId, ...z.assignmentHistory.flatMap((h) => [h.userId, h.by])]);
  return {
    id: z._id.toString(), name: z.name, kind: z.kind,
    center: z.center?.lat != null && z.center.lng != null ? { lat: z.center.lat, lng: z.center.lng } : null,
    radiusMiles: z.radiusMiles ?? null,
    polygon: z.kind === 'polygon' ? (z.polygon as unknown as number[][]).map((p) => [p[0], p[1]] as [number, number]) : null,
    counties: (z.counties ?? []).map((c) => ({ state: c.state ?? '', county: c.county ?? '' })),
    dateFrom: z.dateFrom ? z.dateFrom.toISOString() : null, dateTo: z.dateTo ? z.dateTo.toISOString() : null,
    minHailInches: z.minHailInches ?? 1, minWindMph: z.minWindMph ?? 50, notes: z.notes ?? '',
    assignedUser: z.assignedUserId ? { id: z.assignedUserId.toString(), name: nm.get(String(z.assignedUserId)) ?? 'Unknown user' } : null,
    assignmentHistory: z.assignmentHistory.map((h) => ({ user: h.userId ? nm.get(String(h.userId)) ?? 'Unknown user' : null, at: h.at.toISOString(), by: nm.get(String(h.by)) ?? 'Unknown user', note: h.note ?? '' })),
    archived: Boolean(z.archivedAt), createdAt: z.createdAt.toISOString(),
  };
}

async function assertAssignee(userId: string, companyId: string): Promise<void> {
  const ids = await companyUserIds(companyId);
  if (!mongoose.isValidObjectId(userId) || !ids.some((i) => i.toString() === userId)) throw new AppError({ status: 422, code: 'INVALID_USER', message: 'That user is not in your company.' });
}

export async function createZone(ctx: StormCtx, input: ZoneInput): Promise<ZoneDto> {
  validateZone(input);
  if (input.assignedUserId) await assertAssignee(input.assignedUserId, ctx.companyId);
  const doc = await StormZoneModel.create({
    companyId: ctx.companyId, name: input.name.trim(), kind: input.kind, center: input.center, radiusMiles: input.radiusMiles, polygon: input.polygon, counties: input.counties ?? [],
    dateFrom: input.dateFrom ?? undefined, dateTo: input.dateTo ?? undefined, minHailInches: input.minHailInches ?? 1, minWindMph: input.minWindMph ?? 50, notes: input.notes ?? '',
    assignedUserId: input.assignedUserId ?? undefined,
    assignmentHistory: input.assignedUserId ? [{ userId: input.assignedUserId, at: new Date(), by: ctx.userId, note: 'Assigned when the zone was created' }] : [],
    createdBy: ctx.userId,
  });
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.zone_created', entityType: 'storm_zone', entityId: doc._id.toString(), changes: { name: doc.name, kind: doc.kind, assignedUserId: input.assignedUserId ?? null }, requestId: ctx.requestId, ip: ctx.ip });
  return toDto(doc);
}

export async function loadZone(ctx: StormCtx, id: string): Promise<StormZoneDocument> {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const z = await StormZoneModel.findOne({ _id: id, companyId: ctx.companyId });
  if (!z) throw notFound();
  if (ctx.role !== 'admin' && z.assignedUserId?.toString() !== ctx.userId) throw notFound(); // salespeople see only their own territory
  return z;
}

export async function updateZone(ctx: StormCtx, id: string, patch: Partial<ZoneInput>): Promise<ZoneDto> {
  const z = await loadZone(ctx, id);
  const before = { name: z.name, notes: z.notes, radiusMiles: z.radiusMiles, dateFrom: z.dateFrom, dateTo: z.dateTo, minHailInches: z.minHailInches, minWindMph: z.minWindMph };
  const merged: ZoneInput = { name: patch.name ?? z.name, kind: z.kind as ZoneInput['kind'], center: (patch.center ?? z.center) as ZoneInput['center'], radiusMiles: patch.radiusMiles ?? z.radiusMiles ?? undefined, polygon: (patch.polygon ?? z.polygon) as ZoneInput['polygon'], counties: (patch.counties ?? z.counties) as ZoneInput['counties'], dateFrom: patch.dateFrom === undefined ? z.dateFrom : patch.dateFrom, dateTo: patch.dateTo === undefined ? z.dateTo : patch.dateTo };
  validateZone(merged);
  if (patch.name !== undefined) z.name = patch.name.trim();
  if (patch.notes !== undefined) z.notes = patch.notes;
  if (patch.center) z.center = patch.center as never;
  if (patch.radiusMiles !== undefined) z.radiusMiles = patch.radiusMiles;
  if (patch.polygon) z.polygon = patch.polygon as never;
  if (patch.counties) z.counties = patch.counties as never;
  if (patch.dateFrom !== undefined) z.dateFrom = patch.dateFrom ?? undefined;
  if (patch.dateTo !== undefined) z.dateTo = patch.dateTo ?? undefined;
  if (patch.minHailInches !== undefined) z.minHailInches = patch.minHailInches;
  if (patch.minWindMph !== undefined) z.minWindMph = patch.minWindMph;
  await z.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.zone_updated', entityType: 'storm_zone', entityId: id, changes: { before, patch }, requestId: ctx.requestId, ip: ctx.ip });
  return toDto(z);
}

/** Changes the representative. Every change is appended to the history with who made it and why; no leads or customers are created. */
export async function assignZone(ctx: StormCtx, id: string, userId: string | null, note = ''): Promise<ZoneDto> {
  const z = await loadZone(ctx, id);
  if (userId) await assertAssignee(userId, ctx.companyId);
  const prev = z.assignedUserId?.toString() ?? null;
  if (prev === userId) return toDto(z);
  z.assignedUserId = userId ? (new mongoose.Types.ObjectId(userId) as never) : undefined;
  z.assignmentHistory.push({ userId: userId ? (new mongoose.Types.ObjectId(userId) as never) : undefined, at: new Date(), by: new mongoose.Types.ObjectId(ctx.userId) as never, note } as never);
  await z.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.zone_assigned', entityType: 'storm_zone', entityId: id, changes: { from: prev, to: userId, note }, requestId: ctx.requestId, ip: ctx.ip });
  return toDto(z);
}

export async function archiveZone(ctx: StormCtx, id: string): Promise<void> {
  const z = await loadZone(ctx, id);
  z.archivedAt = new Date();
  await z.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'storm.zone_archived', entityType: 'storm_zone', entityId: id, requestId: ctx.requestId, ip: ctx.ip });
}

export async function listZones(ctx: StormCtx, includeArchived = false): Promise<ZoneDto[]> {
  const q: Record<string, unknown> = { companyId: ctx.companyId };
  if (!includeArchived) q.archivedAt = { $exists: false };
  if (ctx.role !== 'admin') q.assignedUserId = ctx.userId;
  const zones = await StormZoneModel.find(q).sort({ createdAt: -1 }).limit(200);
  return Promise.all(zones.map(toDto));
}

export type RankSort = 'hail' | 'wind' | 'reports' | 'recent' | 'score';

export async function rankZones(ctx: StormCtx, o: { sort: RankSort; from?: Date; to?: Date; minHail?: number; minWind?: number; weights?: Weights; now?: Date }) {
  const zones = await StormZoneModel.find({ companyId: ctx.companyId, archivedAt: { $exists: false }, ...(ctx.role === 'admin' ? {} : { assignedUserId: ctx.userId }) }).limit(200);
  const rows = await Promise.all(zones.map(async (z) => ({ zone: await toDto(z), stats: await zoneStats(z, ctx, o) })));
  const key = (r: (typeof rows)[number]): number => {
    switch (o.sort) {
      case 'hail': return r.stats.maxHailInches ?? -1;
      case 'wind': return r.stats.maxWindMph ?? -1;
      case 'reports': return r.stats.hailReports + r.stats.windReports;
      case 'recent': return r.stats.latestEvent ? new Date(r.stats.latestEvent).getTime() : -1;
      default: return r.stats.score.total;
    }
  };
  rows.sort((a, b) => key(b) - key(a));
  return {
    rankedBy: o.sort,
    explanation: {
      hail: 'Ranked by the largest hail size reported inside the zone.',
      wind: 'Ranked by the highest wind speed reported inside the zone.',
      reports: 'Ranked by the number of hail and wind reports inside the zone. Several reports from one storm are counted separately here.',
      recent: 'Ranked by the date of the most recent report inside the zone.',
      score: SCORE_FORMULA,
    }[o.sort],
    weights: o.weights ?? DEFAULT_WEIGHTS,
    rows: rows.map((r, i) => ({ rank: i + 1, ...r })),
  };
}
