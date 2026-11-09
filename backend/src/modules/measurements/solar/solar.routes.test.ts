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
import { MeasurementModel } from '../measurement.model.js';
import { buildingInsightsFixture, geocodeFixture } from './fixtures.js';
import { GoogleSolarAdapter } from './google-solar.adapter.js';
import { SolarRequestModel } from './solar.model.js';
import { setSolarAdapterForTests } from './solar.service.js';

type Handler = (url: URL) => Response | Promise<Response>;
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Google Solar measurement workflow (deterministic mock responses; never live Google)', () => {
  let app: ReturnType<typeof createApp>;
  let calls: URL[] = [];
  let handler: Handler;
  const KEY = 'TEST-KEY-should-never-leak';

  beforeAll(async () => { await startTestDb(); app = createApp(); }, 120_000);
  afterAll(async () => { setSolarAdapterForTests(null); await stopTestDb(); });
  beforeEach(async () => {
    await clearCollections();
    await seedPhase2Config();
    calls = [];
    handler = (url) => (url.pathname.includes('geocode') ? json(200, geocodeFixture()) : json(200, buildingInsightsFixture()));
    setSolarAdapterForTests(new GoogleSolarAdapter({ apiKey: KEY, fetchImpl: async (u) => { const url = new URL(String(u)); calls.push(url); return handler(url); } }));
  });
  afterEach(() => setSolarAdapterForTests(null));

  const login = async (email: string): Promise<string> => (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const bi = () => calls.filter((u) => u.pathname.includes('buildingInsights'));

  async function setup(withCoords = true) {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const otherSalesId = await createUser({ email: 'other@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');
    const other = await login('other@example.com');
    const customer = await CustomerModel.create({ type: 'individual', firstName: 'Pat', lastName: 'Owner', ownerId: salesId });
    const property = await PropertyModel.create({ customerId: customer._id, address: { line1: '500 Example Ave', city: 'Austin', state: 'TX', zip: '78701' }, ...(withCoords ? { location: { lat: 30.2672, lng: -97.7431 } } : {}) });
    return { admin, sales, other, otherSalesId, salesId, customerId: String(customer._id), propertyId: String(property._id) };
  }
  const run = (token: string, body: Record<string, unknown>) => request(app).post('/api/v1/measurements/solar/run').set(h(token)).send(body);

  it('imports roof data from Google Solar into a measurement with provenance, and never invents edge lengths', async () => {
    const { sales, propertyId } = await setup();
    const res = await run(sales, { propertyId });
    expect(res.status).toBe(201);
    const m = res.body.data;
    expect(m).toMatchObject({ source: 'google_solar', provider: 'google_solar', providerStatus: 'connected', units: 'sq_ft', facets: 4, pitch: '6/12' });
    expect(m.totalArea).toBeCloseTo(1805.1, 0);
    expect(m.ridge).toBeNull(); // Google Solar gives no edge lengths
    expect(m.hip).toBeNull();
    expect(m.solar.fieldSources).toMatchObject({ totalArea: 'google', facets: 'google', pitch: 'calculated' });
    expect(m.solar.automated).toMatchObject({ provider: 'google_solar', imagery: { quality: 'HIGH', date: '2024-03-18' }, segmentCount: 4 });
    expect(m.solar.automated.segments[0].polygon).toBeNull();
    expect(m.solar.edges.every((e: { lengthFt: number | null; verification: string }) => e.lengthFt === null && e.verification === 'manual_required')).toBe(true);
    expect(bi()).toHaveLength(1);
    expect(bi()[0]?.searchParams.get('requiredQuality')).toBe('HIGH');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(await SolarRequestModel.countDocuments({ kind: 'building_insights', status: 'ok' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'measurement.google_solar_imported' })).toBe(1);
  });

  it('prevents duplicate paid requests: repeat runs reuse the result and concurrent runs share one request', async () => {
    const { sales, propertyId } = await setup();
    const [a, b] = await Promise.all([run(sales, { propertyId }), run(sales, { propertyId })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    const again = await run(sales, { propertyId });
    expect(again.status).toBe(200);
    expect(again.body.meta.cached).toBe(true);
    expect(bi()).toHaveLength(1);
    expect(await MeasurementModel.countDocuments({ provider: 'google_solar' })).toBe(1);
  });

  it('a forced re-run creates revision 2 and keeps revision 1 untouched', async () => {
    const { sales, propertyId } = await setup();
    const first = (await run(sales, { propertyId })).body.data;
    await request(app).patch(`/api/v1/measurements/solar/${first.id}/corrections`).set(h(sales)).send({ changes: { ridge: 40 }, reason: 'Measured on site' });
    const second = await run(sales, { propertyId, force: true });
    expect(second.status).toBe(201);
    expect(second.body.data.solar.revision).toBe(2);
    expect(second.body.data.solar.supersedesId).toBe(first.id);
    const old = (await request(app).get(`/api/v1/measurements/${first.id}`).set(h(sales))).body.data;
    expect(old.solar.supersededById).toBe(second.body.data.id);
    expect(old.ridge).toBe(40); // history preserved exactly
    expect(bi()).toHaveLength(2);
    const edit = await request(app).patch(`/api/v1/measurements/solar/${first.id}/corrections`).set(h(sales)).send({ changes: { ridge: 50 }, reason: 'late edit' });
    expect(edit.status).toBe(409);
  });

  it('falls back from HIGH to BASE only when Google has no imagery at HIGH, and saves nothing when there is none at all', async () => {
    const { sales, propertyId } = await setup();
    handler = (url) => (url.searchParams.get('requiredQuality') === 'HIGH' ? json(404, { error: { status: 'NOT_FOUND' } }) : json(200, buildingInsightsFixture({ imageryQuality: 'BASE' })));
    const ok = await run(sales, { propertyId });
    expect(ok.status).toBe(201);
    expect(ok.body.data.solar.automated.imagery.quality).toBe('BASE');
    expect(bi().map((u) => u.searchParams.get('requiredQuality'))).toEqual(['HIGH', 'BASE']);

    await MeasurementModel.deleteMany({});
    await SolarRequestModel.deleteMany({});
    handler = () => json(404, { error: { status: 'NOT_FOUND' } });
    const none = await run(sales, { propertyId });
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe('SOLAR_NOT_FOUND');
    expect(await MeasurementModel.countDocuments({})).toBe(0);
    expect(await SolarRequestModel.countDocuments({ status: 'not_found' })).toBe(2);
  });

  it.each([
    [403, { error: { status: 'PERMISSION_DENIED', message: 'The billing account for the owning project is disabled in state closed' } }, 502, 'SOLAR_BILLING_DISABLED'],
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, 429, 'SOLAR_QUOTA_EXCEEDED'],
    [400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid' } }, 502, 'SOLAR_AUTH_FAILED'],
  ])('maps Google failure %i to %i %s without leaking provider text', async (g, body, http, code) => {
    const { sales, propertyId } = await setup();
    handler = () => json(g, body);
    const res = await run(sales, { propertyId });
    expect(res.status).toBe(http);
    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toMatch(/billing account for the owning|API key not valid|TEST-KEY/);
    expect(await MeasurementModel.countDocuments({})).toBe(0);
  });

  it('is honest when Google is not configured on the server', async () => {
    const { sales, admin, propertyId } = await setup();
    setSolarAdapterForTests(null);
    const res = await run(sales, { propertyId });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SOLAR_NOT_CONFIGURED');
    expect((await request(app).get('/api/v1/measurements/solar/status').set(h(admin))).body.data.state).toBe('not_configured');
  });

  it('enforces the daily limit and shows usage to administrators only; the key is never returned', async () => {
    const { sales, admin, propertyId } = await setup();
    expect((await request(app).get('/api/v1/measurements/solar/usage').set(h(sales))).status).toBe(403);
    expect((await request(app).put('/api/v1/measurements/solar/settings').set(h(sales)).send({ enabled: false })).status).toBe(403);
    const set = await request(app).put('/api/v1/measurements/solar/settings').set(h(admin)).send({ dailyLimit: { building_insights: 1 }, pricePer1000Cents: { building_insights: 500 } });
    expect(set.status).toBe(200);
    expect((await run(sales, { propertyId })).status).toBe(201);
    const blocked = await run(sales, { propertyId, force: true });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('SOLAR_LIMIT_REACHED');
    expect(bi()).toHaveLength(1); // the blocked request never reached Google
    const usage = (await request(app).get('/api/v1/measurements/solar/usage').set(h(admin))).body.data;
    const row = usage.rows.find((r: { kind: string }) => r.kind === 'building_insights');
    expect(row).toMatchObject({ month: 1, day: 1, dailyLimit: 1, monthlyFree: 10000, blocked: true, overFree: 0, estimatedOverageCents: 0 });
    const settings = JSON.stringify((await request(app).get('/api/v1/measurements/solar/settings').set(h(admin))).body);
    expect(settings).not.toContain(KEY);
    expect(JSON.parse(settings).data.integration.keyConfigured).toBe(true);
  });

  it('blocks when the monthly free allowance is used up unless an administrator allows overage', async () => {
    const { sales, admin, propertyId } = await setup();
    await request(app).put('/api/v1/measurements/solar/settings').set(h(admin)).send({ monthlyFree: { building_insights: 1 }, warnPercent: 50 });
    expect((await run(sales, { propertyId })).status).toBe(201);
    expect((await run(sales, { propertyId, force: true })).body.error.code).toBe('SOLAR_LIMIT_REACHED');
    const u = (await request(app).get('/api/v1/measurements/solar/usage').set(h(admin))).body.data.rows.find((r: { kind: string }) => r.kind === 'building_insights');
    expect(u.warning).toBe(true);
    await request(app).put('/api/v1/measurements/solar/settings').set(h(admin)).send({ allowOverage: true });
    expect((await run(sales, { propertyId, force: true })).status).toBe(201);
  });

  it('connection test makes a request and only then reports connected', async () => {
    const { admin } = await setup();
    expect((await request(app).get('/api/v1/measurements/solar/status').set(h(admin))).body.data.state).toBe('configuration_required');
    handler = () => json(403, { error: { status: 'PERMISSION_DENIED', message: 'Solar API has not been used in project 9 before or it is disabled' } });
    const bad = await request(app).post('/api/v1/measurements/solar/test-connection').set(h(admin));
    expect(bad.body.data).toMatchObject({ ok: false, code: 'API_DISABLED' });
    expect((await request(app).get('/api/v1/measurements/solar/status').set(h(admin))).body.data.state).toBe('connection_failed');
    handler = () => json(200, buildingInsightsFixture());
    const good = await request(app).post('/api/v1/measurements/solar/test-connection').set(h(admin));
    expect(good.body.data.ok).toBe(true);
    expect((await request(app).get('/api/v1/measurements/solar/status').set(h(admin))).body.data.state).toBe('connected');
  });

  describe('connection test and status', () => {
    const test = (t: string) => request(app).post('/api/v1/measurements/solar/test-connection').set(h(t));
    const status = async (t: string) => (await request(app).get('/api/v1/measurements/solar/status').set(h(t))).body.data;
    const hubStatus = async (t: string) => ((await request(app).get('/api/v1/integrations/status').set(h(t))).body.data as Array<{ key: string; status: string; message: string }>).find((i) => i.key === 'google_solar')!;

    it('calls the documented endpoint at the sample location, sends the key as a query parameter, and saves no measurement', async () => {
      const { admin } = await setup();
      const res = await test(admin);
      expect(res.body.data).toMatchObject({ ok: true, code: 'OK', httpStatus: 200 });
      expect(res.body.data.message).toMatch(/segments/);
      expect(bi()).toHaveLength(1);
      const u = bi()[0]!;
      expect(u.origin + u.pathname).toBe('https://solar.googleapis.com/v1/buildingInsights:findClosest');
      expect(u.searchParams.get('location.latitude')).toBe('37.445000');
      expect(u.searchParams.get('location.longitude')).toBe('-122.139000');
      expect(u.searchParams.get('requiredQuality')).toBe('BASE');
      expect(u.searchParams.get('key')).toBe(KEY);
      expect(await MeasurementModel.countDocuments({})).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain(KEY);
    });

    it('reports a missing key as not configured and never as connected', async () => {
      const { admin } = await setup();
      setSolarAdapterForTests(null);
      expect((await status(admin)).state).toBe('not_configured');
      const res = await test(admin);
      expect(res.body.data).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
      expect(res.body.data.fix).toMatch(/GOOGLE_SOLAR_API_KEY/);
      expect((await hubStatus(admin)).status).toBe('not_configured');
    });

    it('a 200 with a malformed body is a failure, not a connection', async () => {
      const { admin } = await setup();
      handler = () => json(200, { name: 'buildings/x' });
      const res = await test(admin);
      expect(res.body.data).toMatchObject({ ok: false, code: 'BAD_RESPONSE', httpStatus: 200 });
      expect((await status(admin)).state).toBe('connection_failed');
      handler = () => json(200, { solarPotential: { roofSegmentStats: [] }, imageryQuality: 'HIGH' });
      expect((await test(admin)).body.data.ok).toBe(false);
    });

    it.each([
      [403, { error: { status: 'PERMISSION_DENIED', message: 'Solar API has not been used in project 123 before or it is disabled.' } }, 'API_DISABLED', 'connection_failed', /Library.*Solar API/],
      [403, { error: { status: 'PERMISSION_DENIED', message: 'This API method requires billing to be enabled.' } }, 'BILLING_DISABLED', 'connection_failed', /billing account/i],
      [403, { error: { status: 'PERMISSION_DENIED', message: 'Requests from this IP address are blocked.' } }, 'KEY_RESTRICTED', 'connection_failed', /Application restrictions/],
      [400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }, 'AUTH_FAILED', 'connection_failed', /Credentials/],
      [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'QUOTA_EXCEEDED', 'quota_exceeded', /Quotas/],
      [500, {}, 'BAD_RESPONSE', 'connection_failed', /Retry/],
    ])('HTTP %i becomes %s with a fix instruction, and the state is %s', async (g, body, code, state, fix) => {
      const { admin } = await setup();
      handler = () => json(g, body);
      const res = await test(admin);
      expect(res.body.data).toMatchObject({ ok: false, code, httpStatus: g });
      expect(res.body.data.fix).toMatch(fix);
      expect((await status(admin)).state).toBe(state);
      expect(JSON.stringify(res.body)).not.toMatch(/TEST-KEY|has not been used in project|requires billing to be enabled/);
    });

    it('a timeout and a network failure are reported without exposing the request URL', async () => {
      const { admin } = await setup();
      setSolarAdapterForTests(new GoogleSolarAdapter({ apiKey: KEY, timeoutMs: 20, fetchImpl: (_u, init) => new Promise((_r, rej) => { init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))); }) }));
      expect((await test(admin)).body.data).toMatchObject({ ok: false, code: 'TIMEOUT' });
      setSolarAdapterForTests(new GoogleSolarAdapter({ apiKey: KEY, fetchImpl: async () => { throw new TypeError(`fetch failed https://solar.googleapis.com/?key=${KEY}`); } }));
      const net = await test(admin);
      expect(net.body.data).toMatchObject({ ok: false, code: 'NETWORK' });
      expect(JSON.stringify(net.body)).not.toContain(KEY);
    });

    it('goes connected only after a successful test, and a later failure replaces the old Connected state', async () => {
      const { admin } = await setup();
      expect((await status(admin)).state).toBe('configuration_required');
      expect((await hubStatus(admin)).status).toBe('configuration_required');
      await test(admin);
      expect((await status(admin)).state).toBe('connected');
      const hub = await hubStatus(admin);
      expect(hub.status).toBe('connected');
      expect(hub.message).toMatch(/^Connected/);
      handler = () => json(403, { error: { status: 'PERMISSION_DENIED', message: 'billing disabled' } });
      await test(admin);
      expect((await status(admin)).state).toBe('connection_failed');
      expect((await hubStatus(admin)).status).toBe('error');
    });

    it('replacing the key invalidates the previous verification until a new test succeeds', async () => {
      const { admin } = await setup();
      await test(admin);
      expect((await status(admin)).state).toBe('connected');
      setSolarAdapterForTests(new GoogleSolarAdapter({ apiKey: 'A-DIFFERENT-KEY-1234', fetchImpl: async (u) => { calls.push(new URL(String(u))); return json(200, buildingInsightsFixture()); } }));
      const after = await status(admin);
      expect(after.state).toBe('configuration_required');
      expect(after.stale).toBe(true);
      expect(after.lastTest).toBeNull();
      expect((await hubStatus(admin)).message).toMatch(/changed since the last test/);
      await test(admin);
      expect((await status(admin)).state).toBe('connected');
    });

    it('only administrators can run the test or read the integration hub', async () => {
      const { sales } = await setup();
      expect((await test(sales)).status).toBe(403);
      expect((await request(app).get('/api/v1/integrations/status').set(h(sales))).status).toBe(403);
    });
  });

  it('geocodes a property with no coordinates, asks for confirmation when only approximate, and never duplicates properties', async () => {
    const { sales, propertyId, customerId } = await setup(false);
    handler = (url) => (url.pathname.includes('geocode') ? json(200, geocodeFixture(false)) : json(200, buildingInsightsFixture()));
    const approx = await run(sales, { propertyId });
    expect(approx.status).toBe(422);
    expect(approx.body.error.code).toBe('SOLAR_ADDRESS_NOT_PRECISE');
    expect(bi()).toHaveLength(0);
    const confirmed = await run(sales, { propertyId, confirmApproximate: true });
    expect(confirmed.status).toBe(201);
    expect((await PropertyModel.findById(propertyId))?.location?.lat).toBeCloseTo(30.2672, 3);

    // Same address entered again for the customer reuses the existing property.
    const prop2 = await run(sales, { customerId, address: { line1: '500 Example Ave', city: 'Austin', state: 'TX', zip: '78701' } });
    expect(prop2.status).toBe(200);
    expect(await PropertyModel.countDocuments({ customerId })).toBe(1);
    const fresh = await run(sales, { customerId, address: { line1: '12 New Street', city: 'Austin', state: 'TX', zip: '78702' }, latitude: 30.27, longitude: -97.74 });
    expect(fresh.status).toBe(201);
    expect(await PropertyModel.countDocuments({ customerId })).toBe(2);
  });

  it('address search combines CRM properties with a geocode only when asked, and marks imprecise results', async () => {
    const { sales } = await setup();
    const crm = await request(app).get('/api/v1/measurements/solar/address-search?q=500%20Example').set(h(sales));
    expect(crm.body.data.crm).toHaveLength(1);
    expect(crm.body.data.geocoded).toEqual([]);
    expect(calls).toHaveLength(0); // no paid request without an explicit geocode
    const geo = await request(app).get('/api/v1/measurements/solar/address-search?q=500%20Example%20Ave%20Austin&geocode=true').set(h(sales));
    expect(geo.body.data.geocoded[0]).toMatchObject({ line1: '500 Example Ave', zip: '78701', precise: true });
    expect(await SolarRequestModel.countDocuments({ kind: 'geocode' })).toBe(1);
  });

  it('manual corrections keep the original provider data and record who changed what, when and why', async () => {
    const { sales, propertyId, salesId } = await setup();
    const m = (await run(sales, { propertyId })).body.data;
    const url = `/api/v1/measurements/solar/${m.id}/corrections`;
    expect((await request(app).patch(url).set(h(sales)).send({ changes: { ridge: 42.5 } })).status).toBe(400); // reason required
    expect((await request(app).patch(url).set(h(sales)).send({ changes: { pitch: 'steep' }, reason: 'typo' })).status).toBe(422);
    const res = await request(app).patch(url).set(h(sales)).send({ changes: { ridge: 42.5, hip: 61, pipeBoots: 4, vents: 3, skylights: 1, chimneys: 1, roofLayers: 2, extraTearOff: '1 extra layer under north slope', totalArea: 1850 }, verify: { ridge: true }, reason: 'Field measured with tape' });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({ ridge: 42.5, hip: 61, totalArea: 1850 });
    expect(d.solar.counts).toMatchObject({ pipeBoots: 4, vents: 3, skylights: 1, chimneys: 1, roofLayers: 2 });
    expect(d.solar.fieldSources).toMatchObject({ ridge: 'manual', totalArea: 'manual', facets: 'google' });
    expect(d.solar.verified).toEqual({ ridge: true });
    expect(d.solar.automated.areaSqFt).toBeCloseTo(1805.1, 0); // the Google-derived value is never overwritten
    const log = d.solar.corrections.find((c: { field: string }) => c.field === 'totalArea');
    expect(log).toMatchObject({ original: m.totalArea, updated: 1850, userId: String(salesId), reason: 'Field measured with tape' });
    expect(log.at).toBeTruthy();
    expect(d.solar.edges.find((e: { type: string }) => e.type === 'ridge')).toMatchObject({ lengthFt: 42.5, source: 'manual', verification: 'verified' });
    expect(await AuditLogModel.countDocuments({ action: 'measurement.corrected' })).toBe(1);
    // Changing a verified value drops its verified flag.
    const again = (await request(app).patch(url).set(h(sales)).send({ changes: { ridge: 44 }, reason: 'Re-measured' })).body.data;
    expect(again.solar.verified.ridge).toBeUndefined();
  });

  it('feeds the estimate: base squares (no second waste), unknown quantities flagged, and the estimate records the measurement revision', async () => {
    const { sales, admin, propertyId, customerId } = await setup();
    const m = (await run(sales, { propertyId })).body.data;
    const inputs = (await request(app).get(`/api/v1/measurements/solar/${m.id}/estimate-inputs`).set(h(sales))).body.data;
    expect(inputs.squares).toBeCloseTo(18.05, 1);
    expect(inputs.pitch).toBe('6/12');
    expect(inputs.wasteNote).toMatch(/already include waste/);
    expect(inputs.wasteTable.map((r: { percent: number }) => r.percent)).toEqual([0, 5, 10, 12, 14, 15, 17, 20]);
    expect(inputs.missing.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['stories', 'extraLayers', 'decking', 'permit', 'ridge', 'hip', 'valley', 'eave', 'rake']));
    expect(inputs.warnings.join(' ')).toMatch(/field verification/i);

    await request(app).post('/api/v1/pricing/install-defaults').set(h(admin));
    const catalogId = (await request(app).get('/api/v1/pricing/catalogs').set(h(admin))).body.data[0].id;
    const est = await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, measurementId: m.id, quote: { package: 'better', squares: inputs.squares, pitch: inputs.pitch } });
    expect(est.status).toBe(201);
    const stored = await EstimateModel.findById(est.body.data.estimate.id).lean();
    expect(String(stored?.measurementId)).toBe(m.id);
    expect((stored?.pricingSource as { measurement?: Record<string, unknown> }).measurement).toMatchObject({ id: m.id, revision: 1, source: 'google_solar', areaSource: 'google', verified: false });
    // Re-measuring later does not change the estimate that was already issued.
    await run(sales, { propertyId, force: true });
    const after = await EstimateModel.findById(est.body.data.estimate.id).lean();
    expect((after?.pricingSource as { measurement: { revision: number } }).measurement.revision).toBe(1);
  });

  it('generates a branded PDF report with sources, missing data, the disclaimer and Google attribution, and stores it', async () => {
    const { sales, propertyId } = await setup();
    const m = (await run(sales, { propertyId })).body.data;
    await request(app).patch(`/api/v1/measurements/solar/${m.id}/corrections`).set(h(sales)).send({ changes: { ridge: 42.5 }, verify: { ridge: true }, reason: 'Field measured' });
    const pdf = await request(app).get(`/api/v1/measurements/solar/${m.id}/report?waste=12`).set(h(sales)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const buf = pdf.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = buf.toString('latin1').match(/<([0-9a-fA-F]{2,})>/g)!.map((t) => Buffer.from(t.slice(1, -1), 'hex').toString('latin1')).join('');
    expect(text).toContain('Roof Measurement Report');
    expect(String(pdf.headers['content-disposition'])).toContain('500-Example-Ave-Austin-TX-78701-Roof-Measurement-Report.pdf');
    expect(text).toContain('500 Example Ave');
    expect(text).toContain('Pat Owner');
    expect(text).toContain('Google Solar');
    expect(text).toContain('Field verified');
    expect(text).toContain('Field verification is recommended');
    expect(text).toContain('Google');
    expect(text).toContain('No field photographs were attached');
    const saved = (await request(app).get(`/api/v1/measurements/${m.id}`).set(h(sales))).body.data;
    expect(saved.solar.reportFileId).toBeTruthy();
  });

  it('isolates companies and salespeople: nobody can read, run, correct or print another company or owner\'s records', async () => {
    const { sales, other, propertyId } = await setup();
    const m = (await run(sales, { propertyId })).body.data;
    // Another salesperson (same company) does not own the customer.
    expect((await run(other, { propertyId })).status).toBe(400);
    expect((await request(app).get(`/api/v1/measurements/${m.id}`).set(h(other))).status).toBe(404);
    expect((await request(app).get(`/api/v1/measurements/solar/${m.id}/report`).set(h(other))).status).toBe(404);
    // An admin of a different company.
    const company2 = await CompanyModel.create({ name: 'Other Roofing', slug: 'other-roofing' });
    await createUser({ email: 'admin2@example.com', role: 'admin', companyId: String(company2._id) });
    const admin2 = await login('admin2@example.com');
    expect((await request(app).get(`/api/v1/measurements/solar/${m.id}/estimate-inputs`).set(h(admin2))).status).toBe(404);
    expect((await request(app).patch(`/api/v1/measurements/solar/${m.id}/corrections`).set(h(admin2)).send({ changes: { ridge: 1 }, reason: 'attack' })).status).toBe(404);
    expect((await run(admin2, { propertyId })).status).toBe(404);
    expect((await request(app).get(`/api/v1/measurements/solar/property/${propertyId}/history`).set(h(admin2))).status).toBe(404);
    expect((await request(app).get('/api/v1/measurements/solar/usage').set(h(admin2))).body.data.rows.every((r: { month: number }) => r.month === 0)).toBe(true);
    expect((await request(app).post('/api/v1/measurements/solar/run').send({ propertyId })).status).toBe(401);
  });

  it('keeps manual measurements working exactly as before', async () => {
    const { sales, propertyId } = await setup();
    const manual = await request(app).post('/api/v1/measurements').set(h(sales)).send({ propertyId, totalArea: 2000, pitch: '6/12', ridge: 30 });
    expect(manual.status).toBe(201);
    expect(manual.body.data).toMatchObject({ source: 'manual', provider: 'none', providerStatus: 'manual_only', solar: null });
    const hist = (await request(app).get(`/api/v1/measurements/solar/property/${propertyId}/history`).set(h(sales))).body.data;
    expect(hist).toHaveLength(1);
  });
});
