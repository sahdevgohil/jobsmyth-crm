import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { ActivityModel } from '../activities/activity.model.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { CompanyModel } from '../companies/company.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { NotificationModel } from '../notifications/notification.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { LeadModel } from '../leads/lead.model.js';
import { PipelineStageModel } from '../settings/pipeline-stage.model.js';
import { evaluateEvents, evaluateRecent } from './storm.alerts.js';
import { StormAlertModel, StormEventModel, StormFollowUpFlagModel } from './storm.model.js';

const P = { lat: 32.5921, lng: -96.7561 }; // test property (Lancaster, TX area)
const north = (miles: number) => ({ lat: P.lat + miles / 69.09, lng: P.lng });
const east = (miles: number) => ({ lat: P.lat, lng: P.lng + miles / (69.17 * Math.cos((P.lat * Math.PI) / 180)) });
const south = (miles: number) => ({ lat: P.lat - miles / 69.09, lng: P.lng });
const west = (miles: number) => ({ lat: P.lat, lng: P.lng - miles / (69.17 * Math.cos((P.lat * Math.PI) / 180)) });

type Seed = { id: string; type: 'hail' | 'wind'; at: string | Date; size?: number; mph?: number; pt?: { lat: number; lng: number } | null; precision?: 'exact' | 'approximate' | 'county' | 'none'; quality?: 'ok' | 'speed_unknown'; qualifies?: boolean; county?: string; state?: string; desc?: string };
let seq = 0;
async function ev(s: Seed) {
  seq += 1;
  const pt = s.pt === undefined ? null : s.pt;
  return StormEventModel.create({
    eventType: s.type, source: 'ncei', sourceRecordId: s.id + seq, eventDate: new Date(s.at),
    hailSizeInches: s.size, windSpeedMph: s.mph, sourceMagnitude: s.size ?? s.mph, sourceMagnitudeUnit: s.type === 'hail' ? 'inch' : 'mph',
    latitude: pt?.lat, longitude: pt?.lng, ...(pt ? { location: { type: 'Point', coordinates: [pt.lng, pt.lat] } } : {}),
    coordinatePrecision: s.precision ?? (pt ? 'exact' : 'county'), locationDescription: s.desc ?? 'Test report', county: s.county ?? 'Dallas', state: s.state ?? 'TX',
    qualityStatus: s.quality ?? 'ok', qualifies: s.qualifies ?? true, sourceRef: 'test', importedAt: new Date(), rawSourceMetadata: { narrative: 'Narrative text' },
  });
}

describe('Hail & wind intelligence: search, map, zones, alerts, follow-ups, CRM history', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => { await startTestDb(); app = createApp(); await StormEventModel.syncIndexes(); await StormAlertModel.syncIndexes(); await StormFollowUpFlagModel.syncIndexes(); }, 120_000);
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await clearCollections(); await seedPhase2Config(); process.env.STORM_GEOCODER = 'none'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.STORM_GEOCODER; });

  const login = async (email: string): Promise<string> => (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = '/api/v1/storm';

  async function users() {
    await createUser({ email: 'admin@example.com', role: 'admin', firstName: 'Ada', lastName: 'Admin' });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson', firstName: 'Sam', lastName: 'Seller' });
    const sales2Id = await createUser({ email: 'sales2@example.com', role: 'salesperson', firstName: 'Sue', lastName: 'Second' });
    return { admin: await login('admin@example.com'), sales: await login('sales@example.com'), sales2: await login('sales2@example.com'), salesId, sales2Id };
  }

  async function standardEvents() {
    const r = {
      e1: await ev({ id: 'e1', type: 'hail', size: 1.75, at: '2024-05-20T22:00:00Z', pt: north(0.5) }),
      e2: await ev({ id: 'e2', type: 'hail', size: 1.0, at: '2024-05-21T01:00:00Z', pt: north(2.5), precision: 'approximate' }),
      e3: await ev({ id: 'e3', type: 'wind', mph: 70, at: '2024-05-19T20:00:00Z', pt: east(4.5) }),
      e4: await ev({ id: 'e4', type: 'hail', size: 2.5, at: '2024-05-22T20:00:00Z', pt: south(8) }),
      e5: await ev({ id: 'e5', type: 'wind', mph: 65, at: '2024-05-21T18:00:00Z', pt: west(2.9) }),
      e6: await ev({ id: 'e6', type: 'hail', size: 1.5, at: '2024-05-20T21:00:00Z', pt: null, precision: 'county', desc: 'Dallas County' }),
      e7: await ev({ id: 'e7', type: 'wind', at: '2024-05-20T20:00:00Z', pt: north(1), quality: 'speed_unknown', qualifies: false, desc: 'Damage reported' }),
      e8: await ev({ id: 'e8', type: 'hail', size: 3.0, at: '2024-05-23T20:00:00Z', pt: { lat: P.lat + 0.9, lng: P.lng } }),
    };
    return r;
  }
  const q = (o: Record<string, string | number | boolean>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  const search = async (t: string, o: Record<string, string | number | boolean>) => request(app).get(`${api}/search?${q({ lat: P.lat, lng: P.lng, ...o })}`).set(h(t));
  const ids = (res: request.Response): string[] => (res.body.data.data as Array<{ id: string }>).map((e) => e.id);

  // ---------------------------------------------------------------- search

  it('finds events by radius using real great-circle distance, with direction, precision and source', async () => {
    const { sales } = await users();
    const e = await standardEvents();
    const id = (k: keyof typeof e) => String(e[k]._id);
    expect(ids(await search(sales, { radius: 1 }))).toEqual([id('e1')]);
    expect(new Set(ids(await search(sales, { radius: 3 })))).toEqual(new Set([id('e1'), id('e2'), id('e5')]));
    expect(new Set(ids(await search(sales, { radius: 5 })))).toEqual(new Set([id('e1'), id('e2'), id('e5'), id('e3')]));
    expect(new Set(ids(await search(sales, { radius: 10 })))).toEqual(new Set([id('e1'), id('e2'), id('e5'), id('e3'), id('e4')]));
    const r = await search(sales, { radius: 5, sort: 'nearest' });
    const first = r.body.data.data[0];
    expect(first).toMatchObject({ id: id('e1'), eventType: 'hail', hailSizeInches: 1.75, direction: 'N', precision: 'exact', source: 'ncei', quality: 'ok' });
    expect(first.distanceMiles).toBeGreaterThan(0.4);
    expect(first.distanceMiles).toBeLessThan(0.6);
    expect(first.precisionLabel).toBe('Exact reported coordinates');
    expect(first.sourceLabel).toContain('NCEI');
    const wind = r.body.data.data.find((x: { id: string }) => x.id === id('e3'));
    expect(wind).toMatchObject({ direction: 'E', windSpeedMph: 70, magnitudeLabel: '70 mph wind' });
    expect(wind.distanceMiles).toBeGreaterThan(4.3);
    expect(wind.distanceMiles).toBeLessThan(4.7);
    expect(r.body.data.disclaimer).toMatch(/does not show that the property was struck or damaged/);
    expect(r.body.data.summary).toMatchObject({ hailReports: 2, windReports: 2, maxHailInches: 1.75, maxWindMph: 70 });
    expect(r.body.data.location).toMatchObject({ source: 'coordinates' });
  });

  it('never uses county-level or unlocated reports for distance, and never shows speed-unknown wind unless asked', async () => {
    const { sales } = await users();
    const e = await standardEvents();
    const all = ids(await search(sales, { radius: 10 }));
    expect(all).not.toContain(String(e.e6._id)); // county-level hail
    expect(all).not.toContain(String(e.e7._id)); // wind with no speed
    const withUnknown = await search(sales, { radius: 3, includeUnknownSpeed: true });
    expect(ids(withUnknown)).toContain(String(e.e7._id));
    expect(withUnknown.body.data.data.find((x: { id: string }) => x.id === String(e.e7._id))).toMatchObject({ windSpeedMph: null, magnitudeLabel: 'Wind damage reported (speed not reported)' });
    const regional = await search(sales, { radius: 3, state: 'TX' });
    expect(regional.body.data.regional.count).toBe(1);
    expect(regional.body.data.regional.items[0]).toMatchObject({ id: String(e.e6._id), distanceMiles: null, precision: 'county' });
    expect(regional.body.data.regional.note).toMatch(/no distance/);
  });

  it('applies type, size, speed, date and source filters, sorting and pagination', async () => {
    const { sales } = await users();
    const e = await standardEvents();
    const id = (k: keyof typeof e) => String(e[k]._id);
    expect(new Set(ids(await search(sales, { radius: 10, types: 'wind' })))).toEqual(new Set([id('e3'), id('e5')]));
    expect(ids(await search(sales, { radius: 10, types: 'hail', minHail: 2 }))).toEqual([id('e4')]);
    expect(ids(await search(sales, { radius: 10, types: 'wind', minWind: 68 }))).toEqual([id('e3')]);
    expect(new Set(ids(await search(sales, { radius: 10, from: '2024-05-21', to: '2024-05-22' })))).toEqual(new Set([id('e2'), id('e5'), id('e4')]));
    expect(ids(await search(sales, { radius: 10, sources: 'spc' }))).toEqual([]);
    expect(ids(await search(sales, { radius: 10, sort: 'newest' }))[0]).toBe(id('e4'));
    expect(ids(await search(sales, { radius: 10, sort: 'largest' }))[0]).toBe(id('e4'));
    expect(ids(await search(sales, { radius: 10, sort: 'nearest' })).slice(0, 2)).toEqual([id('e1'), id('e2')]);
    const p2 = await search(sales, { radius: 10, pageSize: 2, page: 2, sort: 'nearest' });
    expect(p2.body.data.meta).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(p2.body.data.data).toHaveLength(2);
    // thresholds cannot be lowered below the product thresholds
    expect((await search(sales, { radius: 5, minHail: 0.5 })).status).toBe(400);
    expect((await search(sales, { radius: 5, minWind: 40 })).status).toBe(400);
  });

  it('highlights the day before, date of loss and day after (local standard time) and leaves other days out', async () => {
    const { sales } = await users();
    const e = await standardEvents();
    const res = await search(sales, { radius: 10, dateOfLoss: '2024-05-20' });
    const w = res.body.data.dateOfLoss;
    expect(w.days.map((d: { label: string }) => d.label)).toEqual(['Day before', 'Date of loss', 'Day after']);
    expect(w.days.map((d: { day: string }) => d.day)).toEqual(['2024-05-19', '2024-05-20', '2024-05-21']);
    expect(w.days.map((d: { isDateOfLoss: boolean }) => d.isDateOfLoss)).toEqual([false, true, false]);
    const on = (i: number) => new Set(w.days[i].events.map((x: { id: string }) => x.id));
    expect(on(0)).toEqual(new Set([String(e.e3._id)]));
    expect(on(1)).toEqual(new Set([String(e.e1._id), String(e.e2._id)])); // 01:00Z on the 21st is still the evening of the 20th locally
    expect(on(2)).toEqual(new Set([String(e.e5._id)]));
    expect(w.days[1]).toMatchObject({ hailReports: 2, windReports: 0, maxHailInches: 1.75 });
    expect(w.timeNote).toMatch(/standard time/);
    expect((await search(sales, { radius: 10, dateOfLoss: '2024-13-45' })).status).toBe(400);
  });

  it('validates the search input (radius list, location required) and requires login and permission', async () => {
    const { sales } = await users();
    expect((await search(sales, { radius: 2 })).status).toBe(400);
    expect((await request(app).get(`${api}/search?radius=5`).set(h(sales))).status).toBe(400);
    expect((await request(app).get(`${api}/search?lat=${P.lat}&lng=${P.lng}`)).status).toBe(401);
    expect((await request(app).get(`${api}/search?lat=95&lng=0&radius=5`).set(h(sales))).status).toBe(400);
  });

  it('searches by address through the geocoder; reports clearly when none is configured; rejects approximate matches', async () => {
    const { sales } = await users();
    await standardEvents();
    const noGeo = await request(app).get(`${api}/search?${q({ address: '1532 Rebecca Lane, Lancaster, TX 75134', radius: 3 })}`).set(h(sales));
    expect(noGeo.status).toBe(503);
    expect(noGeo.body.error.code).toBe('GEOCODER_NOT_CONFIGURED');
    process.env.STORM_GEOCODER = 'census';
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ result: { addressMatches: [{ matchedAddress: '1532 REBECCA LN, LANCASTER, TX, 75134', coordinates: { x: P.lng, y: P.lat } }] } }) }));
    const ok = await request(app).get(`${api}/search?${q({ address: '1532 Rebecca Lane, Lancaster, TX 75134', radius: 3 })}`).set(h(sales));
    expect(ok.status).toBe(200);
    expect(ok.body.data.location).toMatchObject({ source: 'geocoded', accuracy: 'street-address estimate', provider: 'census', latitude: P.lat });
    expect(ok.body.data.data.length).toBe(3);
    process.env.STORM_GEOCODER = 'auto';
    process.env.GOOGLE_SOLAR_API_KEY = 'TEST-KEY-0123456789';
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ status: 'OK', results: [{ formatted_address: 'Dallas, TX', partial_match: true, geometry: { location: { lat: 32.7, lng: -96.8 }, location_type: 'APPROXIMATE' } }] }) }));
    const approx = await request(app).get(`${api}/search?${q({ address: 'Dallas TX', radius: 3 })}`).set(h(sales));
    delete process.env.GOOGLE_SOLAR_API_KEY;
    expect(approx.status).toBe(422);
    expect(approx.body.error.code).toBe('ADDRESS_IMPRECISE');
  });

  // ---------------------------------------------------------------- map and details

  it('serves map markers for a bounded area, capped and flagged when truncated, never the whole dataset', async () => {
    const { sales } = await users();
    const e = await standardEvents();
    const box = `${P.lng - 0.3},${P.lat - 0.3},${P.lng + 0.3},${P.lat + 0.3}`;
    const res = await request(app).get(`${api}/events/map?bbox=${box}`).set(h(sales));
    expect(res.status).toBe(200);
    expect(new Set(res.body.data.data.map((m: { id: string }) => m.id))).toEqual(new Set(['e1', 'e2', 'e3', 'e4', 'e5'].map((k) => String(e[k as 'e1']._id))));
    expect(res.body.data.truncated).toBe(false);
    expect(res.body.data.data[0]).toMatchObject({ t: 'hail', h: 2.5 }); // largest first
    const cap = await request(app).get(`${api}/events/map?bbox=${box}&limit=2`).set(h(sales));
    expect(cap.body.data.data).toHaveLength(2);
    expect(cap.body.data).toMatchObject({ truncated: true, total: 5 });
    expect(cap.body.data.note).toMatch(/2 largest of 5/);
    expect((await request(app).get(`${api}/events/map?bbox=${box}&types=wind`).set(h(sales))).body.data.data.every((m: { t: string }) => m.t === 'wind')).toBe(true);
    expect((await request(app).get(`${api}/events/map?bbox=${box}&minHail=2&types=hail`).set(h(sales))).body.data.data).toHaveLength(1);
    expect((await request(app).get(`${api}/events/map?lat=${P.lat}&lng=${P.lng}&radius=3`).set(h(sales))).body.data.total).toBe(3);
    expect((await request(app).get(`${api}/events/map`).set(h(sales))).status).toBe(400); // an area is required
    expect((await request(app).get(`${api}/events/map?bbox=-130,20,-60,50`).set(h(sales))).status).toBe(400); // too large
  });

  it('shows one event with source, precision and narrative', async () => {
    const { sales } = await users();
    const e = await standardEvents();
    const d = await request(app).get(`${api}/events/${e.e1._id}`).set(h(sales));
    expect(d.status).toBe(200);
    expect(d.body.data).toMatchObject({ id: String(e.e1._id), narrative: 'Narrative text', source: 'ncei', precision: 'exact' });
    expect(d.body.data.disclaimer).toBeTruthy();
    expect((await request(app).get(`${api}/events/${new mongoose.Types.ObjectId()}`).set(h(sales))).status).toBe(404);
    expect((await request(app).get(`${api}/events/not-an-id`).set(h(sales))).status).toBe(400);
  });

  it('status reports thresholds, geocoder, alert channels and that MRMS is not available', async () => {
    const { sales } = await users();
    const s = (await request(app).get(`${api}/status`).set(h(sales))).body.data;
    expect(s.thresholds).toMatchObject({ hailMinInches: 1, windMinMph: 50 });
    expect(s.radiiMiles).toEqual([1, 3, 5, 10]);
    expect(s.geocoder).toMatchObject({ provider: 'none', configured: false });
    expect(s.alertChannels.email).toMatch(/Not configured/);
    expect(s.alertChannels.sms).toMatch(/Not configured/);
    expect(s.mrms.available).toBe(false);
  });

  // ---------------------------------------------------------------- zones

  async function zoneKit() {
    const u = await users();
    const e = await standardEvents();
    const mk = (body: Record<string, unknown>, t = u.admin) => request(app).post(`${api}/zones`).set(h(t)).send(body);
    const z1 = (await mk({ name: 'Lancaster core', kind: 'radius', center: P, radiusMiles: 5, assignedUserId: u.salesId })).body.data;
    const z2 = (await mk({ name: 'North corridor', kind: 'polygon', polygon: [[P.lng - 0.1, P.lat + 0.8], [P.lng + 0.1, P.lat + 0.8], [P.lng + 0.1, P.lat + 1.0], [P.lng - 0.1, P.lat + 1.0], [P.lng - 0.1, P.lat + 0.8]] })).body.data;
    return { ...u, e, z1, z2, mk };
  }

  it('creates radius, drawn and county zones with validation, and keeps assignment history', async () => {
    const { admin, sales, sales2Id, salesId, z1, z2, mk } = await zoneKit();
    expect(z1).toMatchObject({ name: 'Lancaster core', kind: 'radius', radiusMiles: 5, assignedUser: { name: 'Sam Seller' } });
    expect(z1.assignmentHistory).toHaveLength(1);
    expect(z2.kind).toBe('polygon');
    expect((await mk({ name: 'No centre', kind: 'radius', radiusMiles: 3 })).status).toBe(400);
    expect((await mk({ name: 'Bad polygon', kind: 'polygon', polygon: [[0, 0], [1, 1], [0, 1]] })).status).toBe(400);
    expect((await mk({ name: 'Backwards dates', kind: 'radius', center: P, radiusMiles: 3, dateFrom: '2024-06-01', dateTo: '2024-05-01' })).status).toBe(400);
    expect((await mk({ name: 'County', kind: 'county', counties: [{ state: 'TX', county: 'Dallas' }] })).status).toBe(201);
    expect((await mk({ name: 'Mine?', kind: 'radius', center: P, radiusMiles: 3 }, sales)).status).toBe(403);
    // reassignment
    const re = await request(app).post(`${api}/zones/${z1.id}/assign`).set(h(admin)).send({ userId: String(sales2Id), note: 'Sam is on leave' });
    expect(re.status).toBe(200);
    expect(re.body.data.assignedUser.name).toBe('Sue Second');
    expect(re.body.data.assignmentHistory).toHaveLength(2);
    expect(re.body.data.assignmentHistory[1]).toMatchObject({ user: 'Sue Second', by: 'Ada Admin', note: 'Sam is on leave' });
    expect((await request(app).post(`${api}/zones/${z1.id}/assign`).set(h(admin)).send({ userId: String(new mongoose.Types.ObjectId()) })).status).toBe(422);
    expect((await request(app).post(`${api}/zones/${z1.id}/assign`).set(h(sales)).send({ userId: String(salesId) })).status).toBe(403);
    expect((await request(app).post(`${api}/zones/${z1.id}/assign`).set(h(admin)).send({ userId: null })).body.data.assignedUser).toBeNull();
    expect(await AuditLogModel.countDocuments({ action: 'storm.zone_assigned' })).toBe(2);
    expect(await AuditLogModel.countDocuments({ action: 'storm.zone_created' })).toBe(3);
  });

  it('salespeople see only the territory assigned to them', async () => {
    const { sales, sales2, z1, z2 } = await zoneKit();
    const mine = (await request(app).get(`${api}/zones`).set(h(sales))).body.data;
    expect(mine.map((z: { id: string }) => z.id)).toEqual([z1.id]);
    expect((await request(app).get(`${api}/zones/${z1.id}`).set(h(sales))).status).toBe(200);
    expect((await request(app).get(`${api}/zones/${z2.id}`).set(h(sales))).status).toBe(404);
    expect((await request(app).get(`${api}/zones`).set(h(sales2))).body.data).toEqual([]);
    expect((await request(app).get(`${api}/zones/rankings`).set(h(sales))).body.data.rows).toHaveLength(1);
    expect((await request(app).patch(`${api}/zones/${z1.id}`).set(h(sales)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`${api}/zones/${z1.id}`).set(h(sales))).status).toBe(403);
  });

  it('ranks zones by hail, wind, reports, recency and a score whose calculation is shown', async () => {
    const { admin, z1, z2 } = await zoneKit();
    const rank = async (o: Record<string, string>) => (await request(app).get(`${api}/zones/rankings?${new URLSearchParams(o)}`).set(h(admin))).body.data;
    const hail = await rank({ sort: 'hail' });
    expect(hail.rows.map((r: { zone: { id: string } }) => r.zone.id)).toEqual([z2.id, z1.id]);
    expect(hail.rows[0].stats).toMatchObject({ maxHailInches: 3, hailReports: 1, windReports: 0 });
    expect(hail.explanation).toMatch(/largest hail/);
    expect((await rank({ sort: 'wind' })).rows[0].zone.id).toBe(z1.id);
    expect((await rank({ sort: 'wind' })).rows[0].stats.maxWindMph).toBe(70);
    const reports = await rank({ sort: 'reports' });
    expect(reports.rows[0].zone.id).toBe(z1.id);
    expect(reports.rows[0].stats).toMatchObject({ hailReports: 2, windReports: 2 });
    expect(reports.explanation).toMatch(/counted separately/);
    expect((await rank({ sort: 'recent' })).rows[0].zone.id).toBe(z2.id); // e8 is the newest report
    const score = await rank({ sort: 'score' });
    const s1 = score.rows.find((r: { zone: { id: string } }) => r.zone.id === z1.id).stats;
    // z1 storm days: hail 1.75 (May 20, local-independent UTC day) and 1.0 (May 21); wind 70/50 on May 19 and 65/50 on May 21
    expect(s1.stormDays).toBe(3);
    expect(s1.score.hailPoints).toBeCloseTo(2.75, 2);
    expect(s1.score.windPoints).toBeCloseTo(0.5 * (70 / 50 + 65 / 50), 2);
    expect(s1.score.weights).toEqual({ hail: 1, wind: 0.5, recency: 1 });
    expect(s1.score.formula).toMatch(/one value per day/);
    expect(s1.score.total).toBeCloseTo(s1.score.hailPoints + s1.score.windPoints + s1.score.recencyPoints, 2);
    const heavyWind = await rank({ sort: 'score', wWind: '10', wHail: '0', wRecency: '0' });
    expect(heavyWind.rows[0].zone.id).toBe(z1.id);
    // date and size filters
    const later = await rank({ sort: 'reports', from: '2024-05-21' });
    expect(later.rows.find((r: { zone: { id: string } }) => r.zone.id === z1.id).stats).toMatchObject({ hailReports: 1, windReports: 1 });
    expect((await rank({ sort: 'hail', minHail: '2' })).rows.find((r: { zone: { id: string } }) => r.zone.id === z1.id).stats.hailReports).toBe(0);
  });

  it('counts CRM customers, leads and past customers inside a zone from saved property locations, and says what it cannot place', async () => {
    const { admin, salesId, z1 } = await zoneKit();
    const stage = await PipelineStageModel.findOne({});
    const c = await CustomerModel.create({ type: 'individual', firstName: 'Pat', lastName: 'Past', ownerId: salesId });
    const inside = await PropertyModel.create({ customerId: c._id, address: { line1: '1 Inside Rd', city: 'Lancaster', state: 'TX', zip: '75134' }, addressKey: 'key-inside', location: north(0.5) });
    const outside = await PropertyModel.create({ customerId: c._id, address: { line1: '9 Far Rd', city: 'Austin', state: 'TX', zip: '78701' }, addressKey: 'key-far', location: { lat: 30.27, lng: -97.74 } });
    await PropertyModel.create({ customerId: c._id, address: { line1: '5 No Location', city: 'X', state: 'TX', zip: '75000' } });
    await ProjectModel.create({ number: 'P-1', customerId: c._id, propertyId: inside._id, status: 'completed', actualEndAt: new Date('2024-01-01'), createdBy: salesId });
    await ProjectModel.create({ number: 'P-2', customerId: c._id, propertyId: outside._id, status: 'completed', actualEndAt: new Date('2024-01-01'), createdBy: salesId });
    await LeadModel.create({ firstName: 'Lee', lastName: 'Lead', sourceKey: 'website', stageId: stage!._id, assignedTo: salesId, address: { line1: '1 Inside Rd' }, addressKey: 'key-inside' });
    await LeadModel.create({ firstName: 'Nolocation', lastName: 'Lead', sourceKey: 'website', stageId: stage!._id, assignedTo: salesId, address: { line1: 'Somewhere' }, addressKey: 'unknown' });
    const z = (await request(app).get(`${api}/zones/${z1.id}`).set(h(admin))).body.data;
    expect(z.stats.crm).toMatchObject({ customers: 1, pastCustomers: 1, leads: 1, propertiesWithLocation: 2, leadsNotLocated: 1 });
    expect(z.stats.crm.note).toMatch(/saved location/);
  });

  it('updates and archives zones with an audit trail', async () => {
    const { admin, z1 } = await zoneKit();
    const up = await request(app).patch(`${api}/zones/${z1.id}`).set(h(admin)).send({ name: 'Renamed', radiusMiles: 4, notes: 'Door knock Saturday' });
    expect(up.body.data).toMatchObject({ name: 'Renamed', radiusMiles: 4, notes: 'Door knock Saturday' });
    expect((await request(app).patch(`${api}/zones/${z1.id}`).set(h(admin)).send({ radiusMiles: 500 })).status).toBe(400);
    expect((await request(app).delete(`${api}/zones/${z1.id}`).set(h(admin))).status).toBe(204);
    expect((await request(app).get(`${api}/zones`).set(h(admin))).body.data.map((z: { id: string }) => z.id)).not.toContain(z1.id);
    expect(await AuditLogModel.countDocuments({ action: { $in: ['storm.zone_updated', 'storm.zone_archived'] } })).toBe(2);
  });

  // ---------------------------------------------------------------- alerts

  it('alerts the zone representative once per rule and event, honours thresholds and the alert window, and reports channels truthfully', async () => {
    const { admin, sales, sales2, salesId } = await zoneKit();
    const zone = (await request(app).get(`${api}/zones`).set(h(admin))).body.data.find((z: { name: string }) => z.name === 'Lancaster core');
    const rule = await request(app).post(`${api}/alerts/rules`).set(h(admin)).send({ name: 'Core hail', zoneId: zone.id, hailMinInches: 1.5, channels: { inApp: true, email: true } });
    expect(rule.status).toBe(201);
    const now = new Date();
    const fresh = async (o: Partial<Seed>) => ev({ id: 'new', type: 'hail', size: 2.0, at: new Date(now.getTime() - 3_600_000), pt: north(1), ...o });
    const hit = await fresh({});
    const small = await fresh({ size: 1.2 }); // below this rule's hail threshold
    const far = await fresh({ pt: north(30) }); // outside the zone
    const old = await fresh({ at: new Date(now.getTime() - 10 * 86_400_000) }); // outside the alert window
    const windHit = await fresh({ type: 'wind', size: undefined, mph: 55 });
    const r1 = await evaluateEvents([hit._id, small._id, far._id, old._id, windHit._id], { now });
    expect(r1).toMatchObject({ alertsCreated: 2, skippedDuplicates: 0 });
    const notes = await NotificationModel.find({ userId: salesId, type: 'storm_alert' });
    expect(notes).toHaveLength(2);
    expect(notes[0]!.title).toMatch(/Storm alert: .*Lancaster core/);
    expect(notes[0]!.title).toMatch(/not confirmed damage/);
    expect(notes[0]!.link).toMatch(/^\/app\/storm\/map\?event=/);
    // a second evaluation does not alert again
    const r2 = await evaluateEvents([hit._id, windHit._id], { now });
    expect(r2).toMatchObject({ alertsCreated: 0, skippedDuplicates: 2 });
    expect(await NotificationModel.countDocuments({ type: 'storm_alert' })).toBe(2);
    expect(await StormAlertModel.countDocuments({})).toBe(2);
    expect(await evaluateRecent(now)).toMatchObject({ alertsCreated: 0 });
    // nobody else is notified
    expect(await NotificationModel.countDocuments({ type: 'storm_alert', userId: { $ne: salesId } })).toBe(0);
    // channel results say what really happened
    const alert = await StormAlertModel.findOne({ eventId: hit._id }).lean();
    const cr = alert!.channelResults as { inApp: Record<string, string>; email: Record<string, string>; sms: string };
    expect(Object.values(cr.inApp)).toEqual(['sent']);
    expect(Object.values(cr.email)).toEqual(['not_configured']);
    expect(cr.sms).toBe('off');
    // history: the representative sees their alerts, other salespeople none, admin all
    expect((await request(app).get(`${api}/alerts/history`).set(h(sales))).body.data).toHaveLength(2);
    expect((await request(app).get(`${api}/alerts/history`).set(h(sales2))).body.data).toHaveLength(0);
    const hist = (await request(app).get(`${api}/alerts/history`).set(h(admin))).body;
    expect(hist.data).toHaveLength(2);
    expect(hist.data[0]).toMatchObject({ ruleName: 'Core hail', zoneName: 'Lancaster core', recipients: ['Sam Seller'] });
  });

  it('rule options: event radius beyond the zone, admins as recipients, disabled rules, and validation', async () => {
    const { admin, sales, z1, salesId } = await zoneKit();
    const base = { zoneId: z1.id };
    const now = new Date();
    const nearEdge = await ev({ id: 'edge', type: 'hail', size: 1.5, at: new Date(now.getTime() - 3_600_000), pt: north(7) }); // zone radius 5, so 2 miles outside
    const strict = (await request(app).post(`${api}/alerts/rules`).set(h(admin)).send({ ...base, name: 'Strict' })).body.data;
    expect((await evaluateEvents([nearEdge._id], { now })).alertsCreated).toBe(0);
    await request(app).patch(`${api}/alerts/rules/${strict.id}`).set(h(admin)).send({ radiusMiles: 3, notifyAdmins: true });
    expect((await evaluateEvents([nearEdge._id], { now })).alertsCreated).toBe(1);
    expect(await NotificationModel.countDocuments({ type: 'storm_alert' })).toBe(2); // representative and the admin
    await request(app).patch(`${api}/alerts/rules/${strict.id}`).set(h(admin)).send({ enabled: false });
    const another = await ev({ id: 'x', type: 'hail', size: 2, at: new Date(now.getTime() - 1000), pt: north(1) });
    expect((await evaluateEvents([another._id], { now })).alertsCreated).toBe(0);
    // validation and permissions
    const bad = (o: Record<string, unknown>) => request(app).post(`${api}/alerts/rules`).set(h(admin)).send({ name: 'x1', ...base, ...o });
    expect((await bad({ hailMinInches: 0.5 })).status).toBe(400);
    expect((await bad({ windMinMph: 40 })).status).toBe(400);
    expect((await bad({ radiusMiles: 80 })).status).toBe(400);
    expect((await bad({ recipientUserIds: [String(new mongoose.Types.ObjectId())] })).status).toBe(422);
    expect((await request(app).post(`${api}/alerts/rules`).set(h(sales)).send({ name: 'mine', ...base })).status).toBe(403);
    expect((await request(app).get(`${api}/alerts/rules`).set(h(sales))).status).toBe(403);
    expect((await request(app).get(`${api}/alerts/rules`).set(h(admin))).body.data).toHaveLength(1);
    expect((await request(app).delete(`${api}/alerts/rules/${strict.id}`).set(h(admin))).status).toBe(204);
    expect(await AuditLogModel.countDocuments({ action: { $in: ['storm.alert_rule_created', 'storm.alert_rule_changed', 'storm.alert_rule_deleted'] } })).toBe(4);
    void salesId;
  });

  it('a rule never notifies another company', async () => {
    const { admin, z1, e } = await zoneKit();
    const company2 = await CompanyModel.create({ name: 'Other Roofing', slug: 'other-roofing' });
    await createUser({ email: 'admin2@example.com', role: 'admin', companyId: String(company2._id) });
    const admin2 = await login('admin2@example.com');
    expect((await request(app).get(`${api}/zones/${z1.id}`).set(h(admin2))).status).toBe(404);
    expect((await request(app).post(`${api}/alerts/rules`).set(h(admin2)).send({ name: 'steal', zoneId: z1.id })).status).toBe(404);
    expect((await request(app).get(`${api}/zones`).set(h(admin2))).body.data).toEqual([]);
    void admin; void e;
  });

  // ---------------------------------------------------------------- follow-ups and CRM history

  async function pastCustomer(sales: { salesId: mongoose.Types.ObjectId | string }) {
    const c = await CustomerModel.create({ type: 'individual', firstName: 'Pat', lastName: 'Past', ownerId: sales.salesId });
    const prop = await PropertyModel.create({ customerId: c._id, address: { line1: '1532 Rebecca Lane', city: 'Lancaster', state: 'TX', zip: '75134' }, location: P });
    const done = await ProjectModel.create({ number: 'PRJ-1', customerId: c._id, propertyId: prop._id, status: 'completed', actualEndAt: new Date('2024-05-01'), createdBy: sales.salesId });
    return { c, prop, done };
  }

  it('flags past customers when a qualifying event happens near a job completed earlier, once per event, and respects dismissals', async () => {
    const { admin, sales, sales2, salesId } = await zoneKit();
    const { c, prop, done } = await pastCustomer({ salesId });
    await ProjectModel.create({ number: 'PRJ-2', customerId: c._id, propertyId: prop._id, status: 'completed', actualEndAt: new Date('2024-06-01'), createdBy: salesId }); // completed after every event
    await ProjectModel.create({ number: 'PRJ-3', customerId: c._id, propertyId: prop._id, status: 'completed', createdBy: salesId }); // no completion date
    const noLoc = await PropertyModel.create({ customerId: c._id, address: { line1: '2 Nowhere', city: 'X', state: 'TX', zip: '75000' } });
    await ProjectModel.create({ number: 'PRJ-4', customerId: c._id, propertyId: noLoc._id, status: 'closed', actualEndAt: new Date('2024-05-01'), createdBy: salesId });
    expect((await request(app).post(`${api}/follow-ups/scan`).set(h(sales)).send({})).status).toBe(403);
    const scan = await request(app).post(`${api}/follow-ups/scan`).set(h(admin)).send({ radiusMiles: 3 });
    // events within 3 miles after 2024-05-01: e1 (0.5), e2 (2.5), e5 (2.9) from PRJ-1; PRJ-2 completes later, PRJ-3 has no date, PRJ-4 has no location
    expect(scan.body.data).toMatchObject({ projectsChecked: 2, projectsWithoutCompletionDate: 1, projectsWithoutLocation: 1, flagsCreated: 3, existingFlags: 0 });
    expect((await request(app).post(`${api}/follow-ups/scan`).set(h(admin)).send({ radiusMiles: 3 })).body.data).toMatchObject({ flagsCreated: 0, existingFlags: 3 });
    const list = await request(app).get(`${api}/follow-ups`).set(h(sales));
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data[0]).toMatchObject({ status: 'new', customer: { name: 'Pat Past' }, property: { address: '1532 Rebecca Lane, Lancaster, TX 75134' }, projectId: String(done._id) });
    expect(list.body.data[0].message).toBe('Nearby storm activity detected after completed roof work — follow-up may be appropriate.');
    expect(list.body.disclaimer).toMatch(/does not mean the roof is damaged/);
    expect((await request(app).get(`${api}/follow-ups`).set(h(sales2))).body.data).toHaveLength(0); // someone else's customer
    // dismissal sticks, and the next scan does not bring the flag back
    const target = list.body.data[0].id as string;
    expect((await request(app).post(`${api}/follow-ups/${target}/dismiss`).set(h(sales)).send({ note: 'Customer moved' })).status).toBe(204);
    await request(app).post(`${api}/follow-ups/scan`).set(h(admin)).send({ radiusMiles: 3 });
    expect(await StormFollowUpFlagModel.countDocuments({})).toBe(3);
    expect((await StormFollowUpFlagModel.findById(target))?.status).toBe('dismissed');
    expect((await request(app).get(`${api}/follow-ups?status=new`).set(h(sales))).body.data).toHaveLength(2);
    expect((await request(app).post(`${api}/follow-ups/${target}/dismiss`).set(h(sales2)).send({})).status).toBe(404);
    // a larger radius adds the 4.5 mile wind report for the same job
    expect((await request(app).post(`${api}/follow-ups/scan`).set(h(admin)).send({ radiusMiles: 5 })).body.data.flagsCreated).toBe(1);
  });

  it('turns a flag into a follow-up task, call reminder or note on the customer', async () => {
    const { admin, sales, salesId } = await zoneKit();
    const { c } = await pastCustomer({ salesId });
    await request(app).post(`${api}/follow-ups/scan`).set(h(admin)).send({ radiusMiles: 3 });
    const flag = (await request(app).get(`${api}/follow-ups`).set(h(sales))).body.data[0];
    expect((await request(app).post(`${api}/follow-ups/${flag.id}/activities`).set(h(sales)).send({ type: 'follow_up' })).status).toBe(400); // due date required
    const task = await request(app).post(`${api}/follow-ups/${flag.id}/activities`).set(h(sales)).send({ type: 'follow_up', dueAt: '2026-12-01T15:00:00Z' });
    expect(task.status).toBe(201);
    expect(task.body.data.flagStatus).toBe('reviewed');
    const act = await ActivityModel.findById(task.body.data.activityId);
    expect(act).toMatchObject({ entityType: 'customer', type: 'follow_up' });
    expect(String(act!.entityId)).toBe(String(c._id));
    expect(act!.body).toMatch(/follow-up may be appropriate/);
    expect(String(act!.assignedTo)).toBe(String(salesId));
    expect((await request(app).post(`${api}/follow-ups/${flag.id}/activities`).set(h(sales)).send({ type: 'call', dueAt: '2026-12-02T15:00:00Z', body: 'Call about the May storm' })).status).toBe(201);
    expect((await request(app).post(`${api}/follow-ups/${flag.id}/activities`).set(h(sales)).send({ type: 'note', body: 'Left a voicemail' })).status).toBe(201);
    expect(await ActivityModel.countDocuments({ entityId: c._id })).toBe(3);
    expect((await StormFollowUpFlagModel.findById(flag.id))?.activityIds).toHaveLength(3);
  });

  it('shows storm history on customer, property, project and lead records from their own address, and never errors for an unlocated one', async () => {
    const { sales, sales2, salesId } = await zoneKit();
    const { c, prop, done } = await pastCustomer({ salesId });
    const hist = async (t: string, o: Record<string, string>) => request(app).get(`${api}/history?${new URLSearchParams(o)}`).set(h(t));
    const byCustomer = await hist(sales, { customerId: String(c._id), radius: '3' });
    expect(byCustomer.status).toBe(200);
    const loc = byCustomer.body.data.locations[0];
    expect(loc).toMatchObject({ locationSource: 'saved', label: '1532 Rebecca Lane, Lancaster, TX 75134' });
    expect(new Set(loc.result.data.map((x: { eventType: string }) => x.eventType))).toEqual(new Set(['hail', 'wind']));
    expect(loc.result.data[0]).toHaveProperty('distanceMiles');
    expect(byCustomer.body.data.disclaimer).toBeTruthy();
    expect(byCustomer.body.data.note).toMatch(/not anyone's current location/);
    expect((await hist(sales, { propertyId: String(prop._id), radius: '1' })).body.data.locations[0].result.data).toHaveLength(1);
    expect((await hist(sales, { projectId: String(done._id), radius: '3' })).body.data.locations[0].result.meta.total).toBe(3);
    // another salesperson cannot read it
    expect((await hist(sales2, { customerId: String(c._id), radius: '3' })).status).toBe(404);
    expect((await hist(sales2, { propertyId: String(prop._id), radius: '3' })).status).toBe(404);
    // a property with no location and no geocoder: unavailable with a reason, not an error
    const bare = await PropertyModel.create({ customerId: c._id, address: { line1: '77 Unmapped St', city: 'Dallas', state: 'TX', zip: '75201' } });
    const un = await hist(sales, { propertyId: String(bare._id), radius: '3' });
    expect(un.status).toBe(200);
    expect(un.body.data.locations[0]).toMatchObject({ locationSource: 'unavailable', point: null, result: null });
    expect(un.body.data.locations[0].unavailableReason).toMatch(/geocoding is turned off/i);
    // with a geocoder, the point is saved on the property so it is not looked up again
    process.env.STORM_GEOCODER = 'census';
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ result: { addressMatches: [{ matchedAddress: '77 UNMAPPED ST', coordinates: { x: P.lng, y: P.lat + 0.001 } }] } }) }));
    const geo = await hist(sales, { propertyId: String(bare._id), radius: '3' });
    expect(geo.body.data.locations[0]).toMatchObject({ locationSource: 'geocoded', accuracy: 'street-address estimate' });
    expect((await PropertyModel.findById(bare._id))?.location?.lat).toBeCloseTo(P.lat + 0.001, 4);
    expect(await AuditLogModel.countDocuments({ action: 'property.geocoded_for_storm_history' })).toBe(1);
    const lead = await LeadModel.create({ firstName: 'Lee', lastName: 'Lead', sourceKey: 'website', stageId: (await PipelineStageModel.findOne({}))!._id, assignedTo: salesId, address: { line1: '77 Unmapped St', city: 'Dallas', state: 'TX', zip: '75201' } });
    const lh = await hist(sales, { leadId: String(lead._id), radius: '3' });
    expect(lh.body.data.locations[0]).toMatchObject({ locationSource: 'geocoded' });
    expect((await hist(sales2, { leadId: String(lead._id), radius: '3' })).status).toBe(404);
    expect((await hist(sales, { radius: '3' })).status).toBe(400);
  });
});
