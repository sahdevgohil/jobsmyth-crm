import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { getEnv } from '../../../config/env.js';
import type { Role } from '../../../config/permissions.js';
import { recordAudit } from '../../../services/audit.js';
import { resolveCustomerPropertyTarget } from '../../../services/entity-links.js';
import { buildAddressKey } from '../../../utils/address-key.js';
import { AppError } from '../../../utils/errors.js';
import { createLogger, type Logger } from '../../../utils/logger.js';
import { ensureDefaultCompany } from '../../companies/company.service.js';
import { CustomerModel } from '../../customers/customer.model.js';
import { PropertyModel } from '../../customers/property.model.js';
import { UserModel } from '../../users/user.model.js';
import { MeasurementModel, type MeasurementDocument } from '../measurement.model.js';
import { findMeasurementInScope, toDto, type MeasurementDto } from '../measurement.service.js';
import { EDGE_TYPES, edgesUnavailable, summarizeEdges, type Edge } from './edges.js';
import { SOLAR_ADMIN_FIX, SolarError } from './errors.js';
import { GoogleSolarAdapter, type GeocodeCandidate, type ImageryQuality } from './google-solar.adapter.js';
import { parsePitchRise, round, sqFtToSquares } from './geo.js';
import { normalizeBuildingInsights, type NormalizedRoof } from './normalize.js';
import { MeasurementSettingsModel, SolarRequestModel, SOLAR_REQUEST_KINDS, type MeasurementSettingsDocument, type SolarRequestKind } from './solar.model.js';
import { wasteTable } from './waste.js';

export type SolarCtx = { userId: string; role: Role; companyId: string; permissions: readonly string[]; requestId?: string; ip?: string };

const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);
const can = (ctx: SolarCtx, p: string): boolean => ctx.permissions.includes(p);
const notFound = (what: string): AppError => new AppError({ status: 404, code: 'NOT_FOUND', message: `${what} not found.` });
const invalid = (path: string, message: string): AppError => new AppError({ status: 422, code: 'VALIDATION_ERROR', message, details: [{ path, message }] });

/** HTTP-safe error for a Google failure: stable code + fixed message, never the provider's text. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof SolarError) {
    const status = err.code === 'NOT_CONFIGURED' || err.code === 'DISABLED' ? 503 : err.code === 'LIMIT_REACHED' || err.code === 'QUOTA_EXCEEDED' ? 429 : err.code === 'NOT_FOUND' || err.code === 'NO_ROOF_DATA' || err.code === 'GEOCODE_NO_RESULT' ? 404 : err.code === 'INVALID_COORDINATES' || err.code === 'ADDRESS_NOT_PRECISE' ? 422 : 502;
    return new AppError({ status, code: `SOLAR_${err.code}`, message: err.message });
  }
  throw err;
}

// ------------------------------------------------------------------ adapter (the only place the key is read)

let adapterOverride: GoogleSolarAdapter | null = null;
/** Tests inject a deterministic adapter. Ignored outside NODE_ENV=test so a mock can never run in production. */
export function setSolarAdapterForTests(a: GoogleSolarAdapter | null): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('setSolarAdapterForTests is only available in tests.');
  adapterOverride = a;
}
export function adapter(): GoogleSolarAdapter {
  if (adapterOverride && process.env.NODE_ENV === 'test') return adapterOverride;
  const key = getEnv().GOOGLE_SOLAR_API_KEY;
  if (!key) throw new SolarError('NOT_CONFIGURED');
  return new GoogleSolarAdapter({ apiKey: key });
}
export const isConfigured = (): boolean => Boolean(getEnv().GOOGLE_SOLAR_API_KEY) || Boolean(adapterOverride && process.env.NODE_ENV === 'test');

// ------------------------------------------------------------------ company + scope

async function companyOfCustomer(customerId: mongoose.Types.ObjectId | string): Promise<string> {
  const c = await CustomerModel.findById(customerId).select({ ownerId: 1 }).lean();
  const owner = c ? await UserModel.findById(c.ownerId).select({ companyId: 1 }).lean() : null;
  return owner?.companyId ? owner.companyId.toString() : (await ensureDefaultCompany())._id.toString();
}

async function loadMeasurement(ctx: SolarCtx, id: string): Promise<MeasurementDocument> {
  const doc = await findMeasurementInScope(id, { userId: ctx.userId, role: ctx.role });
  if ((await companyOfCustomer(doc.customerId)) !== ctx.companyId) throw notFound('Measurement');
  return doc;
}

// ------------------------------------------------------------------ settings and usage

export async function getSettings(ctx: SolarCtx): Promise<MeasurementSettingsDocument> {
  return MeasurementSettingsModel.findOneAndUpdate({ companyId: oid(ctx.companyId) }, { $setOnInsert: { companyId: oid(ctx.companyId) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

type Kind = SolarRequestKind;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const monthKey = (d = new Date()): string => d.toISOString().slice(0, 7);
const dayKey = (d = new Date()): string => d.toISOString().slice(0, 10);

export type UsageRow = { kind: Kind; month: number; day: number; monthlyFree: number; dailyLimit: number; percentOfFree: number; overFree: number; estimatedOverageCents: number | null; warning: boolean; blocked: boolean };

export async function getUsage(ctx: SolarCtx): Promise<{ month: string; configured: boolean; enabled: boolean; rows: UsageRow[]; recent: unknown[]; notes: string[] }> {
  const s = await getSettings(ctx);
  const rows: UsageRow[] = [];
  for (const kind of SOLAR_REQUEST_KINDS) {
    const base = { companyId: oid(ctx.companyId), kind, isDemo: { $ne: true } };
    const [m, d] = await Promise.all([SolarRequestModel.countDocuments({ ...base, month: monthKey() }), SolarRequestModel.countDocuments({ ...base, day: dayKey() })]);
    const free = num(s.monthlyFree?.[kind]);
    const lim = num(s.dailyLimit?.[kind]);
    const price = s.pricePer1000Cents?.[kind];
    const over = Math.max(0, m - free);
    rows.push({
      kind, month: m, day: d, monthlyFree: free, dailyLimit: lim,
      percentOfFree: free > 0 ? round((m / free) * 100, 1) : 0,
      overFree: over,
      estimatedOverageCents: typeof price === 'number' ? Math.round((over / 1000) * price) : null,
      warning: free > 0 && m >= (free * s.warnPercent) / 100,
      blocked: d >= lim || (m >= free && !s.allowOverage),
    });
  }
  const recent = await SolarRequestModel.find({ companyId: oid(ctx.companyId) }).sort({ requestedAt: -1 }).limit(25).select({ rawResponse: 0 }).lean();
  return {
    month: monthKey(), configured: isConfigured(), enabled: s.enabled, rows,
    recent: recent.map((r) => ({ id: r._id.toString(), kind: r.kind, quality: r.quality ?? null, status: r.status, errorCode: r.errorCode ?? null, at: r.requestedAt.toISOString(), durationMs: r.durationMs ?? null, propertyId: r.propertyId?.toString() ?? null, isDemo: Boolean((r as { isDemo?: boolean }).isDemo) })),
    notes: ['Counts are requests this CRM sent; Google remains the source of truth for billing (Cloud Console > Billing). Allowances and prices are configurable and must be checked against your Google Cloud pricing.'],
  };
}

export async function updateSettings(ctx: SolarCtx, patch: Record<string, unknown>): Promise<MeasurementSettingsDocument> {
  const s = await getSettings(ctx);
  const before = s.toObject();
  for (const [k, v] of Object.entries(patch)) (s as unknown as Record<string, unknown>)[k] = v;
  s.updatedBy = oid(ctx.userId);
  await s.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement_settings.updated', entityType: 'measurement_settings', entityId: s._id.toString(), changes: { keys: Object.keys(patch), before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])) }, requestId: ctx.requestId, ip: ctx.ip });
  return s;
}

/** Runs one outbound Google request under the daily/monthly limits and records it in the ledger. */
export type ApiCallLog = { kind: Kind; quality?: string; status: 'ok' | 'not_found' | 'error'; errorCode?: string; at: string };

export async function tracked<T>(ctx: SolarCtx, kind: Kind, meta: { quality?: string; latitude?: number; longitude?: number; propertyId?: string; keepRaw?: boolean; log?: ApiCallLog[] }, fn: () => Promise<T>): Promise<T> {
  const s = await getSettings(ctx);
  if (!s.enabled) throw new SolarError('DISABLED');
  const base = { companyId: oid(ctx.companyId), kind, isDemo: { $ne: true } };
  const [m, d] = await Promise.all([SolarRequestModel.countDocuments({ ...base, month: monthKey() }), SolarRequestModel.countDocuments({ ...base, day: dayKey() })]);
  if (d >= num(s.dailyLimit?.[kind]) || (m >= num(s.monthlyFree?.[kind]) && !s.allowOverage)) throw new SolarError('LIMIT_REACHED');
  const started = Date.now();
  const row = { companyId: oid(ctx.companyId), userId: oid(ctx.userId), kind, quality: meta.quality, latitude: meta.latitude, longitude: meta.longitude, propertyId: meta.propertyId ? oid(meta.propertyId) : undefined, month: monthKey(), day: dayKey(), requestedAt: new Date() };
  try {
    const out = await fn();
    meta.log?.push({ kind, quality: meta.quality, status: 'ok', at: new Date().toISOString() });
    const keep = meta.keepRaw && s.rawRetentionDays > 0;
    await SolarRequestModel.create({ ...row, status: 'ok', durationMs: Date.now() - started, ...(keep ? { rawResponse: out, rawExpiresAt: new Date(Date.now() + s.rawRetentionDays * 86_400_000) } : {}) });
    void SolarRequestModel.updateMany({ rawExpiresAt: { $lt: new Date() }, rawResponse: { $exists: true } }, { $unset: { rawResponse: 1 } }).catch(() => undefined);
    return out;
  } catch (err) {
    const code = err instanceof SolarError ? err.code : 'BAD_RESPONSE';
    meta.log?.push({ kind, quality: meta.quality, status: code === 'NOT_FOUND' ? 'not_found' : 'error', errorCode: code, at: new Date().toISOString() });
    await SolarRequestModel.create({ ...row, status: code === 'NOT_FOUND' ? 'not_found' : 'error', errorCode: code, durationMs: Date.now() - started });
    throw err;
  }
}

/** One-way fingerprint of the configured key. Lets a stored test result be invalidated when the key changes; the key itself is never stored. */
function keyFingerprint(): string | null {
  if (adapterOverride && process.env.NODE_ENV === 'test') return adapterOverride.keyFingerprint;
  const key = getEnv().GOOGLE_SOLAR_API_KEY;
  return key ? createHash('sha256').update(`legacy-solar:${key}`).digest('hex').slice(0, 16) : null;
}

/** Removes every occurrence of secrets from text before it can be logged or returned. */
export function redactSecrets(text: string): string {
  const key = getEnv().GOOGLE_SOLAR_API_KEY;
  let out = key ? text.split(key).join('[redacted]') : text;
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');
  return out;
}

let solarLog: Logger | undefined;
function logSolar(level: 'info' | 'warn', fields: Record<string, unknown>, msg: string): void {
  solarLog ??= createLogger();
  solarLog[level](JSON.parse(redactSecrets(JSON.stringify(fields))) as Record<string, unknown>, redactSecrets(msg));
}

/** Google's documented sample location, which has Solar API coverage. */
export const TEST_LOCATION = { latitude: 37.445, longitude: -122.139 } as const;

export type ConnectionResult = { ok: boolean; code: string; httpStatus: number | null; message: string; fix: string | null; quality?: string };

/**
 * Real connection check: one authenticated Building Insights request at Google's sample location.
 * Nothing is saved except the sanitised result. A 200 is not enough: the body must contain roof segment data.
 * "Connected" can only come from this function succeeding.
 */
export async function testConnection(ctx: SolarCtx): Promise<ConnectionResult> {
  const s = await getSettings(ctx);
  const fp = keyFingerprint();
  let result: ConnectionResult;
  let extra: { imageryDate?: string; segments?: number } = {};
  try {
    const bi = await tracked(ctx, 'building_insights', { quality: 'BASE', latitude: TEST_LOCATION.latitude, longitude: TEST_LOCATION.longitude }, () =>
      adapter().findClosestBuilding(TEST_LOCATION.latitude, TEST_LOCATION.longitude, 'BASE'),
    );
    const segments = bi.solarPotential?.roofSegmentStats;
    if (!Array.isArray(segments) || segments.length === 0 || !bi.imageryQuality) throw new SolarError('BAD_RESPONSE', 200);
    const d = bi.imageryDate;
    extra = { segments: segments.length, imageryDate: d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : undefined };
    result = { ok: true, code: 'OK', httpStatus: 200, message: `Connected. Google returned roof data (${segments.length} segments, ${bi.imageryQuality} imagery) for the sample location.`, fix: null, quality: bi.imageryQuality };
  } catch (err) {
    if (!(err instanceof SolarError)) throw err;
    result = { ok: false, code: err.code, httpStatus: err.httpStatus ?? null, message: err.message, fix: SOLAR_ADMIN_FIX[err.code] };
  }
  s.lastConnectionTest = { at: new Date(), ok: result.ok, code: result.code, httpStatus: result.httpStatus ?? undefined, message: result.message, fix: result.fix ?? undefined, quality: result.quality, keyFingerprint: fp ?? undefined, ...extra };
  await s.save();
  logSolar(result.ok ? 'info' : 'warn', { code: result.code, httpStatus: result.httpStatus }, 'Google Solar connection test');
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement_settings.connection_tested', entityType: 'measurement_settings', entityId: s._id.toString(), changes: { ok: result.ok, code: result.code, httpStatus: result.httpStatus }, requestId: ctx.requestId, ip: ctx.ip });
  return result;
}

export type SolarState = 'not_configured' | 'disabled' | 'configuration_required' | 'connected' | 'connection_failed' | 'quota_exceeded';

export async function integrationState(ctx: SolarCtx): Promise<{ state: SolarState; keyConfigured: boolean; lastTest: Record<string, unknown> | null; stale: boolean }> {
  const s = await getSettings(ctx);
  const keyConfigured = isConfigured();
  const t = s.lastConnectionTest;
  // A result only counts for the key that was tested. A changed or removed key invalidates it.
  const matches = Boolean(t?.at) && Boolean(t?.keyFingerprint) && t?.keyFingerprint === keyFingerprint();
  const quota = t?.code === 'QUOTA_EXCEEDED' || t?.code === 'LIMIT_REACHED';
  const state: SolarState = !keyConfigured ? 'not_configured' : !s.enabled ? 'disabled' : !matches ? 'configuration_required' : t?.ok ? 'connected' : quota ? 'quota_exceeded' : 'connection_failed';
  const lastTest = t?.at && matches
    ? { at: t.at.toISOString(), ok: t.ok, code: t.code, httpStatus: t.httpStatus ?? null, message: t.message, fix: t.fix ?? null, quality: t.quality ?? null, imageryDate: t.imageryDate ?? null, segments: t.segments ?? null }
    : null;
  return { state, keyConfigured, lastTest, stale: Boolean(t?.at) && !matches };
}

// ------------------------------------------------------------------ address search

export type AddressSearchResult = {
  crm: Array<{ propertyId: string; customerId: string; label: string; latitude: number | null; longitude: number | null }>;
  geocoded: Array<GeocodeCandidate & { precise: boolean }>;
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function searchAddress(ctx: SolarCtx, q: string, geocode: boolean): Promise<AddressSearchResult> {
  const term = q.trim();
  if (term.length < 3) return { crm: [], geocoded: [] };
  const scope = ctx.role === 'admin' ? {} : { customerId: { $in: await CustomerModel.find({ ownerId: ctx.userId }).distinct('_id') } };
  const re = new RegExp(escapeRe(term), 'i');
  const props = await PropertyModel.find({ ...scope, $or: [{ 'address.line1': re }, { 'address.city': re }, { 'address.zip': re }] }).limit(8);
  const crm: AddressSearchResult['crm'] = [];
  for (const p of props) {
    if ((await companyOfCustomer(p.customerId)) !== ctx.companyId) continue;
    crm.push({ propertyId: p._id.toString(), customerId: p.customerId.toString(), label: [p.address.line1, p.address.city, [p.address.state, p.address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), latitude: p.location?.lat ?? null, longitude: p.location?.lng ?? null });
  }
  let geocoded: AddressSearchResult['geocoded'] = [];
  if (geocode) {
    try {
      const c = await tracked(ctx, 'geocode', {}, () => adapter().geocode(term));
      geocoded = c.map((x) => ({ ...x, precise: ['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER'].includes(x.locationType) && !x.partialMatch }));
    } catch (err) {
      if (err instanceof SolarError && err.code === 'GEOCODE_NO_RESULT') geocoded = [];
      else throw toAppError(err);
    }
  }
  return { crm, geocoded };
}

// ------------------------------------------------------------------ running a measurement

export type RunInput = {
  propertyId?: string;
  customerId?: string;
  address?: { line1: string; city?: string; state?: string; zip: string };
  latitude?: number;
  longitude?: number;
  /** The user confirmed an approximate pin location. */
  confirmApproximate?: boolean;
  /** Ignore the cache and request fresh data (creates a new revision). */
  force?: boolean;
};

/** Runs for the same property are serialised: a double click or a refresh waits, then reuses the first result. */
const locks = new Map<string, Promise<unknown>>();

async function resolveProperty(ctx: SolarCtx, input: RunInput): Promise<{ propertyId: string; customerId: string; lat: number; lng: number; address: string }> {
  const auth = { userId: ctx.userId, role: ctx.role };
  let property;
  if (input.propertyId) {
    const t = await resolveCustomerPropertyTarget(auth, { propertyId: input.propertyId });
    property = await PropertyModel.findById(t.propertyId);
  } else if (input.customerId && input.address) {
    const customer = await CustomerModel.findById(input.customerId);
    if (!customer || (ctx.role !== 'admin' && customer.ownerId.toString() !== ctx.userId)) throw invalid('customerId', 'Customer not found');
    const key = buildAddressKey(input.address);
    property = key ? await PropertyModel.findOne({ customerId: customer._id, addressKey: key }) : null; // never duplicate an existing property
    // Older properties may have no addressKey: fall back to the street line and ZIP.
    property ??= await PropertyModel.findOne({ customerId: customer._id, 'address.zip': input.address.zip, 'address.line1': new RegExp(`^${escapeRe(input.address.line1.trim())}$`, 'i') });
    if (!property) {
      property = await PropertyModel.create({
        customerId: customer._id,
        address: { line1: input.address.line1, city: input.address.city ?? '', state: input.address.state ?? '', zip: input.address.zip },
        addressKey: key,
        location: input.latitude !== undefined && input.longitude !== undefined ? { lat: input.latitude, lng: input.longitude } : undefined,
        createdBy: oid(ctx.userId),
      });
      await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'property.created_for_measurement', entityType: 'property', entityId: property._id.toString(), requestId: ctx.requestId, ip: ctx.ip });
    }
  } else {
    throw invalid('propertyId', 'Choose a property, or a customer with an address.');
  }
  if (!property) throw invalid('propertyId', 'Property not found');
  if ((await companyOfCustomer(property.customerId)) !== ctx.companyId) throw notFound('Property');

  const addr = [property.address.line1, property.address.city, [property.address.state, property.address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  let lat = input.latitude ?? property.location?.lat;
  let lng = input.longitude ?? property.location?.lng;
  if (lat === undefined || lng === undefined) {
    // Geocoding finds the address; it is not a measurement. Only used when the property has no stored coordinates.
    const [best] = await tracked(ctx, 'geocode', { propertyId: property._id.toString() }, () => adapter().geocode(addr));
    if (!best) throw new SolarError('GEOCODE_NO_RESULT');
    const precise = ['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER'].includes(best.locationType) && !best.partialMatch;
    if (!precise && !input.confirmApproximate) throw new SolarError('ADDRESS_NOT_PRECISE');
    lat = best.latitude;
    lng = best.longitude;
    property.location = { lat, lng };
    await property.save();
  } else if (input.latitude !== undefined && input.longitude !== undefined && (property.location?.lat !== lat || property.location?.lng !== lng)) {
    property.location = { lat, lng };
    await property.save();
  }
  return { propertyId: property._id.toString(), customerId: property.customerId.toString(), lat: lat as number, lng: lng as number, address: addr };
}

export async function runMeasurement(ctx: SolarCtx, input: RunInput): Promise<{ measurement: MeasurementDto; cached: boolean }> {
  const lockKey = `${ctx.companyId}:${input.propertyId ?? `${input.customerId}:${buildAddressKey(input.address ?? null) ?? ''}`}`;
  const previous = locks.get(lockKey) ?? Promise.resolve();
  const job = previous.catch(() => undefined).then(() => runOnce(ctx, input));
  locks.set(lockKey, job);
  try {
    return await job;
  } finally {
    if (locks.get(lockKey) === job) locks.delete(lockKey);
  }
}

async function runOnce(ctx: SolarCtx, input: RunInput): Promise<{ measurement: MeasurementDto; cached: boolean }> {
  const target = await resolveProperty(ctx, input).catch((e) => { throw toAppError(e); });
  const s = await getSettings(ctx);

  // Reuse a recent result for the same property instead of paying for another request.
  const latest = await MeasurementModel.findOne({ companyId: oid(ctx.companyId), propertyId: oid(target.propertyId), provider: 'google_solar', supersededById: { $exists: false }, isDemo: { $ne: true } }).sort({ createdAt: -1 });
  if (latest && !input.force && s.cacheDays > 0 && Date.now() - latest.createdAt.getTime() < s.cacheDays * 86_400_000) {
    return { measurement: toDto(latest), cached: true };
  }

  try {
    const quality: ImageryQuality = s.preferredQuality as ImageryQuality;
    const plan: ImageryQuality[] = quality === 'BASE' ? ['BASE'] : s.allowBaseFallback ? [quality, 'BASE'] : [quality];
    let raw;
    let lastErr: unknown;
    const calls: ApiCallLog[] = [];
    for (const q of plan) {
      try {
        raw = await tracked(ctx, 'building_insights', { quality: q, latitude: target.lat, longitude: target.lng, propertyId: target.propertyId, keepRaw: true, log: calls }, () => adapter().getBuildingInsights(target.lat, target.lng, q));
        break;
      } catch (err) {
        lastErr = err;
        if (!(err instanceof SolarError && err.code === 'NOT_FOUND')) throw err; // only "no imagery at this quality" triggers the controlled fallback
      }
    }
    if (!raw) throw lastErr;
    const roof = normalizeBuildingInsights(raw);
    const saved = await saveAutomated(ctx, target, roof, latest, raw.name ?? null, calls);
    // Aerial image, elevation and building mask. A failure here never fails the measurement: the area/pitch data are already saved.
    const { enrichGeometry } = await import('./solar.geometry.service.js');
    await enrichGeometry(ctx, saved, calls).catch(() => undefined);
    return { measurement: toDto((await MeasurementModel.findById(saved._id)) ?? saved), cached: false };
  } catch (err) {
    throw toAppError(err);
  }
}

async function saveAutomated(ctx: SolarCtx, target: { propertyId: string; customerId: string; lat: number; lng: number }, roof: NormalizedRoof, previous: MeasurementDocument | null, buildingName: string | null, calls: ApiCallLog[] = []): Promise<MeasurementDocument> {
  const edges = edgesUnavailable();
  const requestRow = await SolarRequestModel.findOne({ companyId: oid(ctx.companyId), propertyId: oid(target.propertyId), kind: 'building_insights', status: 'ok' }).sort({ requestedAt: -1 }).select({ _id: 1, requestedAt: 1 });
  const doc = await MeasurementModel.create({
    companyId: oid(ctx.companyId),
    propertyId: oid(target.propertyId),
    customerId: oid(target.customerId),
    source: 'google_solar',
    provider: 'google_solar',
    providerStatus: 'connected', // a real authenticated request just succeeded
    measurementDate: new Date(),
    units: 'sq_ft',
    totalArea: roof.areaSqFt,
    facets: roof.segmentCount,
    pitch: roof.predominantPitch,
    notes: roof.warnings.join(' '),
    revision: previous ? (previous.revision ?? 1) + 1 : 1,
    wastePercent: (await getSettings(ctx)).recommendedPitchedWaste,
    flatWastePercent: (await getSettings(ctx)).recommendedFlatWaste,
    supersedesId: previous?._id,
    automated: {
      ...roof,
      requestId: requestRow?._id.toString() ?? null,
      requestedAt: (requestRow?.requestedAt ?? new Date()).toISOString(),
      coordinates: { latitude: target.lat, longitude: target.lng },
      providerBuildingId: buildingName,
      apiCalls: [...calls],
      attribution: 'Includes data from Google Maps. Source: Includes solar data from Google.',
    },
    edges,
    fieldSources: { totalArea: 'google', facets: 'google', pitch: 'calculated' },
    verified: {},
    counts: {},
    corrections: [],
    createdBy: oid(ctx.userId),
  });
  if (previous) await MeasurementModel.updateOne({ _id: previous._id }, { $set: { supersededById: doc._id } }); // history is kept, never overwritten
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement.google_solar_imported', entityType: 'measurement', entityId: doc._id.toString(), changes: { propertyId: target.propertyId, quality: roof.imagery.quality, segments: roof.segmentCount, revision: doc.revision }, requestId: ctx.requestId, ip: ctx.ip });
  return doc;
}

// ------------------------------------------------------------------ corrections

const NUMERIC_FIELDS = ['totalArea', 'facets', 'ridge', 'hip', 'valley', 'eave', 'rake'] as const;
const COUNT_FIELDS = ['pipeBoots', 'vents', 'skylights', 'chimneys', 'roofLayers'] as const;
const TEXT_FIELDS = ['pitch', 'chimneyDetails', 'extraTearOff', 'notes'] as const;
export const CORRECTABLE_FIELDS = [...NUMERIC_FIELDS, ...COUNT_FIELDS, ...TEXT_FIELDS] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export async function applyCorrections(ctx: SolarCtx, id: string, input: { changes?: Partial<Record<CorrectableField, number | string | null>>; verify?: Partial<Record<CorrectableField, boolean>>; reason: string }): Promise<MeasurementDto> {
  const doc = await loadMeasurement(ctx, id);
  if (doc.supersededById) throw new AppError({ status: 409, code: 'MEASUREMENT_SUPERSEDED', message: 'A newer revision exists. Edit the latest revision.' });
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid('reason', 'A reason is required.');
  const sources = { ...((doc.fieldSources ?? {}) as Record<string, string>) };
  const verified = { ...((doc.verified ?? {}) as Record<string, boolean>) };
  const counts = { ...((doc.counts ?? {}) as Record<string, number | string>) };
  const corrections = [...((doc.corrections ?? []) as unknown[])];
  const now = new Date().toISOString();
  const get = (f: CorrectableField): number | string | null => {
    if ((COUNT_FIELDS as readonly string[]).includes(f) || f === 'chimneyDetails' || f === 'extraTearOff') return (counts[f] as number | string | undefined) ?? null;
    return ((doc as unknown as Record<string, number | string | undefined>)[f] ?? null) as number | string | null;
  };
  for (const [field, value] of Object.entries(input.changes ?? {}) as Array<[CorrectableField, number | string | null]>) {
    if (!(CORRECTABLE_FIELDS as readonly string[]).includes(field)) throw invalid(field, 'This value cannot be edited.');
    if ((NUMERIC_FIELDS as readonly string[]).includes(field) || (COUNT_FIELDS as readonly string[]).includes(field)) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw invalid(field, 'Enter a number of zero or more.');
      if ((COUNT_FIELDS as readonly string[]).includes(field) && value !== null && !Number.isInteger(value)) throw invalid(field, 'Enter a whole number.');
    }
    if (field === 'pitch' && value !== null && value !== '' && parsePitchRise(String(value)) === null) throw invalid('pitch', 'Use rise/12, for example 6/12.');
    const original = get(field);
    if (original === value) continue;
    if ((COUNT_FIELDS as readonly string[]).includes(field) || field === 'chimneyDetails' || field === 'extraTearOff') {
      if (value === null || value === '') delete counts[field];
      else counts[field] = value as number | string;
    } else {
      (doc as unknown as Record<string, unknown>)[field] = value === null ? undefined : value;
    }
    sources[field] = 'manual';
    delete verified[field]; // a changed value is no longer the verified one
    corrections.push({ field, original, updated: value, userId: ctx.userId, at: now, reason });
  }
  for (const [field, v] of Object.entries(input.verify ?? {})) {
    if (!(CORRECTABLE_FIELDS as readonly string[]).includes(field)) throw invalid(field, 'This value cannot be verified.');
    if (v && !can(ctx, 'measurements:verify')) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission to verify measurements.' });
    if (v) {
      verified[field] = true;
      corrections.push({ field, original: get(field as CorrectableField), updated: get(field as CorrectableField), userId: ctx.userId, at: now, reason: `Verified: ${reason}` });
    } else delete verified[field];
  }
  // Edge lengths entered by hand replace the "unavailable" placeholders (the placeholder entry is kept for history).
  const edges = ((doc.edges as Edge[] | undefined) ?? edgesUnavailable()).map((e) => {
    if (!(EDGE_TYPES as readonly string[]).includes(e.type) || !(input.changes && e.type in input.changes)) return e;
    const v = (input.changes as Record<string, number | string | null>)[e.type];
    return { ...e, lengthFt: typeof v === 'number' ? v : null, source: 'manual' as const, confidence: 'none' as const, verification: verified[e.type] ? ('verified' as const) : ('unverified' as const), note: 'Entered manually.' };
  }).map((e) => (verified[e.type] && e.source === 'manual' ? { ...e, verification: 'verified' as const } : e));
  doc.set('fieldSources', sources);
  doc.set('verified', verified);
  doc.set('counts', counts);
  doc.set('corrections', corrections);
  doc.set('edges', edges);
  doc.markModified('fieldSources');
  doc.markModified('verified');
  doc.markModified('counts');
  doc.markModified('corrections');
  doc.markModified('edges');
  await doc.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement.corrected', entityType: 'measurement', entityId: id, changes: { fields: [...Object.keys(input.changes ?? {}), ...Object.keys(input.verify ?? {})], reason }, requestId: ctx.requestId, ip: ctx.ip });
  return toDto(doc);
}

// ------------------------------------------------------------------ views derived from a measurement

export function measuredEdgeSummary(doc: MeasurementDocument): ReturnType<typeof summarizeEdges> {
  const edges = (doc.edges as Edge[] | undefined) ?? edgesUnavailable();
  const verified = (doc.verified ?? {}) as Record<string, boolean>;
  return summarizeEdges(edges).map((s) => {
    const stored = (doc as unknown as Record<string, number | undefined>)[s.type];
    return typeof stored === 'number'
      ? { ...s, lengthFt: stored, status: verified[s.type] ? ('verified' as const) : ('estimated' as const) }
      : s;
  });
}

export async function getEstimateInputs(ctx: SolarCtx, id: string): Promise<Record<string, unknown>> {
  const doc = await loadMeasurement(ctx, id);
  const areaSqFt = doc.units === 'squares' ? (doc.totalArea ?? 0) * 100 : doc.units === 'sq_m' ? (doc.totalArea ?? 0) * 10.7639104167 : (doc.totalArea ?? 0);
  const has = (doc.totalArea ?? 0) > 0;
  const missing: Array<{ key: string; label: string; reason: string }> = [
    { key: 'stories', label: 'Number of stories', reason: 'Confirm on site; the two-story charge is not applied automatically.' },
    { key: 'extraLayers', label: 'Extra tear-off layers', reason: 'Needs inspection; not available from aerial data.' },
    { key: 'decking', label: 'Decking replacement', reason: 'Needs findings on site; not assumed.' },
    { key: 'permit', label: 'Permit and city fees', reason: 'At cost: enter the actual fee.' },
  ];
  for (const e of EDGE_TYPES) if (typeof (doc as unknown as Record<string, number | undefined>)[e] !== 'number') missing.push({ key: e, label: `${e[0]?.toUpperCase()}${e.slice(1)} length`, reason: 'Google Solar does not provide edge lengths. Enter it manually.' });
  const sources = (doc.fieldSources ?? {}) as Record<string, string>;
  const verified = (doc.verified ?? {}) as Record<string, boolean>;
  return {
    measurementId: doc._id.toString(),
    revision: doc.revision ?? 1,
    source: doc.source,
    isDemo: Boolean(doc.isDemo),
    superseded: Boolean(doc.supersededById),
    areaSqFt: has ? round(areaSqFt) : null,
    squares: has ? round(sqFtToSquares(areaSqFt)) : null,
    pitch: doc.pitch || null,
    areaSource: sources.totalArea ?? 'manual',
    areaVerified: Boolean(verified.totalArea),
    edgeLengthsFt: Object.fromEntries(EDGE_TYPES.map((e) => [e, (doc as unknown as Record<string, number | undefined>)[e] ?? null])),
    counts: doc.counts ?? {},
    wasteTable: has ? wasteTable(areaSqFt) : [],
    wasteNote: 'Squares are the base roof area. The customer catalog shingle rates already include waste, so do not add waste again when pricing. The waste table is for material ordering.',
    missing,
    warnings: [
      ...(doc.isDemo ? ['This is demonstration data, not a real measurement.'] : []),
      ...(!verified.totalArea && sources.totalArea !== 'manual' ? ['Aerial measurement: field verification is recommended before contractual pricing.'] : []),
    ],
  };
}

export async function listHistory(ctx: SolarCtx, propertyId: string): Promise<MeasurementDto[]> {
  const t = await resolveCustomerPropertyTarget({ userId: ctx.userId, role: ctx.role }, { propertyId });
  if ((await companyOfCustomer(t.customerId)) !== ctx.companyId) throw notFound('Property');
  const rows = await MeasurementModel.find({ propertyId: t.propertyId }).sort({ createdAt: -1 }).limit(50);
  return rows.map(toDto);
}

export { loadMeasurement };
