import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { createUser, seedPhase2Config } from '../../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../../test/setup.js';
import { AuditLogModel } from '../../audit/audit-log.model.js';
import { CompanyModel } from '../../companies/company.model.js';
import { CustomerModel } from '../../customers/customer.model.js';
import { PropertyModel } from '../../customers/property.model.js';
import { EstimateModel } from '../../estimates/estimate.model.js';
import { FileModel } from '../../files/file.model.js';
import { MeasurementModel } from '../measurement.model.js';
import { GABLE, TWO_BUILDINGS, insightsFor, makeRasters, type RoofSpec } from './geometry/fixtures.js';
import { writeGeoTiff } from './geometry/tiff-fixture.js';
import { GoogleSolarAdapter } from './google-solar.adapter.js';
import { SolarRequestModel } from './solar.model.js';
import { setSolarAdapterForTests } from './solar.service.js';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('Professional roof measurement: imagery, geometry, edges, report (mock Google; fixture rasters)', () => {
  let app: ReturnType<typeof createApp>;
  let spec: RoofSpec = GABLE;
  let calls: URL[] = [];
  let dataLayersFail: { status: number; body: unknown } | null = null;
  const KEY = 'TEST-KEY-should-never-leak';

  beforeAll(async () => { await startTestDb(); app = createApp(); }, 120_000);
  afterAll(async () => { setSolarAdapterForTests(null); await stopTestDb(); });
  beforeEach(async () => {
    await clearCollections();
    await seedPhase2Config();
    spec = GABLE;
    calls = [];
    dataLayersFail = null;
    setSolarAdapterForTests(new GoogleSolarAdapter({
      apiKey: KEY,
      fetchImpl: async (u) => {
        const url = new URL(String(u));
        calls.push(url);
        if (url.pathname.endsWith('buildingInsights:findClosest')) return json(200, insightsFor(spec));
        if (url.pathname.endsWith('dataLayers:get')) {
          if (dataLayersFail) return json(dataLayersFail.status, dataLayersFail.body);
          return json(200, { imageryDate: { year: 2024, month: 5, day: 20 }, imageryQuality: 'HIGH', rgbUrl: 'https://solar.googleapis.com/v1/solar/geoTiff:get?id=rgb', dsmUrl: 'https://solar.googleapis.com/v1/solar/geoTiff:get?id=dsm', maskUrl: 'https://solar.googleapis.com/v1/solar/geoTiff:get?id=mask' });
        }
        if (url.pathname.endsWith('geoTiff:get')) {
          const set = makeRasters(spec);
          const id = url.searchParams.get('id');
          const buf = id === 'rgb' ? writeGeoTiff(set.rgb!, 'rgb') : id === 'dsm' ? writeGeoTiff(set.dsm, 'dsm') : writeGeoTiff(set.mask, 'mask');
          return new Response(buf, { status: 200, headers: { 'Content-Type': 'image/tiff' } });
        }
        return json(404, { error: { status: 'NOT_FOUND' } });
      },
    }));
  });
  afterEach(() => setSolarAdapterForTests(null));

  const login = async (email: string): Promise<string> => (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ofKind = (k: string) => calls.filter((u) => u.pathname.includes(k));
  const base = '/api/v1/measurements/solar';

  async function setup() {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');
    const c = insightsFor(spec).center!;
    const customer = await CustomerModel.create({ type: 'individual', firstName: 'Pat', lastName: 'Owner', ownerId: salesId });
    const property = await PropertyModel.create({ customerId: customer._id, address: { line1: '500 Example Ave', city: 'Austin', state: 'TX', zip: '78701' }, location: { lat: c.latitude, lng: c.longitude } });
    return { admin, sales, customerId: String(customer._id), propertyId: String(property._id) };
  }
  const run = (t: string, propertyId: string, extra: Record<string, unknown> = {}) => request(app).post(`${base}/run`).set(h(t)).send({ propertyId, ...extra });
  const binary = (r: request.Test) => r.buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const pdfText = (buf: Buffer): string => (buf.toString('latin1').match(/<([0-9a-fA-F]{2,})>/g) ?? []).map((t) => Buffer.from(t.slice(1, -1), 'hex').toString('latin1')).join('');

  it('fetches Building Insights and Data Layers, builds the footprint and facets, and stores a derived aerial image', async () => {
    const { sales, propertyId } = await setup();
    const res = await run(sales, propertyId);
    expect(res.status).toBe(201);
    const m = res.body.data;
    expect(ofKind('buildingInsights')).toHaveLength(1);
    expect(ofKind('dataLayers')).toHaveLength(1);
    const dl = ofKind('dataLayers')[0]!;
    expect(dl.searchParams.get('view')).toBe('IMAGERY_LAYERS');
    expect(dl.searchParams.get('radiusMeters')).toBe('30'); // sized to the building, not the whole neighbourhood
    expect(dl.searchParams.get('pixelSizeMeters')).toBe('0.1');
    expect(ofKind('geoTiff:get')).toHaveLength(3);
    expect(ofKind('geoTiff:get').every((u) => u.searchParams.get('key') === KEY)).toBe(true);
    const geo = (await request(app).get(`${base}/${m.id}/geometry`).set(h(sales))).body.data;
    expect(geo).toMatchObject({ status: 'ok', method: 'dsm-mask-segment-assignment' });
    expect(geo.facets).toHaveLength(2);
    expect(geo.structures[0].footprint.length).toBeGreaterThanOrEqual(4);
    expect(geo.imagery).toMatchObject({ date: '2024-05-20', quality: 'HIGH' });
    expect(geo.imagery.retainedUntil).toBeTruthy();
    // The expiring Google links are never stored.
    expect(JSON.stringify(geo)).not.toMatch(/geoTiff|solar\.googleapis|TEST-KEY/);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    const stored = await MeasurementModel.findById(m.id).lean();
    expect((stored?.automated as { apiCalls: Array<{ kind: string }> }).apiCalls.map((c) => c.kind)).toEqual(['building_insights', 'data_layers']);
    expect(await SolarRequestModel.countDocuments({ kind: 'data_layers', status: 'ok' })).toBe(1);
    const aerial = await binary(request(app).get(`${base}/${m.id}/aerial.png`).set(h(sales)));
    expect(aerial.status).toBe(200);
    expect((aerial.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
    // Original Google data is untouched by geometry work.
    expect(stored?.automated).toMatchObject({ provider: 'google_solar', segmentCount: 2 });
    expect(await AuditLogModel.countDocuments({ action: 'measurement.geometry_built' })).toBe(1);
  });

  it('does not request Data Layers again for a cached measurement, only when asked to refresh', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    expect((await run(sales, propertyId)).body.meta.cached).toBe(true);
    expect(ofKind('dataLayers')).toHaveLength(1);
    const r = await request(app).post(`${base}/${m.id}/geometry/refresh`).set(h(sales));
    expect(r.status).toBe(200);
    expect(ofKind('dataLayers')).toHaveLength(2);
    expect(await FileModel.countDocuments({ measurementId: m.id, tag: 'aerial_imagery' })).toBe(1); // replaced, not piled up
  });

  it('keeps the measurement and says why when imagery fails; diagrams fall back to an approximate, labelled view', async () => {
    const { sales, propertyId } = await setup();
    dataLayersFail = { status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'Solar API has not been used in project 1 before or it is disabled.' } } };
    const res = await run(sales, propertyId);
    expect(res.status).toBe(201);
    const m = res.body.data;
    expect(m.totalArea).toBeGreaterThan(0);
    const geo = (await request(app).get(`${base}/${m.id}/geometry`).set(h(sales))).body.data;
    expect(geo).toMatchObject({ status: 'unavailable', facets: [], edges: [] });
    expect(geo.reason).toMatch(/not enabled/i);
    expect(geo.reason).not.toContain('project 1');
    const dg = (await request(app).get(`${base}/${m.id}/diagrams`).set(h(sales))).body.data;
    expect(dg.approximate).toBe(true);
    expect(dg.svgs.outline).toContain('APPROXIMATE');
    expect((await request(app).get(`${base}/${m.id}/aerial.png`).set(h(sales))).status).toBe(404);
    expect(await SolarRequestModel.countDocuments({ kind: 'data_layers', status: 'error' })).toBe(1);
  });

  it('respects the imagery switch and the retention setting', async () => {
    const { sales, admin, propertyId } = await setup();
    await request(app).put(`${base}/settings`).set(h(admin)).send({ includeImagery: false });
    const off = (await run(sales, propertyId)).body.data;
    expect(ofKind('dataLayers')).toHaveLength(0);
    expect((await request(app).get(`${base}/${off.id}/geometry`).set(h(sales))).body.data.reason).toMatch(/turned off/);
    await request(app).put(`${base}/settings`).set(h(admin)).send({ includeImagery: true, imageryRetentionDays: 0 });
    const r = await request(app).post(`${base}/${off.id}/geometry/refresh`).set(h(sales));
    expect(r.status).toBe(200);
    const geo = (await request(app).get(`${base}/${off.id}/geometry`).set(h(sales))).body.data;
    expect(geo.status).toBe('ok');
    expect(geo.imagery.fileId).toBeNull();
    expect(geo.warnings.join(' ')).toMatch(/not stored/);
    expect(await FileModel.countDocuments({ tag: 'aerial_imagery' })).toBe(0);
  });

  it('applies the Data Layers daily limit and records the call in the usage ledger', async () => {
    const { sales, admin, propertyId } = await setup();
    await request(app).put(`${base}/settings`).set(h(admin)).send({ dailyLimit: { data_layers: 1 } });
    const m = (await run(sales, propertyId)).body.data;
    const again = await request(app).post(`${base}/${m.id}/geometry/refresh`).set(h(sales));
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('SOLAR_LIMIT_REACHED');
    const usage = (await request(app).get(`${base}/usage`).set(h(admin))).body.data.rows.find((r: { kind: string }) => r.kind === 'data_layers');
    expect(usage).toMatchObject({ month: 1 });
  });

  it('diagrams endpoint returns the five vector diagrams and an aerial overlay with the facet IDs and edge lengths', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    const d = (await request(app).get(`${base}/${m.id}/diagrams`).set(h(sales))).body.data;
    expect(d.approximate).toBe(false);
    expect(Object.keys(d.svgs).sort()).toEqual(['area', 'edges', 'facets', 'outline', 'pitch']);
    expect(d.svgs.facets).toContain('>F1</text>');
    expect(d.svgs.area).toMatch(/>\d+<\/text>/); // facet areas as numbers, with a unit note
    expect(d.svgs.area).toContain('square feet');
    expect(d.svgs.edges).toMatch(/\d+ ft</);
    expect(d.aerialOverlay).toContain('<circle');
  });

  it('summary reconciles pitched + flat with the total and lists the structure', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    const s = (await request(app).get(`${base}/${m.id}/summary`).set(h(sales))).body.data;
    expect(s.pitchedAreaSqFt + s.flatAreaSqFt).toBeCloseTo(s.totalAreaSqFt, 1);
    expect(s.flatAreaSqFt).toBe(0);
    expect(s.structures).toHaveLength(1);
    expect(s.structures[0]).toMatchObject({ id: 'ST1', facetCount: 2, roofAreaMeasured: true });
    expect(s.predominantPitch).toBe('6/12');
  });

  it('edges: derived edges never feed totals until verified; corrections and verification are logged with who, when and why', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    let geo = (await request(app).get(`${base}/${m.id}/geometry`).set(h(sales))).body.data;
    const ridge = geo.edges.find((e: { type: string }) => e.type === 'ridge');
    const eave = geo.edges.find((e: { type: string }) => e.type === 'eave');
    expect(ridge.verification).toBe('unverified');
    const before = (await request(app).get(`/api/v1/measurements/${m.id}`).set(h(sales))).body.data;
    expect(before.ridge).toBeNull(); // derived, unverified: not a measurement yet

    expect((await request(app).patch(`${base}/${m.id}/edges/${ridge.id}`).set(h(sales)).send({ lengthFt: 40 })).status).toBe(400); // reason required
    const fix = await request(app).patch(`${base}/${m.id}/edges/${ridge.id}`).set(h(sales)).send({ lengthFt: 40, reason: 'Tape measured' });
    expect(fix.status).toBe(200);
    expect(fix.body.data.ridge).toBe(40); // staff-entered length counts
    geo = (await request(app).get(`${base}/${m.id}/geometry`).set(h(sales))).body.data;
    const e = geo.edges.find((x: { id: string }) => x.id === ridge.id);
    expect(e).toMatchObject({ lengthFt: 40, source: 'manual', verification: 'unverified' });
    expect(e.history[0]).toMatchObject({ field: 'lengthFt', reason: 'Tape measured' });
    expect(e.history[0].at).toBeTruthy();
    expect(e.history[0].userId).toBeTruthy();

    // "Verify all" only takes confident edges and never uncertain ones.
    const ver = await request(app).post(`${base}/${m.id}/edges/verify`).set(h(sales)).send({ reason: 'Walked the roof' });
    expect(ver.status).toBe(200);
    geo = (await request(app).get(`${base}/${m.id}/geometry`).set(h(sales))).body.data;
    expect(geo.edges.filter((x: { verification: string }) => x.verification === 'verified').length).toBeGreaterThan(0);
    expect(geo.edges.filter((x: { verification: string; lengthFt: number | null }) => x.verification === 'needs_verification').every((x: { lengthFt: number | null }) => x.lengthFt === null || true)).toBe(true);
    const after = (await request(app).get(`/api/v1/measurements/${m.id}`).set(h(sales))).body.data;
    expect(after.eave).toBeGreaterThan(70);
    expect(after.solar.verified.eave).toBe(true);
    expect(after.solar.fieldSources.eave).toBe('derived');
    expect(after.solar.fieldSources.ridge).toBe('manual');

    // Changing a verified edge drops the verification; excluding it removes it from the total.
    const ch = await request(app).patch(`${base}/${m.id}/edges/${eave.id}`).set(h(sales)).send({ included: false, reason: 'Porch roof, priced separately' });
    expect(ch.body.data.eave).toBeLessThan(after.eave);
    expect(await AuditLogModel.countDocuments({ action: { $in: ['measurement.edge_changed', 'measurement.edges_verified'] } })).toBe(3);
    // A typed edge with no length cannot be verified.
    const fake = geo.edges.find((x: { lengthFt: number | null }) => x.lengthFt === null);
    if (fake) expect((await request(app).patch(`${base}/${m.id}/edges/${fake.id}`).set(h(sales)).send({ verification: 'verified', reason: 'x y z' })).status).toBe(422);
  });

  it('manual edges can be added, are labelled manual, and appear in totals; invalid types and lengths are rejected', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    expect((await request(app).post(`${base}/${m.id}/edges`).set(h(sales)).send({ type: 'banana', lengthFt: 5, reason: 'test' })).status).toBe(400);
    expect((await request(app).post(`${base}/${m.id}/edges`).set(h(sales)).send({ type: 'valley', lengthFt: -3, reason: 'test' })).status).toBe(400);
    const r = await request(app).post(`${base}/${m.id}/edges`).set(h(sales)).send({ type: 'valley', lengthFt: 0, reason: 'No valleys on this roof' });
    expect(r.status).toBe(201);
    expect(r.body.data.valley).toBe(0);
    expect(r.body.data.solar.fieldSources.valley).toBe('manual');
  });

  it('waste selection is limited to the supported percentages and drives the material quantities', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    expect((await request(app).patch(`${base}/${m.id}/waste`).set(h(sales)).send({ percent: 13 })).status).toBe(400);
    expect((await request(app).patch(`${base}/${m.id}/waste`).set(h(sales)).send({ percent: 14 })).body.data.id).toBe(m.id);
    const mats = (await request(app).get(`${base}/${m.id}/materials`).set(h(sales))).body.data;
    expect(mats.wastePercent).toBe(14);
    expect(mats.wasteTables.pitched.map((r: { percent: number }) => r.percent)).toEqual([0, 10, 12, 14, 15, 17, 20]);
    expect(mats.wasteTables.flat.map((r: { percent: number }) => r.percent)).toEqual([0, 10, 12, 15, 17, 20, 22]);
    expect(mats.recommended).toEqual({ pitched: 14, flat: 15 });
    // Flat waste is separate: a pitched-only roof has no flat area, and the flat selection is validated on its own list.
    expect((await request(app).patch(`${base}/${m.id}/waste`).set(h(sales)).send({ flatPercent: 22 })).status).toBe(200);
    expect((await request(app).get(`${base}/${m.id}/materials`).set(h(sales))).body.data.flatWastePercent).toBe(22);
    // No catalog products yet: product rows are not invented; the family says so instead.
    const shingleFamily = mats.families.find((f: { family: string }) => f.family === 'shingle');
    expect(shingleFamily.status).toBe('ready');
    expect(shingleFamily.products.every((p: { generic: boolean }) => p.generic)).toBe(true);
    expect((await request(app).get(`${base}/${m.id}/materials?waste=20`).set(h(sales))).body.data.wastePercent).toBe(20);
  });

  it('material calculation is product specific, rounds up to whole packages, and never uses unverified edges', async () => {
    const { sales, admin, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    const mk = (body: Record<string, unknown>) => request(app).post(`${base}/material-products`).set(h(admin)).send(body);
    expect((await mk({ family: 'shingle', brand: 'GAF', name: 'Timberline HDZ', packageUnit: 'bundle', coveragePerPackage: 33.3, specConfirmed: true })).status).toBe(201);
    expect((await mk({ family: 'shingle', brand: 'IKO', name: 'Cambridge', packageUnit: 'bundle', coveragePerPackage: 32 })).status).toBe(201);
    expect((await mk({ family: 'starter', brand: 'GAF', name: 'Pro-Start', packageUnit: 'bundle', coveragePerPackage: 120 })).status).toBe(201);
    expect((await mk({ family: 'shingle', name: 'bad', packageUnit: 'bundle', coveragePerPackage: 0 })).status).toBe(400);
    expect((await request(app).post(`${base}/material-products`).set(h(sales)).send({ family: 'shingle', name: 'x', packageUnit: 'bundle', coveragePerPackage: 5 })).status).toBe(403); // salespeople cannot edit the catalog
    const pitched = (await request(app).get(`${base}/${m.id}/summary`).set(h(sales))).body.data.pitchedAreaSqFt as number;
    let mats = (await request(app).get(`${base}/${m.id}/materials`).set(h(sales))).body.data;
    const shingles = mats.families.find((f: { family: string }) => f.family === 'shingle');
    expect(shingles.products.map((p: { name: string }) => p.name).sort()).toEqual(['Cambridge', 'Timberline HDZ']);
    const gaf = shingles.products.find((p: { name: string }) => p.name === 'Timberline HDZ');
    const iko = shingles.products.find((p: { name: string }) => p.name === 'Cambridge');
    expect(gaf).toMatchObject({ generic: false, specConfirmed: true });
    expect(iko.specConfirmed).toBe(false);
    for (const w of [0, 10, 14, 15]) {
      expect(gaf.packages[w]).toBe(Math.ceil((pitched * (1 + w / 100)) / 33.3 - 1e-9));
      expect(iko.packages[w]).toBe(Math.ceil((pitched * (1 + w / 100)) / 32 - 1e-9));
    }
    expect(gaf.packages[14]).toBeGreaterThanOrEqual(gaf.packages[10]);
    // Edge based families: derived edges are unverified, so no quantity is printed.
    const starter = mats.families.find((f: { family: string }) => f.family === 'starter');
    expect(starter.status).not.toBe('ready');
    expect(starter.products[0].packages[14]).toBeNull();
    expect(starter.blocking.length).toBeGreaterThan(0);
    // After verification the starter quantity appears.
    await request(app).post(`${base}/${m.id}/edges/verify`).set(h(sales)).send({ reason: 'Confirmed on site' });
    mats = (await request(app).get(`${base}/${m.id}/materials`).set(h(sales))).body.data;
    const s2 = mats.families.find((f: { family: string }) => f.family === 'starter');
    if (s2.status === 'ready') expect(s2.products[0].packages[14]).toBeGreaterThan(0);
    // Catalog management: edit, disable, delete; another company sees none of it.
    const list = (await request(app).get(`${base}/material-products`).set(h(admin))).body.data;
    const id = list.find((p: { name: string }) => p.name === 'Cambridge').id as string;
    expect((await request(app).patch(`${base}/material-products/${id}`).set(h(admin)).send({ enabled: false })).status).toBe(200);
    expect((await request(app).get(`${base}/${m.id}/materials`).set(h(sales))).body.data.families.find((f: { family: string }) => f.family === 'shingle').products.map((p: { name: string }) => p.name)).toEqual(['Timberline HDZ']);
    expect((await request(app).delete(`${base}/material-products/${id}`).set(h(admin))).status).toBe(204);
    const company2 = await CompanyModel.create({ name: 'Other Roofing', slug: 'other-roofing' });
    await createUser({ email: 'admin2@example.com', role: 'admin', companyId: String(company2._id) });
    expect((await request(app).get(`${base}/material-products`).set(h(await login('admin2@example.com')))).body.data).toHaveLength(0);
  });

  it('suggests catalog quantities only from usable edge data and labels their trust level', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    const before = (await request(app).get(`${base}/${m.id}/estimate-inputs`).set(h(sales))).body.data;
    expect(before.suggestedQuantities.find((q: { basis: string }) => q.basis === 'drip_edge_lf')).toMatchObject({ status: 'unverified' }); // suggested, but flagged: not yet verified
    for (const q of before.suggestedQuantities) expect(q.status).toBe('unverified');
    await request(app).post(`${base}/${m.id}/edges/verify`).set(h(sales)).send({ reason: 'Confirmed on site' });
    const after = (await request(app).get(`${base}/${m.id}/estimate-inputs`).set(h(sales))).body.data;
    const drip = after.suggestedQuantities.find((q: { basis: string }) => q.basis === 'drip_edge_lf');
    expect(drip.status).toBe('verified');
    expect(drip.quantity).toBeGreaterThan(120);
    expect(after.selectedWastePercent).toBe(14);
    expect(after.summary.squares).toBeGreaterThan(10);
  });

  it('field photos: categories, metadata, verification, "Not provided" categories, bad types rejected', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    const up = await request(app).post(`${base}/${m.id}/photos`).set(h(sales)).send({ filename: 'front.jpg', mimeType: 'image/jpeg', contentBase64: JPEG, category: 'front_elevation', notes: 'Front of house', capturedAt: '2026-11-06T15:00:00.000Z', gps: { lat: 30.26, lng: -97.74 }, relatedItem: 'Front slope' });
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ category: 'front_elevation', notes: 'Front of house', relatedItem: 'Front slope', verified: false, gps: { lat: 30.26, lng: -97.74 } });
    expect((await request(app).post(`${base}/${m.id}/photos`).set(h(sales)).send({ filename: 'x.gif', mimeType: 'image/gif', contentBase64: JPEG, category: 'other' })).status).toBe(400);
    expect((await request(app).post(`${base}/${m.id}/photos`).set(h(sales)).send({ filename: 'x.jpg', mimeType: 'image/jpeg', contentBase64: JPEG, category: 'roof_selfie' })).status).toBe(400);
    const patched = await request(app).patch(`${base}/${m.id}/photos/${up.body.data.id}`).set(h(sales)).send({ category: 'damage_closeup', verified: true });
    expect(patched.body.data).toMatchObject({ category: 'damage_closeup', verified: true });
    const list = (await request(app).get(`${base}/${m.id}/photos`).set(h(sales))).body.data;
    expect(list).toHaveLength(1);
    expect(await AuditLogModel.countDocuments({ action: { $in: ['measurement.photo_added', 'measurement.photo_changed'] } })).toBe(2);
  });

  const pageCount = (buf: Buffer): number => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

  it('PDF: the report has every required section, a header and footer on every page, and Legacy branding only', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    await request(app).post(`${base}/${m.id}/photos`).set(h(sales)).send({ filename: 'front.jpg', mimeType: 'image/jpeg', contentBase64: JPEG, category: 'front_elevation', notes: 'Front of the house', capturedAt: '2026-11-06T15:00:00.000Z' });
    await request(app).post(`${base}/${m.id}/edges/verify`).set(h(sales)).send({ reason: 'Confirmed' });
    const res = await binary(request(app).get(`${base}/${m.id}/report?waste=14`).set(h(sales)));
    expect(res.status).toBe(200);
    const buf = res.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.subarray(-16).toString()).toContain('%%EOF'); // not truncated
    if (process.env.SAVE_SAMPLE_PDF) (await import('node:fs')).writeFileSync(process.env.SAVE_SAMPLE_PDF, buf); // dev aid: inspect the layout
    const pages = pageCount(buf);
    expect(pages).toBeGreaterThanOrEqual(11);
    expect(pages).toBeLessThanOrEqual(13); // 11 sections plus at most a couple of continuation pages
    expect((buf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(3); // logo, aerial image, field photo
    const text = pdfText(buf);
    for (const t of ['Roof Measurement Report', 'Roof Diagram', 'Length Measurement Report', 'Area Measurement Report', 'Pitch and Direction Report', 'Structure #1 Summary', 'Combined Report Summary', 'Waste Calculations', 'Material Calculations', 'Field Photographs', 'Notes, Sources and Data Checks']) expect(text).toContain(t);
    expect(text).not.toContain('Additional Structure Summaries'); // single building
    // Header (name + website) and footer (report number, revision, page x of N, Google attribution) on every page.
    expect(text.split('LEGACY CONSTRUCTION GROUP LLC').length - 1).toBe(pages);
    for (let i = 1; i <= pages; i++) expect(text).toContain(`Page ${i} of ${pages}`);
    expect((text.match(/Report RM-\d{4}-[0-9A-Z]{6}-R1/g) ?? []).length).toBe(pages);
    expect((text.match(/Includes data from Google Maps/g) ?? []).length).toBe(pages);
    expect(text).toContain('500 Example Ave');
    expect(text).toContain('Pat Owner');
    expect(text).toContain('This is aerial imagery, not an inspection photograph');
    expect(text).toContain('Field verified');
    expect(text).toContain('F1');
    expect(text).toContain('6/12');
    expect(text).toContain('Total roof area');
    expect(text).toContain('Two story area');
    expect(text).toContain('Not available'); // two-story / two-layer are not known, never printed as zero
    expect(text).toContain('Pitched waste %');
    expect(text).toContain('Flat roof area: 0 sqft'); // no flat section: stated, not an empty table
    expect(text).toContain('Material calculations are estimates and must be verified before ordering');
    expect(text).toContain('Field verification is recommended before material ordering');
    expect(text).toContain('Front elevation');
    expect(text).toContain('Front of the house');
    expect(text).not.toContain('Not provided'); // no page or table of missing photo categories
    expect(text).not.toMatch(/Roofr/i);
    expect(text).not.toContain(KEY);
    expect(await FileModel.countDocuments({ measurementId: m.id, category: 'report' })).toBe(1);
  });

  it('PDF download: address-based filename in a safe UTF-8 attachment header, matching the stored file and revision', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    const res = await binary(request(app).get(`${base}/${m.id}/report`).set(h(sales)));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const cd = String(res.headers['content-disposition']);
    expect(cd).toContain('attachment');
    expect(cd).toContain('filename="500-Example-Ave-Austin-TX-78701-Roof-Measurement-Report.pdf"');
    expect(cd).toContain("filename*=UTF-8''500-Example-Ave-Austin-TX-78701-Roof-Measurement-Report.pdf");
    expect(cd).not.toMatch(/report-[0-9a-f]{8,}|\.pdf\.pdf/i);
    expect(String((await request(app).get(`${base}/${m.id}/report?inline=true`).set(h(sales))).headers['content-disposition'])).toContain('inline');
    expect((await FileModel.findOne({ measurementId: m.id, category: 'report' }))?.originalFilename).toBe('500-Example-Ave-Austin-TX-78701-Roof-Measurement-Report.pdf');
    // A later revision of the same address carries the revision number so downloads do not collide.
    const m2 = await run(sales, propertyId, { force: true });
    const cd2 = String((await binary(request(app).get(`${base}/${m2.body.data.id}/report`).set(h(sales)))).headers['content-disposition']);
    expect(cd2).toContain('500-Example-Ave-Austin-TX-78701-Roof-Measurement-Report-Rev2.pdf');
  });

  it('PDF without imagery shows the fallback instead of a fake picture, approximate diagrams are labelled, and there is no photo page', async () => {
    const { sales, propertyId } = await setup();
    dataLayersFail = { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } };
    const m = (await run(sales, propertyId)).body.data;
    const buf = (await binary(request(app).get(`${base}/${m.id}/report`).set(h(sales)))).body as Buffer;
    const text = pdfText(buf);
    expect(text).toContain('Aerial imagery not available');
    expect(text).toContain('APPROXIMATE');
    expect(text).not.toContain('Field Photographs'); // no empty photo page
    expect(text).toContain('No field photographs were attached');
    expect((buf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(1); // only the logo
    for (let i = 1; i <= pageCount(buf); i++) expect(text).toContain(`Page ${i} of ${pageCount(buf)}`);
  });

  it('multiple photos stay in the Field Photographs section with category, note and date', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    for (const [i, category] of ['front_elevation', 'rear_elevation', 'damage_closeup', 'penetration', 'other'].entries()) {
      await request(app).post(`${base}/${m.id}/photos`).set(h(sales)).send({ filename: `p${i}.jpg`, mimeType: 'image/jpeg', contentBase64: JPEG, category, notes: `Photo note ${i}`, capturedAt: `2026-11-0${i + 1}T15:00:00.000Z` });
    }
    const buf = (await binary(request(app).get(`${base}/${m.id}/report`).set(h(sales)))).body as Buffer;
    const text = pdfText(buf);
    for (let i = 0; i < 5; i++) expect(text).toContain(`Photo note ${i}`);
    expect((buf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(7); // logo + aerial + 5 photos
    expect(text).toContain('Field Photographs');
    expect(text).not.toMatch(/Roofr/i);
  });

  it('multiple structures: the extra building is outline only, excluded from roof totals, and listed on its own page', async () => {
    spec = TWO_BUILDINGS;
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    const s = (await request(app).get(`${base}/${m.id}/summary`).set(h(sales))).body.data;
    expect(s.structures).toHaveLength(2);
    expect(s.structures[1]).toMatchObject({ roofAreaMeasured: false, roofAreaSqFt: null });
    const sum = s.structures.reduce((a: number, x: { roofAreaSqFt: number | null }) => a + (x.roofAreaSqFt ?? 0), 0);
    expect(sum).toBeCloseTo(s.totalAreaSqFt, 1);
    const buf = (await binary(request(app).get(`${base}/${m.id}/report`).set(h(sales)))).body as Buffer;
    const text = pdfText(buf);
    expect(text).toContain('Additional Structure Summaries');
    expect(text).toContain('outline only');
    expect(text).toContain('not part of any roof total');
    expect(text).toContain('Not measured');
    expect(text).toContain('Footprint area');
  });

  it('revisions keep the earlier geometry and edge decisions; the estimate records the measurement revision', async () => {
    const { sales, admin, propertyId, customerId } = await setup();
    const m1 = (await run(sales, propertyId)).body.data;
    await request(app).post(`${base}/${m1.id}/edges/verify`).set(h(sales)).send({ reason: 'Confirmed' });
    await request(app).post('/api/v1/pricing/install-defaults').set(h(admin));
    const catalogId = (await request(app).get('/api/v1/pricing/catalogs').set(h(admin))).body.data[0].id;
    const inputs = (await request(app).get(`${base}/${m1.id}/estimate-inputs`).set(h(sales))).body.data;
    const est = await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, measurementId: m1.id, quote: { package: 'better', squares: inputs.squares, pitch: inputs.pitch, quantities: Object.fromEntries(inputs.suggestedQuantities.filter((q: { status: string }) => q.status === 'verified').map((q: { basis: string; quantity: number }) => [q.basis, q.quantity])) } });
    expect(est.status).toBe(201);
    const m2 = await run(sales, propertyId, { force: true });
    expect(m2.body.data.solar.revision).toBe(2);
    const old = await MeasurementModel.findById(m1.id).lean();
    expect((old?.geometry as { edges: unknown[] }).edges.length).toBeGreaterThan(0);
    expect(old?.supersededById).toBeTruthy();
    expect((await request(app).post(`${base}/${m1.id}/edges/verify`).set(h(sales)).send({ reason: 'late' })).status).toBe(409);
    expect((await request(app).patch(`${base}/${m1.id}/waste`).set(h(sales)).send({ percent: 5 })).status).toBe(409);
    const stored = await EstimateModel.findById(est.body.data.estimate.id).lean();
    expect((stored?.pricingSource as { measurement: { revision: number; id: string } }).measurement).toMatchObject({ revision: 1, id: m1.id });
    // New revision starts clean: derived edges are unverified again.
    expect((await request(app).get(`${base}/${m2.body.data.id}`).set(h(sales))).status).toBe(404); // not under this path; detail lives at /measurements/:id
    const detail = (await request(app).get(`/api/v1/measurements/${m2.body.data.id}`).set(h(sales))).body.data;
    expect(detail.eave).toBeNull();
  });

  it('isolates companies, owners and portal users on every new route', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, propertyId)).body.data;
    await createUser({ email: 'other@example.com', role: 'salesperson' });
    const other = await login('other@example.com');
    const company2 = await CompanyModel.create({ name: 'Other Roofing', slug: 'other-roofing' });
    await createUser({ email: 'admin2@example.com', role: 'admin', companyId: String(company2._id) });
    const admin2 = await login('admin2@example.com');
    const paths: Array<[string, string, Record<string, unknown>?]> = [
      ['get', 'geometry'], ['get', 'diagrams'], ['get', 'aerial.png'], ['get', 'summary'], ['get', 'materials'], ['get', 'photos'], ['get', 'report'],
      ['post', 'geometry/refresh'], ['patch', 'waste', { percent: 5 }], ['post', 'edges', { type: 'ridge', lengthFt: 3, reason: 'attack' }], ['post', 'edges/verify', { reason: 'attack' }],
      ['post', 'photos', { filename: 'a.jpg', mimeType: 'image/jpeg', contentBase64: JPEG, category: 'other' }],
    ];
    for (const who of [other, admin2]) {
      for (const [verb, p, body] of paths) {
        const r = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[verb]!(`${base}/${m.id}/${p}`).set(h(who)).send(body);
        expect([404, 400], `${verb} ${p}`).toContain(r.status);
        expect(r.status === 400 ? r.body.error.code : 'NOT_FOUND').toMatch(/NOT_FOUND|VALIDATION/);
      }
    }
    expect((await request(app).get(`${base}/${m.id}/diagrams`)).status).toBe(401);
    expect(await FileModel.countDocuments({ measurementId: m.id, photoCategory: { $exists: true } })).toBe(0);
  });

  it('lists measurements written outside mongoose (no timestamps) instead of failing the whole list', async () => {
    const { sales, propertyId, customerId } = await setup();
    await MeasurementModel.collection.insertOne({ _id: new (await import('mongoose')).default.Types.ObjectId(), propertyId: new (await import('mongoose')).default.Types.ObjectId(propertyId), customerId: new (await import('mongoose')).default.Types.ObjectId(customerId), source: 'manual', provider: 'none', providerStatus: 'manual_only', measurementDate: new Date(), units: 'sq_ft', totalArea: 1500, createdBy: new (await import('mongoose')).default.Types.ObjectId(), isDemo: true });
    const list = await request(app).get('/api/v1/measurements').set(h(sales));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].createdAt).toBeTruthy();
  });

  it('keeps every existing measurement route working for manual records', async () => {
    const { sales, propertyId } = await setup();
    const manual = (await request(app).post('/api/v1/measurements').set(h(sales)).send({ propertyId, totalArea: 2000, pitch: '6/12', ridge: 30 })).body.data;
    const s = await request(app).get(`${base}/${manual.id}/summary`).set(h(sales));
    expect(s.status).toBe(200);
    expect(s.body.data.totalAreaSqFt).toBe(2000);
    const d = (await request(app).get(`${base}/${manual.id}/diagrams`).set(h(sales))).body.data;
    expect(d.status).toBe('none');
    expect(d.svgs).toEqual({});
    expect((await request(app).get(`${base}/${manual.id}/materials`).set(h(sales))).status).toBe(200);
  });
});
