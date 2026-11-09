import { describe, expect, it } from 'vitest';
import { classifyEdges, edgesUnavailable, summarizeEdges, type PlaneGeometry } from './edges.js';
import { SolarError } from './errors.js';
import { buildingInsightsFixture, geocodeFixture } from './fixtures.js';
import { compassFromAzimuth, m2ToSqFt, metersToFeet, pitchLabelFromDegrees, pitchRatioFromDegrees, sqFtToSquares } from './geo.js';
import { GoogleSolarAdapter } from './google-solar.adapter.js';
import { normalizeBuildingInsights } from './normalize.js';
import { wasteTable } from './waste.js';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const adapterWith = (impl: typeof fetch): GoogleSolarAdapter => new GoogleSolarAdapter({ apiKey: 'TEST-KEY-123', fetchImpl: impl });

describe('unit conversions', () => {
  it('converts area, squares and length', () => {
    expect(m2ToSqFt(100)).toBeCloseTo(1076.391, 2);
    expect(sqFtToSquares(1805)).toBeCloseTo(18.05, 5); // 1 square = 100 sq ft
    expect(metersToFeet(10)).toBeCloseTo(32.808, 2);
  });
  it('converts degrees to X/12 pitch with 12 x tan(angle) and keeps the exact ratio', () => {
    expect(pitchRatioFromDegrees(26.565)).toBeCloseTo(6, 2);
    expect(pitchLabelFromDegrees(26.565)).toBe('6/12');
    expect(pitchLabelFromDegrees(18.435)).toBe('4/12');
    expect(pitchLabelFromDegrees(33.69)).toBe('8/12');
    expect(pitchLabelFromDegrees(1)).toBe('0/12'); // effectively flat
  });
  it('maps azimuth to a compass direction', () => {
    expect([0, 90, 180, 270, 359].map(compassFromAzimuth)).toEqual(['N', 'E', 'S', 'W', 'N']);
  });
});

describe('waste table', () => {
  it('applies waste once to the base area and never twice', () => {
    const rows = wasteTable(1805);
    expect(rows.map((r) => r.percent)).toEqual([0, 5, 10, 12, 14, 15, 17, 20]);
    expect(rows[0]).toMatchObject({ wasteAreaSqFt: 0, finalAreaSqFt: 1805, finalSquares: 18.05 });
    expect(rows[2]).toMatchObject({ wasteAreaSqFt: 180.5, finalAreaSqFt: 1985.5, finalSquares: 19.86 });
    expect(rows[4]).toMatchObject({ percent: 14, finalAreaSqFt: 2057.7 });
    expect(rows[6]).toMatchObject({ percent: 17, finalAreaSqFt: 2111.85 });
    expect(rows[7]?.finalAreaSqFt).toBeCloseTo(2166, 5); // 20%
    // The base is the same on every row: waste is never compounded.
    expect(new Set(rows.map((r) => r.baseAreaSqFt)).size).toBe(1);
  });
});

describe('normalizeBuildingInsights', () => {
  const roof = normalizeBuildingInsights(buildingInsightsFixture());
  it('sums segments into area, squares and pitch distribution', () => {
    expect(roof.segmentCount).toBe(4);
    expect(roof.areaSqFt).toBeCloseTo(1805.1, 0);
    expect(roof.squares).toBeCloseTo(18.05, 1);
    expect(roof.predominantPitch).toBe('6/12');
    expect(roof.pitchDistribution.map((p) => [p.pitch, p.segmentCount])).toEqual([['6/12', 2], ['4/12', 2]]);
    expect(roof.pitchDistribution.reduce((a, p) => a + p.percent, 0)).toBeCloseTo(100, 0);
  });
  it('keeps per-segment values, provider order and original degrees; polygons are not available from this API', () => {
    const s = roof.segments[0];
    expect(s).toMatchObject({ id: 'S1', pitchDegrees: 26.57, pitchLabel: '6/12', compass: 'N', polygon: null, source: 'google_solar' });
    expect(s?.boundingBox).not.toBeNull();
    expect(roof.imagery).toEqual({ date: '2024-03-18', processedDate: '2024-09-02', quality: 'HIGH' });
  });
  it('refuses to fabricate: no segments means NO_ROOF_DATA', () => {
    expect(() => normalizeBuildingInsights({ name: 'x', solarPotential: {} })).toThrow(SolarError);
    try {
      normalizeBuildingInsights({ solarPotential: { roofSegmentStats: [{ pitchDegrees: 20 }] } });
    } catch (e) {
      expect((e as SolarError).code).toBe('NO_ROOF_DATA');
    }
  });
  it('skips incomplete segments with a warning and flags a large mismatch with the whole-roof area', () => {
    const bi = buildingInsightsFixture();
    (bi.solarPotential!.roofSegmentStats as unknown[]).push({ pitchDegrees: 10 });
    bi.solarPotential!.wholeRoofStats!.areaMeters2 = 300;
    const r = normalizeBuildingInsights(bi);
    expect(r.segmentCount).toBe(4);
    expect(r.warnings.length).toBe(2);
  });
});

describe('Google adapter', () => {
  it('sends the key only as a query parameter on the documented endpoint', async () => {
    let seen = '';
    const a = adapterWith(async (url) => {
      seen = String(url);
      return json(200, buildingInsightsFixture());
    });
    await a.findClosestBuilding(30.2672, -97.7431, 'HIGH');
    expect(seen).toContain('https://solar.googleapis.com/v1/buildingInsights:findClosest');
    expect(seen).toContain('requiredQuality=HIGH');
    expect(seen).toContain('location.latitude=30.267200');
  });
  it.each([
    [404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } }, 'NOT_FOUND'],
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'QUOTA_EXCEEDED'],
    [403, { error: { status: 'PERMISSION_DENIED', message: 'The billing account for the owning project is disabled' } }, 'BILLING_DISABLED'],
    [403, { error: { status: 'PERMISSION_DENIED', message: 'Solar API has not been used in project 1 before or it is disabled' } }, 'API_DISABLED'],
    [400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }, 'AUTH_FAILED'],
    [400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid location' } }, 'INVALID_COORDINATES'],
    [500, { error: {} }, 'BAD_RESPONSE'],
  ])('maps HTTP %i to %s without leaking provider text or the key', async (status, body, code) => {
    const a = adapterWith(async () => json(status, body));
    const err = await a.findClosestBuilding(30, -97, 'BASE').catch((e: SolarError) => e);
    expect((err as SolarError).code).toBe(code);
    expect((err as SolarError).message).not.toContain('TEST-KEY-123');
    expect((err as SolarError).message).not.toContain('billing account for the owning project');
  });
  it('rejects invalid coordinates before calling Google', async () => {
    let called = false;
    const a = adapterWith(async () => { called = true; return json(200, {}); });
    await expect(a.findClosestBuilding(120, 0, 'HIGH')).rejects.toMatchObject({ code: 'INVALID_COORDINATES' });
    expect(called).toBe(false);
  });
  it('maps timeouts and network failures; the key never appears in the error', async () => {
    const slow = new GoogleSolarAdapter({ apiKey: 'TEST-KEY-123', timeoutMs: 10, fetchImpl: (_u, init) => new Promise((_r, rej) => { init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
    await expect(slow.findClosestBuilding(30, -97, 'BASE')).rejects.toMatchObject({ code: 'TIMEOUT' });
    const down = adapterWith(async () => { throw new TypeError('fetch failed https://solar.googleapis.com/?key=TEST-KEY-123'); });
    const e = (await down.findClosestBuilding(30, -97, 'BASE').catch((x: SolarError) => x)) as SolarError;
    expect(e.code).toBe('NETWORK');
    expect(e.message).not.toContain('TEST-KEY-123');
  });
  it('returns Data Layers imagery metadata only (the one-hour GeoTIFF links are not kept)', async () => {
    const a = adapterWith(async (url) => {
      expect(String(url)).toContain('dataLayers:get');
      return json(200, { imageryDate: { year: 2023, month: 5, day: 1 }, imageryQuality: 'MEDIUM', dsmUrl: 'https://solar.googleapis.com/v1/solar/geoTiff:get?id=x' });
    });
    const im = await a.retrieveAvailableImagery(30, -97);
    expect(im).toEqual({ imageryDate: { year: 2023, month: 5, day: 1 }, imageryProcessedDate: undefined, imageryQuality: 'MEDIUM' });
  });
  it('geocodes into address parts and reports precision; handles no result and denied keys', async () => {
    const ok = await adapterWith(async () => json(200, geocodeFixture())).geocode('500 Example Ave Austin TX');
    expect(ok[0]).toMatchObject({ line1: '500 Example Ave', city: 'Austin', state: 'TX', zip: '78701', locationType: 'ROOFTOP' });
    await expect(adapterWith(async () => json(200, { status: 'ZERO_RESULTS', results: [] })).geocode('nowhere at all')).rejects.toMatchObject({ code: 'GEOCODE_NO_RESULT' });
    await expect(adapterWith(async () => json(200, { status: 'REQUEST_DENIED' })).geocode('500 Example Ave')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(adapterWith(async () => json(200, { status: 'OVER_QUERY_LIMIT' })).geocode('500 Example Ave')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
  it('requires a key', () => {
    expect(() => new GoogleSolarAdapter({ apiKey: '' })).toThrow(SolarError);
  });
});

describe('edge classification (synthetic geometry)', () => {
  const gable: PlaneGeometry[] = [
    { id: 'N', polygon: [[0, 0], [10, 0], [10, 5], [0, 5]], pitchDegrees: 26.565, azimuthDegrees: 0 },
    { id: 'S', polygon: [[0, -5], [10, -5], [10, 0], [0, 0]], pitchDegrees: 26.565, azimuthDegrees: 180 },
  ];
  it('finds the ridge, eaves and rakes of a gable roof, using true (sloped) lengths', () => {
    const sum = Object.fromEntries(summarizeEdges(classifyEdges(gable)).map((s) => [s.type, s]));
    expect(sum.ridge).toMatchObject({ edgeCount: 1 });
    expect(sum.ridge?.lengthFt).toBeCloseTo(32.8, 1);
    expect(sum.eave?.lengthFt).toBeCloseTo(65.6, 1);
    expect(sum.rake).toMatchObject({ edgeCount: 4 });
    expect(sum.rake?.lengthFt).toBeCloseTo(4 * 18.34, 0); // 5 m / cos(26.565 deg)
    expect(sum.hip?.lengthFt).toBeNull();
    expect(sum.valley?.lengthFt).toBeNull();
  });
  it('finds the four hips of a pyramid roof and never calls them ridges', () => {
    const p = 26.565;
    const hip: PlaneGeometry[] = [
      { id: 'S', polygon: [[0, 0], [10, 0], [5, 5]], pitchDegrees: p, azimuthDegrees: 180 },
      { id: 'E', polygon: [[10, 0], [10, 10], [5, 5]], pitchDegrees: p, azimuthDegrees: 90 },
      { id: 'N', polygon: [[10, 10], [0, 10], [5, 5]], pitchDegrees: p, azimuthDegrees: 0 },
      { id: 'W', polygon: [[0, 10], [0, 0], [5, 5]], pitchDegrees: p, azimuthDegrees: 270 },
    ];
    const sum = Object.fromEntries(summarizeEdges(classifyEdges(hip)).map((s) => [s.type, s]));
    expect(sum.hip).toMatchObject({ edgeCount: 4 });
    expect(sum.hip?.lengthFt).toBeCloseTo(4 * 24.61, 0) // each hip: sqrt(7.07^2 + 2.5^2) = 7.5 m;
    expect(sum.ridge?.edgeCount).toBe(0);
    expect(sum.eave).toMatchObject({ edgeCount: 4 });
    expect(sum.eave?.lengthFt).toBeCloseTo(4 * 32.81, 0);
  });
  it('finds a valley where two planes slope toward the shared edge', () => {
    const valley: PlaneGeometry[] = [
      { id: 'A', polygon: [[0, 0], [10, 0], [10, 5], [0, 5]], pitchDegrees: 26.565, azimuthDegrees: 180 },
      { id: 'B', polygon: [[0, -5], [10, -5], [10, 0], [0, 0]], pitchDegrees: 26.565, azimuthDegrees: 0 },
    ];
    const v = classifyEdges(valley).filter((e) => e.type === 'valley');
    expect(v).toHaveLength(1);
    expect(v[0]?.lengthFt).toBeCloseTo(32.8, 1);
  });
  it('flags ambiguous edges for manual verification instead of guessing, and is never "high" confidence', () => {
    const odd: PlaneGeometry[] = [
      { id: 'A', polygon: [[0, 0], [10, 0], [10, 5], [0, 5]], pitchDegrees: 20, azimuthDegrees: 0 },
      { id: 'B', polygon: [[0, -5], [10, -5], [10, 0], [0, 0]], pitchDegrees: 20, azimuthDegrees: 0 },
    ];
    const edges = classifyEdges(odd);
    const shared = edges.find((e) => e.planeIds.length === 2);
    expect(shared).toMatchObject({ type: 'unclassified', lengthFt: null, verification: 'manual_required' });
    expect(edges.every((e) => (e.confidence as string) !== 'high')).toBe(true);
  });
  it('reports every edge type as manual-required when only Google bounding boxes exist', () => {
    const e = edgesUnavailable();
    expect(e.map((x) => x.type)).toEqual(['ridge', 'hip', 'valley', 'eave', 'rake']);
    expect(e.every((x) => x.lengthFt === null && x.verification === 'manual_required' && x.source === 'unavailable')).toBe(true);
    expect(summarizeEdges(e).every((s) => s.lengthFt === null && s.status === 'manual_required')).toBe(true);
  });
});

describe('secret redaction', () => {
  it('removes the key and key= query parameters from anything that could be logged', async () => {
    const { loadEnv, resetEnvCache } = await import('../../../config/env.js');
    const { redactSecrets } = await import('./solar.service.js');
    loadEnv({ ...process.env, NODE_ENV: 'test', APP_URL: 'http://localhost:5173', CORS_ORIGINS: 'http://localhost:5173', MONGODB_URI: 'mongodb://127.0.0.1/x', JWT_ACCESS_SECRET: 'x'.repeat(32), GOOGLE_SOLAR_API_KEY: 'AIzaSECRETSECRETSECRET1234567890abc' });
    try {
      const text = JSON.stringify({ url: 'https://solar.googleapis.com/v1/x?location.latitude=1&key=AIzaSECRETSECRETSECRET1234567890abc&b=2', raw: 'AIzaSECRETSECRETSECRET1234567890abc', other: 'https://x/?key=another-key-value' });
      const out = redactSecrets(text);
      expect(out).not.toContain('SECRETSECRET');
      expect(out).not.toContain('another-key-value');
      expect(out).toContain('[redacted]');
      expect(out).toContain('location.latitude=1');
    } finally {
      resetEnvCache();
    }
  });
});
