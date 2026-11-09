import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { getValidatedBody, getValidatedParams, getValidatedQuery, validate } from '../../middleware/validate.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { alertHistory, channelStatus, createRule, deleteRule, evaluateEvents, evaluateRecent, listRules, updateRule } from './storm.alerts.js';
import { createFlagActivity, detectFlags, listFlags, reviewFlag } from './storm.followups.js';
import { geocodeAddress, geocoderConfigFromEnv, geocoderStatus } from './storm.geocode.js';
import { historyFor } from './storm.history.js';
import { createRun, defaultDeps, executeRun, importStatus, type IngestDeps, type RunRequest } from './storm.ingest.js';
import { DAMAGE_DISCLAIMER, RADII, dateOfLossWindow, getEvent, mapEvents, regionalContext, searchNear, type EventFilters } from './storm.search.js';
import { HAIL_MIN_INCHES, WIND_MIN_MPH } from './storm.types.js';
import { archiveZone, assignZone, createZone, listZones, loadZone, rankZones, updateZone, zoneStats, type StormCtx } from './storm.zones.js';

export const stormRouter = Router();
stormRouter.use(authenticate, requirePasswordChanged);

let log: Logger | undefined;
const getLog = (): Logger => (log ??= createLogger());

let depsOverride: IngestDeps | null = null;
let lastRun: Promise<unknown> = Promise.resolve();
/** Test hooks: replace the network layer and wait for a started import to finish. */
export const setIngestDepsForTests = (d: IngestDeps | null): void => { depsOverride = d; };
export const waitForImportsForTests = (): Promise<unknown> => lastRun;

const ctx = (req: Request): StormCtx => {
  const a = requireAuth(req);
  return { userId: a.userId, role: a.role, companyId: a.companyId, requestId: req.requestId, ip: req.ip };
};
const h = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction): void => { void fn(req, res).catch(next); };

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idParams = z.object({ id: objectId }).strict();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const csv = <T extends string>(allowed: readonly T[]) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(allowed as [T, ...T[]])));

const filterShape = {
  from: day.optional(),
  to: day.optional(),
  types: csv(['hail', 'wind'] as const).optional(),
  minHail: num(HAIL_MIN_INCHES, 10).optional(),
  minWind: num(WIND_MIN_MPH, 250).optional(),
  sources: csv(['spc', 'ncei'] as const).optional(),
  includeUnknownSpeed: z.enum(['true', 'false']).optional(),
};
const filtersOf = (q: { from?: string; to?: string; types?: Array<'hail' | 'wind'>; minHail?: number; minWind?: number; sources?: Array<'spc' | 'ncei'>; includeUnknownSpeed?: string }): EventFilters => ({
  from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
  to: q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined,
  types: q.types,
  minHailInches: q.minHail,
  minWindMph: q.minWind,
  sources: q.sources,
  includeUnknownSpeed: q.includeUnknownSpeed === 'true',
});

// ------------------------------------------------------------------ status

stormRouter.get('/status', authorize('stormEvents:read'), h(async (_req, res) => {
  const geo = geocoderStatus(geocoderConfigFromEnv());
  res.status(200).json({
    data: {
      thresholds: { hailMinInches: HAIL_MIN_INCHES, windMinMph: WIND_MIN_MPH, windRule: 'greater than' },
      radiiMiles: RADII,
      geocoder: geo,
      alertChannels: channelStatus(),
      mapTileUrl: process.env.STORM_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      mapAttribution: process.env.STORM_MAP_ATTRIBUTION ?? '© OpenStreetMap contributors',
      sources: [
        { key: 'spc', name: 'NOAA Storm Prediction Center daily reports', note: 'Preliminary reports, updated daily. Hail in hundredths of an inch, wind in mph (often unknown for damage-only reports).' },
        { key: 'ncei', name: 'NOAA NCEI Storm Events Database', note: 'Quality-controlled historical events from 2009, published roughly 2 to 4 months after the fact. Wind is reported in knots and converted to mph.' },
      ],
      mrms: { available: false, note: 'MRMS radar-derived hail estimates are a planned future source and are not part of this release.' },
      disclaimer: DAMAGE_DISCLAIMER,
    },
  });
}));

// ------------------------------------------------------------------ address search

const searchQuery = z
  .object({
    ...filterShape,
    address: z.string().trim().min(5).max(250).optional(),
    lat: num(-90, 90).optional(),
    lng: num(-180, 180).optional(),
    propertyId: objectId.optional(),
    radius: z.coerce.number().refine((r) => (RADII as readonly number[]).includes(r), 'Radius must be 1, 3, 5 or 10 miles.').default(5),
    dateOfLoss: day.optional(),
    sort: z.enum(['nearest', 'newest', 'largest']).default('nearest'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    state: z.string().trim().length(2).optional(),
  })
  .strict();

stormRouter.get('/search', authorize('stormEvents:search'), validate({ query: searchQuery }), h(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof searchQuery>>(req);
  const filters = filtersOf(q);
  let point: { lat: number; lng: number } | null = null;
  let location: Record<string, unknown>;
  if (q.lat !== undefined && q.lng !== undefined) {
    point = { lat: q.lat, lng: q.lng };
    location = { source: 'coordinates', label: `${q.lat.toFixed(5)}, ${q.lng.toFixed(5)}`, accuracy: 'as entered' };
  } else if (q.propertyId) {
    const hist = await historyFor(ctx(req), { propertyId: q.propertyId, radiusMiles: q.radius, ...filters });
    const loc = hist.locations[0];
    if (!loc?.point) throw new AppError({ status: 422, code: 'NO_LOCATION', message: loc?.unavailableReason ?? 'This property has no usable location.' });
    point = loc.point;
    location = { source: loc.locationSource, label: loc.label, accuracy: loc.accuracy, propertyId: q.propertyId };
  } else if (q.address) {
    const g = await geocodeAddress(q.address);
    if (!g.precise) throw new AppError({ status: 422, code: 'ADDRESS_IMPRECISE', message: 'That address could only be matched approximately. Add the street number, city and state so a distance can be shown.' });
    point = { lat: g.latitude, lng: g.longitude };
    location = { source: 'geocoded', label: g.formattedAddress || q.address, accuracy: g.accuracy === 'rooftop' ? 'rooftop' : 'street-address estimate', provider: g.provider, cached: g.cached };
  } else throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'Enter an address, a saved property or coordinates.' });

  const result = await searchNear({ ...filters, lat: point.lat, lng: point.lng, radiusMiles: q.radius, sort: q.sort, page: q.page, pageSize: q.pageSize });
  const extra: Record<string, unknown> = {};
  if (q.dateOfLoss) extra.dateOfLoss = await dateOfLossWindow({ ...filters, lat: point.lat, lng: point.lng, radiusMiles: q.radius, dateOfLoss: q.dateOfLoss });
  if (q.state) extra.regional = await regionalContext(q.state, filters);
  res.status(200).json({ data: { location: { ...location, latitude: point.lat, longitude: point.lng }, ...result, ...extra } });
}));

const geocodeQuery = z.object({ address: z.string().trim().min(5).max(250) }).strict();
stormRouter.get('/geocode', authorize('stormEvents:search'), validate({ query: geocodeQuery }), h(async (req, res) => {
  const g = await geocodeAddress(getValidatedQuery<z.infer<typeof geocodeQuery>>(req).address);
  res.status(200).json({ data: g });
}));

// ------------------------------------------------------------------ map and details

const mapQuery = z
  .object({
    ...filterShape,
    bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).transform((s) => s.split(',').map(Number) as [number, number, number, number]).optional(),
    lat: num(-90, 90).optional(),
    lng: num(-180, 180).optional(),
    radius: num(0.5, 100).optional(),
    state: z.string().trim().length(2).optional(),
    limit: z.coerce.number().int().min(1).max(2500).default(1500),
  })
  .strict();

stormRouter.get('/events/map', authorize('stormEvents:read'), validate({ query: mapQuery }), h(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof mapQuery>>(req);
  if (!q.bbox && !(q.lat !== undefined && q.lng !== undefined && q.radius)) throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'Give a map area (bbox) or a centre point and radius, so the map never loads every report at once.' });
  if (q.bbox) {
    const [w, s, e, n] = q.bbox;
    if (e - w > 40 || n - s > 25) throw new AppError({ status: 400, code: 'AREA_TOO_LARGE', message: 'Zoom in: that map area is too large to load.' });
  }
  res.status(200).json({ data: await mapEvents({ ...filtersOf(q), bbox: q.bbox, center: q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined, radiusMiles: q.radius, state: q.state, limit: q.limit }) });
}));

stormRouter.get('/events/:id', authorize('stormEvents:read'), validate({ params: idParams }), h(async (req, res) => {
  res.status(200).json({ data: await getEvent(getValidatedParams<{ id: string }>(req).id) });
}));

// ------------------------------------------------------------------ CRM history

const historyQuery = z.object({ ...filterShape, propertyId: objectId.optional(), customerId: objectId.optional(), leadId: objectId.optional(), projectId: objectId.optional(), radius: z.coerce.number().refine((r) => (RADII as readonly number[]).includes(r)).default(3) }).strict();
stormRouter.get('/history', authorize('stormEvents:read'), validate({ query: historyQuery }), h(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof historyQuery>>(req);
  res.status(200).json({ data: await historyFor(ctx(req), { propertyId: q.propertyId, customerId: q.customerId, leadId: q.leadId, projectId: q.projectId, radiusMiles: q.radius, ...filtersOf(q) }) });
}));

// ------------------------------------------------------------------ imports (administrators)

stormRouter.get('/imports', authorize('stormEvents:import'), h(async (_req, res) => { res.status(200).json({ data: await importStatus() }); }));

async function start(req: Request, res: Response, run: RunRequest): Promise<void> {
  const deps = depsOverride ?? defaultDeps();
  const created = await createRun(run, deps);
  lastRun = executeRun(created._id.toString(), run, deps, (ids) => evaluateEvents(ids).then(() => undefined)).catch((err) => getLog().error({ err }, 'Storm import crashed'));
  res.status(202).json({ data: { runId: created._id.toString(), status: 'running', message: 'The import is running in the background. This page shows its progress.' } });
}

const backfillBody = z.object({ fromYear: z.number().int().min(2009).max(2100).optional(), toYear: z.number().int().min(2009).max(2100).optional(), force: z.boolean().optional() }).strict();
stormRouter.post('/imports/backfill', authorize('stormEvents:import'), validate({ body: backfillBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof backfillBody>>(req);
  if (b.fromYear && b.toYear && b.fromYear > b.toYear) throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'The first year is after the last year.' });
  await start(req, res, { source: 'ncei', kind: 'backfill', fromYear: b.fromYear, toYear: b.toYear, force: b.force, userId: requireAuth(req).userId });
}));

const spcBody = z.object({ from: day, to: day, force: z.boolean().optional() }).strict();
stormRouter.post('/imports/spc', authorize('stormEvents:import'), validate({ body: spcBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof spcBody>>(req);
  await start(req, res, { source: 'spc', kind: 'range', from: b.from, to: b.to, force: b.force, userId: requireAuth(req).userId });
}));

stormRouter.post('/imports/daily', authorize('stormEvents:import'), h(async (req, res) => {
  await start(req, res, { source: 'all', kind: 'daily', userId: requireAuth(req).userId });
}));

// ------------------------------------------------------------------ zones

const zoneBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    kind: z.enum(['radius', 'polygon', 'county']),
    center: z.object({ lat: num(-90, 90), lng: num(-180, 180) }).strict().optional(),
    radiusMiles: num(0.5, 100).optional(),
    polygon: z.array(z.tuple([num(-180, 180), num(-90, 90)])).min(4).max(200).optional(),
    counties: z.array(z.object({ state: z.string().trim().length(2), county: z.string().trim().min(2).max(60) }).strict()).max(50).optional(),
    dateFrom: day.nullable().optional(),
    dateTo: day.nullable().optional(),
    minHailInches: num(HAIL_MIN_INCHES, 10).optional(),
    minWindMph: num(WIND_MIN_MPH, 250).optional(),
    notes: z.string().max(2000).optional(),
    assignedUserId: objectId.nullable().optional(),
  })
  .strict();
const zonePatch = zoneBody.partial().omit({ kind: true });
const toZoneInput = (b: Partial<z.infer<typeof zoneBody>>) => ({ ...b, dateFrom: b.dateFrom === undefined ? undefined : b.dateFrom ? new Date(`${b.dateFrom}T00:00:00Z`) : null, dateTo: b.dateTo === undefined ? undefined : b.dateTo ? new Date(`${b.dateTo}T23:59:59.999Z`) : null });

stormRouter.get('/zones', authorize('stormZones:read'), h(async (req, res) => { res.status(200).json({ data: await listZones(ctx(req), req.query.archived === 'true') }); }));

const rankQuery = z.object({ sort: z.enum(['hail', 'wind', 'reports', 'recent', 'score']).default('score'), from: day.optional(), to: day.optional(), minHail: num(HAIL_MIN_INCHES, 10).optional(), minWind: num(WIND_MIN_MPH, 250).optional(), wHail: num(0, 10).optional(), wWind: num(0, 10).optional(), wRecency: num(0, 10).optional() }).strict();
stormRouter.get('/zones/rankings', authorize('stormZones:read'), validate({ query: rankQuery }), h(async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof rankQuery>>(req);
  const weights = { hail: q.wHail ?? 1, wind: q.wWind ?? 0.5, recency: q.wRecency ?? 1 };
  res.status(200).json({ data: await rankZones(ctx(req), { sort: q.sort, from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined, to: q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined, minHail: q.minHail, minWind: q.minWind, weights }) });
}));

stormRouter.post('/zones', authorize('stormZones:manage'), validate({ body: zoneBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof zoneBody>>(req);
  res.status(201).json({ data: await createZone(ctx(req), toZoneInput(b) as never) });
}));

stormRouter.get('/zones/:id', authorize('stormZones:read'), validate({ params: idParams }), h(async (req, res) => {
  const c = ctx(req);
  const z = await loadZone(c, getValidatedParams<{ id: string }>(req).id);
  const dto = (await listZones(c, true)).find((x) => x.id === z._id.toString());
  res.status(200).json({ data: { zone: dto, stats: await zoneStats(z, c) } });
}));

stormRouter.patch('/zones/:id', authorize('stormZones:manage'), validate({ params: idParams, body: zonePatch }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof zonePatch>>(req);
  res.status(200).json({ data: await updateZone(ctx(req), getValidatedParams<{ id: string }>(req).id, toZoneInput(b as never) as never) });
}));

const assignBody = z.object({ userId: objectId.nullable(), note: z.string().max(500).optional() }).strict();
stormRouter.post('/zones/:id/assign', authorize('stormZones:manage'), validate({ params: idParams, body: assignBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof assignBody>>(req);
  res.status(200).json({ data: await assignZone(ctx(req), getValidatedParams<{ id: string }>(req).id, b.userId, b.note) });
}));

stormRouter.delete('/zones/:id', authorize('stormZones:manage'), validate({ params: idParams }), h(async (req, res) => {
  await archiveZone(ctx(req), getValidatedParams<{ id: string }>(req).id);
  res.status(204).end();
}));

// ------------------------------------------------------------------ alerts

const ruleBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    zoneId: objectId,
    enabled: z.boolean().optional(),
    radiusMiles: num(0, 50).optional(),
    hailMinInches: num(HAIL_MIN_INCHES, 10).optional(),
    windMinMph: num(WIND_MIN_MPH, 250).optional(),
    notifyAssignee: z.boolean().optional(),
    notifyAdmins: z.boolean().optional(),
    recipientUserIds: z.array(objectId).max(50).optional(),
    channels: z.object({ inApp: z.boolean().optional(), email: z.boolean().optional(), sms: z.boolean().optional() }).strict().optional(),
  })
  .strict();

stormRouter.get('/alerts/channels', authorize('stormAlerts:read'), h(async (_req, res) => { res.status(200).json({ data: channelStatus() }); }));
stormRouter.get('/alerts/rules', authorize('stormAlerts:manage'), h(async (req, res) => { res.status(200).json({ data: await listRules(ctx(req)) }); }));
stormRouter.post('/alerts/rules', authorize('stormAlerts:manage'), validate({ body: ruleBody }), h(async (req, res) => { res.status(201).json({ data: await createRule(ctx(req), getValidatedBody<z.infer<typeof ruleBody>>(req)) }); }));
stormRouter.patch('/alerts/rules/:id', authorize('stormAlerts:manage'), validate({ params: idParams, body: ruleBody.partial() }), h(async (req, res) => { res.status(200).json({ data: await updateRule(ctx(req), getValidatedParams<{ id: string }>(req).id, getValidatedBody<Partial<z.infer<typeof ruleBody>>>(req)) }); }));
stormRouter.delete('/alerts/rules/:id', authorize('stormAlerts:manage'), validate({ params: idParams }), h(async (req, res) => { await deleteRule(ctx(req), getValidatedParams<{ id: string }>(req).id); res.status(204).end(); }));
const histQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), ruleId: objectId.optional() }).strict();
stormRouter.get('/alerts/history', authorize('stormAlerts:read'), validate({ query: histQuery }), h(async (req, res) => { res.status(200).json(await alertHistory(ctx(req), getValidatedQuery<z.infer<typeof histQuery>>(req))); }));
stormRouter.post('/alerts/evaluate-recent', authorize('stormAlerts:manage'), h(async (_req, res) => { res.status(200).json({ data: await evaluateRecent() }); }));

// ------------------------------------------------------------------ follow-ups

const flagQuery = z.object({ status: z.enum(['new', 'reviewed', 'dismissed']).optional(), customerId: objectId.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict();
stormRouter.get('/follow-ups', authorize('stormEvents:read'), validate({ query: flagQuery }), h(async (req, res) => { res.status(200).json(await listFlags(ctx(req), getValidatedQuery<z.infer<typeof flagQuery>>(req))); }));
const scanBody = z.object({ radiusMiles: num(1, 10).optional(), customerId: objectId.optional() }).strict();
stormRouter.post('/follow-ups/scan', authorize('stormZones:manage'), validate({ body: scanBody }), h(async (req, res) => { res.status(200).json({ data: await detectFlags(ctx(req), getValidatedBody<z.infer<typeof scanBody>>(req)) }); }));
const reviewBody = z.object({ note: z.string().trim().max(1000).optional() }).strict();
stormRouter.post('/follow-ups/:id/review', authorize('stormEvents:read'), validate({ params: idParams, body: reviewBody }), h(async (req, res) => { await reviewFlag(ctx(req), getValidatedParams<{ id: string }>(req).id, 'reviewed', getValidatedBody<z.infer<typeof reviewBody>>(req).note); res.status(204).end(); }));
stormRouter.post('/follow-ups/:id/dismiss', authorize('stormEvents:read'), validate({ params: idParams, body: reviewBody }), h(async (req, res) => { await reviewFlag(ctx(req), getValidatedParams<{ id: string }>(req).id, 'dismissed', getValidatedBody<z.infer<typeof reviewBody>>(req).note); res.status(204).end(); }));
const actBody = z.object({ type: z.enum(['follow_up', 'call', 'note']), dueAt: z.string().datetime({ offset: true }).optional(), body: z.string().trim().max(2000).optional(), assignedTo: objectId.optional() }).strict();
stormRouter.post('/follow-ups/:id/activities', authorize('activities:create'), validate({ params: idParams, body: actBody }), h(async (req, res) => {
  const b = getValidatedBody<z.infer<typeof actBody>>(req);
  res.status(201).json({ data: await createFlagActivity(ctx(req), getValidatedParams<{ id: string }>(req).id, { type: b.type, dueAt: b.dueAt ? new Date(b.dueAt) : undefined, body: b.body, assignedTo: b.assignedTo }) });
}));
