/** Orchestration for the professional measurement: Data Layers, geometry, edges, photos, materials. */
import mongoose from 'mongoose';
import { getEnv } from '../../../config/env.js';
import { recordAudit } from '../../../services/audit.js';
import { buildStorageKey, getStorageAdapter } from '../../../services/storage/local-storage.adapter.js';
import { AppError } from '../../../utils/errors.js';
import { FileModel } from '../../files/file.model.js';
import type { MeasurementDocument } from '../measurement.model.js';
import { MeasurementModel } from '../measurement.model.js';
import { toDto, type MeasurementDto } from '../measurement.service.js';
import { geometryBounds, renderAerialPng } from './geometry/aerial.js';
import { buildRoofGeometry, edgeTotals } from './geometry/derive.js';
import { DIAGRAM_KINDS, renderAerialOverlay, renderApproximateDiagram, renderDiagram } from './geometry/diagrams.js';
import { readGeoTiff } from './geometry/geotiff-reader.js';
import { GEOMETRY_EDGE_TYPES, type DerivedEdge, type GeometryEdgeType, type RoofGeometry } from './geometry/types.js';
import { SolarError } from './errors.js';
import { m2ToSqFt, round } from './geo.js';
import { DEFAULT_MATERIAL_RULES, calculateProductMaterials, type CatalogProduct, type EdgeInput, type FamilyResult, type LengthKey, type MaterialRule, type ProductFamily } from './materials.js';
import type { NormalizedRoof } from './normalize.js';
import { adapter, getSettings, loadMeasurement, tracked, type ApiCallLog, type SolarCtx } from './solar.service.js';
import { FLAT_WASTE, MATERIAL_WASTE_COLUMNS, PITCHED_WASTE, WASTE_PERCENTS, wasteTable } from './waste.js';
import { MaterialProductModel } from './solar.model.js';

const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);
const invalid = (path: string, message: string): AppError => new AppError({ status: 422, code: 'VALIDATION_ERROR', message, details: [{ path, message }] });
const notFound = (what: string): AppError => new AppError({ status: 404, code: 'NOT_FOUND', message: `${what} not found.` });
const isoDate = (d?: { year: number; month: number; day: number }): string | null => (d?.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null);

// ---------------------------------------------------------------- Data Layers + geometry

/** Radius and pixel size sized to the building, so large rasters are not downloaded for ordinary houses. */
export function planDataLayers(roof: NormalizedRoof): { radiusMeters: number; pixelSizeMeters: number } {
  const groundM2 = (roof.groundAreaSqFt ?? roof.areaSqFt) / 10.7639104167;
  const radiusMeters = Math.round(Math.min(90, Math.max(30, Math.sqrt(groundM2) * 0.9 + 18)));
  const pixelSizeMeters = radiusMeters <= 35 ? 0.1 : radiusMeters <= 60 ? 0.25 : 0.5;
  return { radiusMeters, pixelSizeMeters };
}

function unavailable(reason: string, roof: NormalizedRoof | undefined): RoofGeometry {
  return {
    version: 1, method: 'dsm-mask-segment-assignment', status: 'unavailable', reason,
    frame: { epsg: 0, cx: 0, cy: 0, latitude: roof?.buildingCenter?.latitude ?? 0, longitude: roof?.buildingCenter?.longitude ?? 0 },
    pixelSizeM: 0, structures: [], facets: [], edges: [], imagery: null, warnings: [], builtAt: new Date().toISOString(),
  };
}

async function purgeExpired(): Promise<void> {
  const old = await FileModel.find({ tag: 'aerial_imagery', expiresAt: { $lt: new Date() } }).select({ storageKey: 1 });
  for (const f of old) {
    await getStorageAdapter().deleteObject(f.storageKey).catch(() => undefined);
    await FileModel.deleteOne({ _id: f._id });
  }
}

/**
 * Fetches Google Data Layers for a measurement, extracts roof geometry and stores the derived aerial image.
 * Call only when a Data Layers request is wanted: it spends one Data Layers request (counted in the ledger).
 */
export async function enrichGeometry(ctx: SolarCtx, doc: MeasurementDocument, calls: ApiCallLog[] = [], opts: { strict?: boolean } = {}): Promise<RoofGeometry> {
  const settings = await getSettings(ctx);
  const roof = doc.automated as NormalizedRoof | undefined;
  let geometry: RoofGeometry;
  let aerialPng: Buffer | null = null;
  if (!roof) {
    geometry = unavailable('This measurement has no Google roof data.', undefined);
  } else if (!settings.includeImagery) {
    geometry = unavailable('Aerial imagery and roof outlines are turned off in the integration settings.', roof);
  } else {
    try {
      const center = roof.buildingCenter ?? { latitude: (doc.automated as { coordinates: { latitude: number } }).coordinates.latitude, longitude: (doc.automated as { coordinates: { longitude: number } }).coordinates.longitude };
      const plan = planDataLayers(roof);
      const layers = await tracked(ctx, 'data_layers', { quality: 'BASE', latitude: center.latitude, longitude: center.longitude, propertyId: doc.propertyId.toString(), log: calls }, async () => {
        const dl = await adapter().getDataLayers(center.latitude, center.longitude, { radiusMeters: plan.radiusMeters, pixelSizeMeters: plan.pixelSizeMeters, view: 'IMAGERY_LAYERS', quality: 'BASE' });
        if (!dl.rgbUrl || !dl.dsmUrl || !dl.maskUrl) throw new SolarError('BAD_RESPONSE');
        // The links expire in an hour and carry authorisation: download now, never store them.
        const [rgbB, dsmB, maskB] = await Promise.all([adapter().downloadGeoTiff(dl.rgbUrl), adapter().downloadGeoTiff(dl.dsmUrl), adapter().downloadGeoTiff(dl.maskUrl)]);
        return { dl, rgb: await readGeoTiff(rgbB), dsm: await readGeoTiff(dsmB), mask: await readGeoTiff(maskB) };
      });
      geometry = buildRoofGeometry({ rasters: { dsm: layers.dsm, mask: layers.mask, rgb: layers.rgb }, roof, center });
      const frameLocal = { cx: geometry.frame.cx || layers.dsm.originX + (layers.dsm.width * layers.dsm.pixel) / 2, cy: geometry.frame.cy || layers.dsm.originY - (layers.dsm.height * layers.dsm.pixel) / 2 };
      const bounds = geometryBounds(geometry) ?? { minX: -plan.radiusMeters * 0.6, maxX: plan.radiusMeters * 0.6, minY: -plan.radiusMeters * 0.6, maxY: plan.radiusMeters * 0.6 };
      const aerial = renderAerialPng(layers.rgb, frameLocal, bounds, 8);
      if (aerial) {
        aerialPng = aerial.png;
        geometry.imagery = { ...aerial.imagery, date: isoDate(layers.dl.imageryDate), quality: layers.dl.imageryQuality ?? null, fileId: null, retainedUntil: null };
      } else geometry.warnings.push('The aerial image could not be produced from the returned imagery.');
    } catch (err) {
      // A refresh must never replace good geometry with an error: report the failure and keep what we have.
      if (opts.strict) throw err instanceof SolarError ? err : new SolarError('BAD_RESPONSE');
      geometry = unavailable(err instanceof SolarError ? err.message : 'Roof imagery could not be processed.', roof);
    }
  }
  // Store the derived aerial image (subject to the retention setting); older ones for this measurement are replaced.
  if (aerialPng && geometry.imagery) {
    await purgeExpired().catch(() => undefined);
    const old = await FileModel.find({ measurementId: doc._id, tag: 'aerial_imagery' }).select({ storageKey: 1 });
    for (const f of old) { await getStorageAdapter().deleteObject(f.storageKey).catch(() => undefined); await FileModel.deleteOne({ _id: f._id }); }
    if (settings.imageryRetentionDays > 0) {
      const filename = `aerial-${doc._id.toString().slice(-6)}.png`;
      const storageKey = `${ctx.companyId}/${buildStorageKey(filename)}`;
      await getStorageAdapter().putObject({ key: storageKey, buffer: aerialPng, contentType: 'image/png' });
      const expiresAt = new Date(Date.now() + settings.imageryRetentionDays * 86_400_000);
      const file = await FileModel.create({
        originalFilename: filename, storageKey, mimeType: 'image/png', sizeBytes: aerialPng.length, category: 'other', companyId: oid(ctx.companyId), customerId: doc.customerId, propertyId: doc.propertyId,
        measurementId: doc._id, tag: 'aerial_imagery', caption: 'Aerial imagery from Google (derived report asset)', visibility: 'internal', uploadedBy: oid(ctx.userId), expiresAt,
      });
      geometry.imagery.fileId = file._id.toString();
      geometry.imagery.retainedUntil = expiresAt.toISOString();
    } else geometry.warnings.push('Imagery retention is 0 days: the aerial image was not stored, so it cannot be shown again without a new Data Layers request.');
  }
  doc.set('geometry', geometry);
  doc.markModified('geometry');
  const automated = { ...(doc.automated as Record<string, unknown>), apiCalls: [...(((doc.automated as { apiCalls?: unknown[] }).apiCalls) ?? []), ...calls.filter((c) => c.kind === 'data_layers')] };
  doc.set('automated', automated);
  doc.markModified('automated');
  await doc.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement.geometry_built', entityType: 'measurement', entityId: doc._id.toString(), changes: { status: geometry.status, facets: geometry.facets.length, edges: geometry.edges.length, reason: geometry.reason }, requestId: ctx.requestId, ip: ctx.ip });
  return geometry;
}

export async function refreshGeometry(ctx: SolarCtx, id: string): Promise<MeasurementDto> {
  const doc = await loadMeasurement(ctx, id);
  if (doc.supersededById) throw new AppError({ status: 409, code: 'MEASUREMENT_SUPERSEDED', message: 'A newer revision exists. Refresh the latest revision.' });
  if (!doc.automated) throw invalid('id', 'Only Google measurements have imagery.');
  const calls: ApiCallLog[] = [];
  try {
    await enrichGeometry(ctx, doc, calls, { strict: true });
  } catch (err) {
    if (err instanceof SolarError) throw new AppError({ status: err.code === 'LIMIT_REACHED' ? 429 : 502, code: `SOLAR_${err.code}`, message: err.message });
    throw err;
  }
  return toDto((await MeasurementModel.findById(doc._id)) as MeasurementDocument);
}

export async function getAerial(ctx: SolarCtx, id: string): Promise<{ buffer: Buffer; imagery: NonNullable<RoofGeometry['imagery']> }> {
  const doc = await loadMeasurement(ctx, id);
  const g = doc.geometry as RoofGeometry | undefined;
  if (!g?.imagery?.fileId) throw notFound('Aerial image');
  const file = await FileModel.findById(g.imagery.fileId);
  if (!file || (file.expiresAt && file.expiresAt < new Date())) {
    await purgeExpired().catch(() => undefined);
    throw new AppError({ status: 410, code: 'IMAGERY_EXPIRED', message: 'The stored aerial image has expired. Use "Refresh imagery" to fetch it again.' });
  }
  const obj = await getStorageAdapter().getObject(file.storageKey);
  if (!obj) throw notFound('Aerial image');
  const parts: Buffer[] = [];
  for await (const p of obj.body) parts.push(p as Buffer);
  return { buffer: Buffer.concat(parts), imagery: g.imagery };
}

// ---------------------------------------------------------------- summary and diagrams

export type RoofSummary = {
  totalAreaSqFt: number;
  squares: number;
  pitchedAreaSqFt: number;
  flatAreaSqFt: number;
  facetCount: number;
  predominantPitch: string;
  pitchBreakdown: Array<{ pitch: string; segmentCount: number; areaSqFt: number; percent: number; flat: boolean }>;
  structures: Array<{ id: string; kind: string; label: string; footprintAreaSqFt: number; roofAreaSqFt: number | null; pitchedAreaSqFt: number | null; flatAreaSqFt: number | null; facetCount: number | null; roofAreaMeasured: boolean; note: string }>;
};

export function summaryFor(doc: MeasurementDocument): RoofSummary {
  const roof = doc.automated as NormalizedRoof | undefined;
  const total = doc.totalArea ?? roof?.areaSqFt ?? 0;
  const segs = roof?.segments ?? [];
  const flat = segs.filter((s) => s.pitchDegrees < 5).reduce((a, s) => a + s.areaSqFt, 0);
  const segTotal = segs.reduce((a, s) => a + s.areaSqFt, 0);
  // If staff corrected the total, scale pitched/flat proportionally so the parts still add up to the stated total.
  const k = segTotal > 0 ? total / segTotal : 1;
  const flatArea = roof ? round(flat * k) : 0;
  const g = doc.geometry as RoofGeometry | undefined;
  const structures: RoofSummary['structures'] = (g?.structures?.length ? g.structures : []).map((s) => ({
    id: s.id, kind: s.kind, label: s.kind === 'main' ? 'Main building' : `Additional structure ${s.id}`, footprintAreaSqFt: s.footprintAreaSqFt,
    roofAreaSqFt: s.roofAreaMeasured ? round(total) : null, pitchedAreaSqFt: s.roofAreaMeasured ? round(total - flatArea) : null, flatAreaSqFt: s.roofAreaMeasured ? flatArea : null,
    facetCount: s.roofAreaMeasured ? segs.length : null, roofAreaMeasured: s.roofAreaMeasured, note: s.note,
  }));
  if (structures.length === 0 && roof) {
    structures.push({ id: 'ST1', kind: 'main', label: 'Main building', footprintAreaSqFt: roof.groundAreaSqFt ?? 0, roofAreaSqFt: round(total), pitchedAreaSqFt: round(total - flatArea), flatAreaSqFt: flatArea, facetCount: segs.length, roofAreaMeasured: true, note: 'Outline not available' });
  }
  return {
    totalAreaSqFt: round(total), squares: round(total / 100), pitchedAreaSqFt: round(total - flatArea), flatAreaSqFt: flatArea, facetCount: doc.facets ?? segs.length,
    predominantPitch: doc.pitch || roof?.predominantPitch || '',
    pitchBreakdown: (roof?.pitchDistribution ?? []).map((p) => ({ ...p, areaSqFt: round(p.areaSqFt * k), flat: Number.parseFloat(p.pitch) < 1 })),
    structures,
  };
}

export type DiagramSet = {
  status: RoofGeometry['status'] | 'none';
  approximate: boolean;
  reason: string | null;
  svgs: Partial<Record<(typeof DIAGRAM_KINDS)[number], string>>;
  aerialOverlay: string | null;
  imagery: RoofGeometry['imagery'];
  warnings: string[];
};

export function buildDiagrams(doc: MeasurementDocument, highlightEdge?: string | null): DiagramSet {
  const g = doc.geometry as RoofGeometry | undefined;
  const roof = doc.automated as NormalizedRoof | undefined;
  if (g && g.facets.length > 0 && g.structures.length > 0) {
    // Edges are drawn from the stored list, which already carries manual changes.
    const svgs = Object.fromEntries(DIAGRAM_KINDS.map((k) => [k, renderDiagram(g, k, { highlightEdge })])) as DiagramSet['svgs'];
    return { status: g.status, approximate: g.status !== 'ok', reason: g.reason, svgs, aerialOverlay: renderAerialOverlay(g), imagery: g.imagery, warnings: g.warnings };
  }
  if (roof) {
    const svg = renderApproximateDiagram(roof.segments);
    return { status: g?.status ?? 'none', approximate: true, reason: g?.reason ?? 'Roof imagery has not been fetched for this measurement.', svgs: { outline: svg, facets: svg, area: svg, pitch: svg, edges: svg }, aerialOverlay: null, imagery: g?.imagery ?? null, warnings: g?.warnings ?? [] };
  }
  return { status: 'none', approximate: true, reason: 'No Google roof data.', svgs: {}, aerialOverlay: null, imagery: null, warnings: [] };
}

// ---------------------------------------------------------------- edges

export type EdgePatch = { type?: GeometryEdgeType; lengthFt?: number | null; included?: boolean; verification?: 'unverified' | 'needs_verification' | 'verified'; note?: string; reason: string };

function geometryOf(doc: MeasurementDocument): RoofGeometry {
  const g = doc.geometry as RoofGeometry | undefined;
  if (!g) throw invalid('geometry', 'This measurement has no roof geometry yet.');
  return g;
}

/** Edge totals that are verified (or entered by staff) become the measurement's edge lengths. */
export function recomputeEdgeFields(doc: MeasurementDocument): void {
  const g = doc.geometry as RoofGeometry | undefined;
  if (!g) return;
  const totals = edgeTotals(g.edges);
  const sources = { ...((doc.fieldSources ?? {}) as Record<string, string>) };
  const verified = { ...((doc.verified ?? {}) as Record<string, boolean>) };
  for (const t of ['ridge', 'hip', 'valley', 'eave', 'rake'] as const) {
    const mine = g.edges.filter((e) => e.type === t && e.included && e.lengthFt !== null);
    const allDone = mine.length > 0 && mine.every((e) => e.verification === 'verified' || e.source === 'manual');
    if (totals[t].verifiedFt !== null) {
      (doc as unknown as Record<string, number | undefined>)[t] = totals[t].verifiedFt as number;
      sources[t] = mine.every((e) => e.source === 'manual') ? 'manual' : 'derived';
      if (allDone) verified[t] = true; else delete verified[t];
    } else if (sources[t] === 'derived') {
      (doc as unknown as Record<string, number | undefined>)[t] = undefined;
      delete sources[t];
      delete verified[t];
    }
  }
  doc.set('fieldSources', sources);
  doc.set('verified', verified);
  doc.markModified('fieldSources');
  doc.markModified('verified');
}

async function saveGeometry(ctx: SolarCtx, doc: MeasurementDocument, g: RoofGeometry, action: string, changes: unknown): Promise<MeasurementDto> {
  doc.set('geometry', g);
  doc.markModified('geometry');
  recomputeEdgeFields(doc);
  await doc.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action, entityType: 'measurement', entityId: doc._id.toString(), changes, requestId: ctx.requestId, ip: ctx.ip });
  return toDto(doc);
}

function assertEditable(doc: MeasurementDocument, reason: string): string {
  if (doc.supersededById) throw new AppError({ status: 409, code: 'MEASUREMENT_SUPERSEDED', message: 'A newer revision exists. Edit the latest revision.' });
  const r = reason.trim();
  if (r.length < 3) throw invalid('reason', 'A reason is required.');
  return r;
}

export async function patchEdge(ctx: SolarCtx, id: string, edgeId: string, p: EdgePatch): Promise<MeasurementDto> {
  const doc = await loadMeasurement(ctx, id);
  const reason = assertEditable(doc, p.reason);
  const g = structuredClone(geometryOf(doc));
  const e = g.edges.find((x) => x.id === edgeId);
  if (!e) throw notFound('Edge');
  if (p.verification === 'verified' && !ctx.permissions.includes('measurements:verify')) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission to verify measurements.' });
  if (p.type !== undefined && !(GEOMETRY_EDGE_TYPES as readonly string[]).includes(p.type)) throw invalid('type', 'Unknown edge type.');
  if (p.lengthFt !== undefined && p.lengthFt !== null && (!Number.isFinite(p.lengthFt) || p.lengthFt < 0 || p.lengthFt > 5000)) throw invalid('lengthFt', 'Enter a length between 0 and 5,000 ft.');
  const at = new Date().toISOString();
  const hist = (field: string, from: unknown, to: unknown): void => { e.history.push({ at, userId: ctx.userId, field, from, to, reason }); };
  let touched = false;
  if (p.type !== undefined && p.type !== e.type) { hist('type', e.type, p.type); e.type = p.type; touched = true; }
  if (p.lengthFt !== undefined && p.lengthFt !== e.lengthFt) { hist('lengthFt', e.lengthFt, p.lengthFt); e.lengthFt = p.lengthFt; e.source = 'manual'; touched = true; }
  if (p.included !== undefined && p.included !== e.included) { hist('included', e.included, p.included); e.included = p.included; touched = true; }
  if (p.note !== undefined && p.note !== e.note) { hist('note', e.note, p.note); e.note = p.note; }
  // A changed edge is unverified again unless the same request explicitly verifies it.
  e.verification = p.verification ?? (touched && e.verification === 'verified' ? 'unverified' : e.verification);
  if (p.verification) hist('verification', 'previous', p.verification);
  if (e.verification === 'verified' && e.lengthFt === null) throw invalid('verification', 'An edge without a length cannot be verified. Enter its length first.');
  return saveGeometry(ctx, doc, g, 'measurement.edge_changed', { edgeId, fields: Object.keys(p).filter((k) => k !== 'reason'), reason });
}

export async function addEdge(ctx: SolarCtx, id: string, p: { type: GeometryEdgeType; lengthFt: number; note?: string; reason: string }): Promise<MeasurementDto> {
  const doc = await loadMeasurement(ctx, id);
  const reason = assertEditable(doc, p.reason);
  if (!(GEOMETRY_EDGE_TYPES as readonly string[]).includes(p.type)) throw invalid('type', 'Unknown edge type.');
  if (!Number.isFinite(p.lengthFt) || p.lengthFt < 0 || p.lengthFt > 5000) throw invalid('lengthFt', 'Enter a length between 0 and 5,000 ft.');
  const g = structuredClone((doc.geometry as RoofGeometry | undefined) ?? unavailable('Edges entered by hand; no roof imagery.', doc.automated as NormalizedRoof | undefined));
  const next = g.edges.reduce((m, x) => Math.max(m, Number.parseInt(x.id.slice(1), 10) || 0), 0) + 1;
  const edge: DerivedEdge = {
    id: `E${next}`, type: p.type, lengthFt: round(p.lengthFt, 1), planLengthFt: round(p.lengthFt, 1), a: [0, 0], b: [0, 0], facetIds: [], source: 'manual', confidence: 'medium',
    verification: 'unverified', included: true, note: p.note ?? 'Entered manually.', history: [{ at: new Date().toISOString(), userId: ctx.userId, field: 'created', from: null, to: p.lengthFt, reason }],
  };
  g.edges.push(edge);
  return saveGeometry(ctx, doc, g, 'measurement.edge_added', { edgeId: edge.id, type: p.type, lengthFt: p.lengthFt, reason });
}

export async function verifyEdges(ctx: SolarCtx, id: string, p: { ids?: string[]; reason: string }): Promise<MeasurementDto> {
  const doc = await loadMeasurement(ctx, id);
  const reason = assertEditable(doc, p.reason);
  if (!ctx.permissions.includes('measurements:verify')) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission to verify measurements.' });
  const g = structuredClone(geometryOf(doc));
  const at = new Date().toISOString();
  let n = 0;
  for (const e of g.edges) {
    if (p.ids ? !p.ids.includes(e.id) : false) continue;
    if (!p.ids && (e.verification === 'needs_verification' || e.lengthFt === null)) continue; // "verify all" never sweeps in uncertain edges
    if (e.lengthFt === null || e.verification === 'verified') continue;
    e.history.push({ at, userId: ctx.userId, field: 'verification', from: e.verification, to: 'verified', reason });
    e.verification = 'verified';
    n += 1;
  }
  if (n === 0) throw invalid('ids', 'No edges could be verified. Edges that need verification must be selected individually.');
  return saveGeometry(ctx, doc, g, 'measurement.edges_verified', { count: n, ids: p.ids ?? 'all-confident', reason });
}

// ---------------------------------------------------------------- waste, materials, estimate quantities

export async function setWaste(ctx: SolarCtx, id: string, p: { percent?: number; flatPercent?: number }): Promise<MeasurementDto> {
  const doc = await loadMeasurement(ctx, id);
  if (doc.supersededById) throw new AppError({ status: 409, code: 'MEASUREMENT_SUPERSEDED', message: 'A newer revision exists.' });
  for (const [path, v] of [['percent', p.percent], ['flatPercent', p.flatPercent]] as const) {
    if (v !== undefined && !(WASTE_PERCENTS as readonly number[]).includes(v)) throw invalid(path, `Waste must be one of ${WASTE_PERCENTS.join(', ')}%.`);
  }
  const before = { pitched: doc.wastePercent, flat: doc.flatWastePercent };
  if (p.percent !== undefined) doc.wastePercent = p.percent;
  if (p.flatPercent !== undefined) doc.flatWastePercent = p.flatPercent;
  await doc.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement.waste_selected', entityType: 'measurement', entityId: id, changes: { from: before, to: { pitched: doc.wastePercent, flat: doc.flatWastePercent } }, requestId: ctx.requestId, ip: ctx.ip });
  return toDto(doc);
}

export function edgeInputs(doc: MeasurementDocument): Record<'ridge' | 'hip' | 'valley' | 'eave' | 'rake', EdgeInput> {
  const all = lengthInputs(doc);
  return { ridge: all.ridge, hip: all.hip, valley: all.valley, eave: all.eave, rake: all.rake };
}

/**
 * Edge totals with their trust level. verified = every included edge of that type is verified or entered by staff (or the total was
 * typed in); unverified = only derived lengths exist; missing = nothing is known, which is never treated as zero.
 */
export function lengthInputs(doc: MeasurementDocument): Record<LengthKey, EdgeInput> {
  const g = doc.geometry as RoofGeometry | undefined;
  const sources = (doc.fieldSources ?? {}) as Record<string, string>;
  const verified = (doc.verified ?? {}) as Record<string, boolean>;
  const out = {} as Record<LengthKey, EdgeInput>;
  for (const t of ['ridge', 'hip', 'valley', 'eave', 'rake', 'step_flashing', 'wall_flashing', 'curb_flashing'] as const) {
    const mine = (g?.edges ?? []).filter((e) => e.type === t && e.included && e.lengthFt !== null);
    const stored = (doc as unknown as Record<string, number | undefined>)[t];
    if (mine.length > 0) {
      const sum = round(mine.reduce((a, e) => a + (e.lengthFt as number), 0), 1);
      const done = mine.every((e) => e.verification === 'verified' || e.source === 'manual');
      // Edges needing verification have no length, so they are not in `mine`; they still block "verified".
      const pending = (g?.edges ?? []).some((e) => e.type === t && e.included && e.lengthFt === null && e.verification === 'needs_verification');
      out[t] = { ft: sum, status: done && !pending ? 'verified' : 'unverified' };
    } else if (typeof stored === 'number') out[t] = { ft: stored, status: verified[t] || sources[t] === 'manual' ? 'verified' : 'unverified' };
    else out[t] = { ft: null, status: 'missing' };
  }
  return out;
}

export async function materialRulesFor(ctx: SolarCtx): Promise<MaterialRule[]> {
  const s = await getSettings(ctx);
  const custom = s.materialRules as unknown as MaterialRule[] | undefined;
  return custom && custom.length > 0 ? custom : DEFAULT_MATERIAL_RULES;
}

// ---------------------------------------------------------------- company product catalog

export type ProductDto = { id: string; family: ProductFamily; brand: string; name: string; packageUnit: string; coveragePerPackage: number; countKey: string | null; enabled: boolean; specConfirmed: boolean; sortOrder: number; notes: string; isDemo: boolean };
const toProduct = (d: InstanceType<typeof MaterialProductModel>): ProductDto => ({
  id: d._id.toString(), family: d.family as ProductFamily, brand: d.brand ?? '', name: d.name, packageUnit: d.packageUnit, coveragePerPackage: d.coveragePerPackage, countKey: d.countKey ?? null,
  enabled: d.enabled, specConfirmed: d.specConfirmed, sortOrder: d.sortOrder ?? 0, notes: d.notes ?? '', isDemo: Boolean(d.isDemo),
});

export async function listProducts(ctx: SolarCtx): Promise<ProductDto[]> {
  return (await MaterialProductModel.find({ companyId: oid(ctx.companyId) }).sort({ family: 1, sortOrder: 1, brand: 1 })).map(toProduct);
}

export type ProductInput = { family: ProductFamily; brand?: string; name: string; packageUnit: string; coveragePerPackage: number; countKey?: string; enabled?: boolean; specConfirmed?: boolean; sortOrder?: number; notes?: string };

export async function createProduct(ctx: SolarCtx, input: ProductInput): Promise<ProductDto> {
  if (input.family === 'accessory' && !input.countKey) throw invalid('countKey', 'Accessories need the count they use (pipeBoots, vents, skylights, chimneys).');
  const d = await MaterialProductModel.create({ ...input, companyId: oid(ctx.companyId) });
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'material_product.created', entityType: 'material_product', entityId: d._id.toString(), changes: { family: input.family, name: input.name, coveragePerPackage: input.coveragePerPackage, specConfirmed: Boolean(input.specConfirmed) }, requestId: ctx.requestId, ip: ctx.ip });
  return toProduct(d);
}

export async function updateProduct(ctx: SolarCtx, id: string, patch: Partial<ProductInput>): Promise<ProductDto> {
  const d = mongoose.isValidObjectId(id) ? await MaterialProductModel.findOne({ _id: id, companyId: oid(ctx.companyId) }) : null;
  if (!d) throw notFound('Product');
  const before = toProduct(d);
  Object.assign(d, patch);
  await d.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'material_product.updated', entityType: 'material_product', entityId: id, changes: { fields: Object.keys(patch), before: { coveragePerPackage: before.coveragePerPackage, specConfirmed: before.specConfirmed, enabled: before.enabled } }, requestId: ctx.requestId, ip: ctx.ip });
  return toProduct(d);
}

export async function deleteProduct(ctx: SolarCtx, id: string): Promise<void> {
  const d = mongoose.isValidObjectId(id) ? await MaterialProductModel.findOneAndDelete({ _id: id, companyId: oid(ctx.companyId) }) : null;
  if (!d) throw notFound('Product');
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'material_product.deleted', entityType: 'material_product', entityId: id, changes: { name: d.name }, requestId: ctx.requestId, ip: ctx.ip });
}

export type MaterialsResult = {
  wastePercent: number;
  flatWastePercent: number;
  recommended: { pitched: number; flat: number };
  pitchedAreaSqFt: number;
  flatAreaSqFt: number;
  wasteTables: { pitched: ReturnType<typeof wasteTable>; flat: ReturnType<typeof wasteTable> };
  wasteColumns: readonly number[];
  families: FamilyResult[];
  productsConfigured: boolean;
};

export async function getMaterials(ctx: SolarCtx, id: string, wasteOverride?: number): Promise<MaterialsResult> {
  const doc = await loadMeasurement(ctx, id);
  const s = await getSettings(ctx);
  const pitchedWaste = wasteOverride ?? doc.wastePercent ?? s.recommendedPitchedWaste;
  if (!(WASTE_PERCENTS as readonly number[]).includes(pitchedWaste)) throw invalid('waste', `Waste must be one of ${WASTE_PERCENTS.join(', ')}%.`);
  const sum = summaryFor(doc);
  const products = (await MaterialProductModel.find({ companyId: oid(ctx.companyId) })).map(toProduct);
  const catalog: CatalogProduct[] = products.map((p) => ({ id: p.id, family: p.family, brand: p.brand, name: p.name, packageUnit: p.packageUnit, coveragePerPackage: p.coveragePerPackage, countKey: p.countKey ?? undefined, specConfirmed: p.specConfirmed, enabled: p.enabled, sortOrder: p.sortOrder }));
  const families = calculateProductMaterials({ pitchedAreaSqFt: sum.pitchedAreaSqFt, lengths: lengthInputs(doc), counts: (doc.counts ?? {}) as Record<string, number | string>, wasteColumns: MATERIAL_WASTE_COLUMNS }, catalog);
  return {
    wastePercent: pitchedWaste, flatWastePercent: doc.flatWastePercent ?? s.recommendedFlatWaste, recommended: { pitched: s.recommendedPitchedWaste, flat: s.recommendedFlatWaste },
    pitchedAreaSqFt: sum.pitchedAreaSqFt, flatAreaSqFt: sum.flatAreaSqFt,
    wasteTables: { pitched: wasteTable(sum.pitchedAreaSqFt, PITCHED_WASTE), flat: wasteTable(sum.flatAreaSqFt, FLAT_WASTE) },
    wasteColumns: MATERIAL_WASTE_COLUMNS, families, productsConfigured: products.some((p) => p.enabled),
  };
}

/** Catalog quantity bases that can be pre-filled, with how trustworthy each input is. */
export function suggestedQuantities(doc: MeasurementDocument): Array<{ basis: string; label: string; quantity: number; status: 'verified' | 'unverified'; from: string }> {
  const e = edgeInputs(doc);
  const g = doc.geometry as RoofGeometry | undefined;
  const t = g ? edgeTotals(g.edges) : null;
  const counts = (doc.counts ?? {}) as Record<string, number | string>;
  const out: Array<{ basis: string; label: string; quantity: number; status: 'verified' | 'unverified'; from: string }> = [];
  const pair = (a: EdgeInput, b: EdgeInput): { v: number; s: 'verified' | 'unverified' } | null => (a.ft === null || b.ft === null ? null : { v: round(a.ft + b.ft, 1), s: a.status === 'verified' && b.status === 'verified' ? 'verified' : 'unverified' });
  const er = pair(e.eave, e.rake);
  if (er) { out.push({ basis: 'drip_edge_lf', label: 'Drip edge (eaves + rakes)', quantity: er.v, status: er.s, from: 'eave + rake' }); out.push({ basis: 'starter_lf', label: 'Starter strip (eaves + rakes)', quantity: er.v, status: er.s, from: 'eave + rake' }); }
  const hr = pair(e.hip, e.ridge);
  if (hr) out.push({ basis: 'ridge_lf', label: 'Hip and ridge cap', quantity: hr.v, status: hr.s, from: 'hip + ridge' });
  if (t?.step_flashing.verifiedFt != null) out.push({ basis: 'step_flashing_lf', label: 'Step flashing', quantity: t.step_flashing.verifiedFt, status: 'verified', from: 'verified step-flashing edges' });
  if (t?.wall_flashing.verifiedFt != null) out.push({ basis: 'headwall_lf', label: 'Headwall flashing', quantity: t.wall_flashing.verifiedFt, status: 'verified', from: 'verified wall-flashing edges' });
  for (const [basis, key, label] of [['pipe_boots', 'pipeBoots', 'Pipe boots'], ['box_vents', 'vents', 'Box vents'], ['chimney_kits', 'chimneys', 'Chimney flashing kits']] as const) {
    if (typeof counts[key] === 'number') out.push({ basis, label, quantity: counts[key] as number, status: 'verified', from: 'count entered by staff' });
  }
  return out;
}

// ---------------------------------------------------------------- field photos

export const PHOTO_CATEGORIES = ['aerial_overview', 'front_elevation', 'rear_elevation', 'left_elevation', 'right_elevation', 'roof_slope', 'damage_closeup', 'penetration', 'gutter', 'flashing', 'interior_damage', 'other'] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
export const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  aerial_overview: 'Aerial overview (uploaded)', front_elevation: 'Front elevation', rear_elevation: 'Rear elevation', left_elevation: 'Left elevation', right_elevation: 'Right elevation',
  roof_slope: 'Roof slopes', damage_closeup: 'Damage close-ups', penetration: 'Penetrations', gutter: 'Gutters', flashing: 'Flashing', interior_damage: 'Interior damage', other: 'Other',
};

export type PhotoDto = { id: string; filename: string; mimeType: string; category: PhotoCategory; relatedItem: string; notes: string; capturedAt: string | null; gps: { lat: number; lng: number } | null; verified: boolean; uploadedBy: string; createdAt: string; downloadPath: string };

const toPhoto = (f: InstanceType<typeof FileModel>): PhotoDto => ({
  id: f._id.toString(), filename: f.originalFilename, mimeType: f.mimeType, category: (f.photoCategory ?? 'other') as PhotoCategory, relatedItem: f.relatedItem ?? '', notes: f.caption ?? '',
  capturedAt: f.capturedAt ? f.capturedAt.toISOString() : null, gps: typeof f.gps?.lat === 'number' && typeof f.gps?.lng === 'number' ? { lat: f.gps.lat, lng: f.gps.lng } : null, verified: Boolean(f.photoVerified),
  uploadedBy: f.uploadedBy.toString(), createdAt: f.createdAt.toISOString(), downloadPath: `/files/${f._id.toString()}/download`,
});

export async function listPhotos(ctx: SolarCtx, id: string): Promise<PhotoDto[]> {
  const doc = await loadMeasurement(ctx, id);
  const rows = await FileModel.find({ measurementId: doc._id, photoCategory: { $exists: true } }).sort({ createdAt: 1 });
  return rows.map(toPhoto);
}

export async function addPhoto(ctx: SolarCtx, id: string, p: { filename: string; mimeType: string; contentBase64: string; category: PhotoCategory; relatedItem?: string; notes?: string; capturedAt?: string; gps?: { lat: number; lng: number } }): Promise<PhotoDto> {
  const doc = await loadMeasurement(ctx, id);
  const mime = p.mimeType.trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new AppError({ status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: 'Photos must be JPEG, PNG or WebP.' });
  const buffer = Buffer.from(p.contentBase64, 'base64');
  const max = getEnv().FILE_MAX_BYTES;
  if (buffer.length === 0 || buffer.length > max) throw new AppError({ status: 413, code: 'FILE_TOO_LARGE', message: `Photos must be between 1 byte and ${Math.round(max / 1_000_000)} MB.` });
  const storageKey = `${ctx.companyId}/${buildStorageKey(p.filename)}`;
  await getStorageAdapter().putObject({ key: storageKey, buffer, contentType: mime });
  const f = await FileModel.create({
    originalFilename: p.filename, storageKey, mimeType: mime, sizeBytes: buffer.length, category: 'photo', companyId: oid(ctx.companyId), customerId: doc.customerId, propertyId: doc.propertyId,
    inspectionId: doc.inspectionId, measurementId: doc._id, photoCategory: p.category, relatedItem: p.relatedItem ?? '', caption: p.notes ?? '', tag: PHOTO_CATEGORY_LABEL[p.category],
    capturedAt: p.capturedAt ? new Date(p.capturedAt) : undefined, gps: p.gps, photoVerified: false, visibility: 'internal', uploadedBy: oid(ctx.userId),
  });
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement.photo_added', entityType: 'measurement', entityId: id, changes: { fileId: f._id.toString(), category: p.category, bytes: buffer.length }, requestId: ctx.requestId, ip: ctx.ip });
  return toPhoto(f);
}

export async function patchPhoto(ctx: SolarCtx, id: string, fileId: string, p: { category?: PhotoCategory; relatedItem?: string; notes?: string; verified?: boolean }): Promise<PhotoDto> {
  const doc = await loadMeasurement(ctx, id);
  if (!mongoose.isValidObjectId(fileId)) throw notFound('Photo');
  const f = await FileModel.findOne({ _id: fileId, measurementId: doc._id });
  if (!f) throw notFound('Photo');
  if (p.verified !== undefined && !ctx.permissions.includes('measurements:verify')) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission to verify photos.' });
  if (p.category) { f.photoCategory = p.category; f.tag = PHOTO_CATEGORY_LABEL[p.category]; }
  if (p.relatedItem !== undefined) f.relatedItem = p.relatedItem;
  if (p.notes !== undefined) f.caption = p.notes;
  if (p.verified !== undefined) f.photoVerified = p.verified;
  await f.save();
  await recordAudit({ actorType: 'user', actorId: ctx.userId, action: 'measurement.photo_changed', entityType: 'measurement', entityId: id, changes: { fileId, fields: Object.keys(p) }, requestId: ctx.requestId, ip: ctx.ip });
  return toPhoto(f);
}

export { m2ToSqFt };
