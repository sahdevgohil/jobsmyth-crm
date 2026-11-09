import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { SourceUnavailableError } from './providers/spc.js';
import { StormEventModel, StormImportRunModel, StormImportUnitModel, StormLockModel } from './storm.model.js';
import { createRun, executeRun, importStatus, upsertEvents, type IngestDeps } from './storm.ingest.js';
import { setIngestDepsForTests, waitForImportsForTests } from './storm.routes.js';

// Real NOAA files (see providers.test.ts). Network access is replaced by these samples: this proves the parsing and the
// import mechanics, not that NOAA is reachable from a particular server.
const fx = (n: string): string => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const SPC_DAY = '2024-05-20';

type Behaviour = { spcDown?: boolean; nceiYears?: number[]; failYear?: number; listingDown?: boolean };

function deps(b: Behaviour = {}): IngestDeps {
  const years = b.nceiYears ?? [2009, 2024];
  return {
    now: () => new Date('2024-05-22T15:00:00Z'),
    fetchText: async (url) => {
      if (url.includes('swdi/stormevents/csvfiles')) {
        if (b.listingDown) throw new Error('getaddrinfo ENOTFOUND www.ncei.noaa.gov');
        const html = years.map((y) => `<a href="StormEvents_details-ftp_v1.0_d${y}_c20260728.csv.gz">f</a>`).join('');
        return { ok: true, status: 200, text: async () => html };
      }
      if (b.spcDown) throw new Error('connect ETIMEDOUT');
      const m = /(\d{6})_rpts_filtered_(hail|wind)\.csv/.exec(url);
      if (m && m[1] === '240520') return { ok: true, status: 200, text: async () => fx(`spc_240520_filtered_${m[2]}.csv`) };
      return { ok: false, status: 404, text: async () => '' };
    },
    openGzipText: async (url) => {
      if (b.failYear && url.includes(`_d${b.failYear}_`)) throw new SourceUnavailableError('NCEI answered HTTP 503.', 503);
      return Readable.from([Buffer.from(fx('ncei_details_sample.csv'))]);
    },
  };
}

describe('Storm ingestion: idempotent, resumable, honest about failures', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => { await startTestDb(); app = createApp(); await StormEventModel.syncIndexes(); }, 120_000);
  afterAll(async () => { setIngestDepsForTests(null); await stopTestDb(); });
  beforeEach(async () => { await clearCollections(); await seedPhase2Config(); setIngestDepsForTests(null); });

  const login = async (email: string): Promise<string> => (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function run(req: Parameters<typeof createRun>[0], d: IngestDeps) {
    const r = await createRun(req, d);
    return executeRun(r._id.toString(), req, d);
  }

  it('imports an SPC report day, then importing it again changes nothing (idempotent, no duplicates)', async () => {
    const d = deps();
    const first = await run({ source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, d);
    expect(first.status).toBe('completed');
    expect(first.counts.inserted).toBeGreaterThan(40);
    expect(first.counts.rows ?? 0).toBeGreaterThanOrEqual(first.counts.inserted ?? 0);
    const n = await StormEventModel.countDocuments({});
    expect(n).toBe(first.counts.inserted);
    const second = await run({ source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY, force: true }, d);
    expect(second.counts.inserted).toBe(0);
    expect(second.counts.updated).toBe(0);
    expect(second.counts.skipped).toBe(n);
    expect(await StormEventModel.countDocuments({})).toBe(n);
    // thresholds held in the database too
    expect(await StormEventModel.countDocuments({ eventType: 'hail', hailSizeInches: { $lt: 1 } })).toBe(0);
    expect(await StormEventModel.countDocuments({ eventType: 'wind', windSpeedMph: { $lte: 50 } })).toBe(0);
    // original value and unit are kept next to the normalized one
    const hail = await StormEventModel.findOne({ eventType: 'hail', locationDescription: '2 WSW Waupun' }).lean();
    expect(hail).toMatchObject({ hailSizeInches: 1.25, sourceMagnitude: 125, sourceMagnitudeUnit: 'hundredths_inch', source: 'spc', coordinatePrecision: 'approximate' });
    expect(hail?.location?.coordinates).toEqual([-88.77, 43.63]);
    const unknown = await StormEventModel.findOne({ eventType: 'wind', qualityStatus: 'speed_unknown' }).lean();
    expect(unknown).toBeTruthy();
    expect(unknown?.windSpeedMph).toBeUndefined();
    expect(unknown?.qualifies).toBe(false);
  });

  it('imports NCEI years, skips unchanged years next time, and a forced re-import adds nothing', async () => {
    const d = deps({ nceiYears: [2024] });
    const a = await run({ source: 'ncei', kind: 'backfill', fromYear: 2024, toYear: 2024 }, d);
    expect(a.status).toBe('completed');
    expect(a.counts.inserted).toBeGreaterThan(8);
    expect(a.counts.belowThreshold).toBeGreaterThan(0);
    const n = await StormEventModel.countDocuments({ source: 'ncei' });
    const b = await run({ source: 'ncei', kind: 'backfill', fromYear: 2024, toYear: 2024 }, d);
    expect(b.unitsSkipped).toBe(1);
    expect(b.counts.inserted).toBe(0);
    const c = await run({ source: 'ncei', kind: 'backfill', fromYear: 2024, toYear: 2024, force: true }, d);
    expect(c.counts.inserted).toBe(0);
    expect(c.counts.skipped).toBe(n);
    expect(await StormEventModel.countDocuments({ source: 'ncei' })).toBe(n);
    const w = await StormEventModel.findOne({ source: 'ncei', eventType: 'wind' }).lean();
    expect(w?.sourceMagnitudeUnit).toBe('knot');
    expect(w?.windSpeedMph).toBeGreaterThan(50);
  });

  it('is resumable: a failed year is recorded, other years finish, and a rerun processes only what is left', async () => {
    const broken = deps({ nceiYears: [2009, 2024], failYear: 2009 });
    const first = await run({ source: 'ncei', kind: 'backfill', fromYear: 2009, toYear: 2024 }, broken);
    // 2010-2023 have no file in this listing: unavailable, never silently treated as empty
    expect(first.status).toBe('completed_with_errors');
    expect(first.unitsDone).toBe(1);
    expect(first.unitsFailed).toBe(1);
    expect(first.unitsUnavailable).toBe(14);
    expect(first.issues.some((e) => e.unit === 'ncei:2009' && /503/.test(e.message ?? ''))).toBe(true);
    let st = await importStatus({ now: () => new Date('2024-05-22T00:00:00Z') });
    expect(st.sources.ncei.backfillComplete).toBe(false);
    expect(st.sources.ncei.yearsImported).toEqual([2024]);
    expect(st.sources.ncei.yearsMissing).toContain(2009);
    expect(st.sources.ncei.failedUnits.find((u) => u.unit === 'ncei:2009')?.status).toBe('failed');
    const afterFirst = await StormEventModel.countDocuments({});

    // NCEI recovers and publishes every year: only the unfinished years run, 2024 is skipped
    const ok = deps({ nceiYears: Array.from({ length: 16 }, (_, i) => 2009 + i) });
    const second = await run({ source: 'ncei', kind: 'backfill', fromYear: 2009, toYear: 2024 }, ok);
    expect(second.status).toBe('completed');
    expect(second.unitsSkipped).toBe(1);
    expect(second.unitsDone).toBe(16);
    st = await importStatus({ now: () => new Date('2024-05-22T00:00:00Z') });
    expect(st.sources.ncei.backfillComplete).toBe(true);
    expect(st.sources.ncei.yearsMissing).toEqual([]);
    expect(st.sources.ncei.lastSuccessfulSync).toBeTruthy();
    expect(await StormEventModel.countDocuments({})).toBeGreaterThanOrEqual(afterFirst);
  });

  it('a newer NCEI file version marks an imported year stale and it is imported again', async () => {
    await run({ source: 'ncei', kind: 'backfill', fromYear: 2024, toYear: 2024 }, deps({ nceiYears: [2024] }));
    await StormImportUnitModel.updateOne({ unitKey: 'ncei:2024' }, { $set: { sourceVersion: '20200101' } });
    const again = await run({ source: 'ncei', kind: 'backfill', fromYear: 2024, toYear: 2024 }, deps({ nceiYears: [2024] }));
    expect(again.unitsSkipped).toBe(0);
    expect(again.unitsDone).toBe(1);
  });

  it('NOAA being down is reported as a failure, never as success, and the CRM keeps working', async () => {
    const down = deps({ spcDown: true, listingDown: true });
    const r = await run({ source: 'all', kind: 'daily' }, down);
    expect(r.status).toBe('failed');
    expect(r.unitsDone).toBe(0);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.map((e) => e.message).join(' ')).toMatch(/unreachable|ENOTFOUND|ETIMEDOUT/);
    expect(await StormEventModel.countDocuments({})).toBe(0);
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const admin = await login('admin@example.com');
    expect((await request(app).get('/api/v1/customers').set(h(admin))).status).toBe(200); // the rest of the CRM is unaffected
    const st = (await request(app).get('/api/v1/storm/imports').set(h(admin))).body.data;
    expect(st.runs[0]).toMatchObject({ status: 'failed' });
    expect(st.sources.spc.lastSuccessfulSync).toBeNull();
  });

  it('an invalid or changed file is rejected instead of importing garbage', async () => {
    const d = deps();
    const bad: IngestDeps = { ...d, fetchText: async (url) => (url.includes('rpts_filtered') ? { ok: true, status: 200, text: async () => '<html>Service unavailable</html>' } : d.fetchText(url)) };
    const r = await run({ source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, bad);
    expect(r.status).toBe('failed');
    expect(r.issues[0]?.message).toMatch(/expected header/);
    const wrongColumns: IngestDeps = { ...d, openGzipText: async () => Readable.from([Buffer.from('A,B,C\n1,2,3\n')]), fetchText: d.fetchText };
    const r2 = await run({ source: 'ncei', kind: 'backfill', fromYear: 2024, toYear: 2024 }, { ...wrongColumns, fetchText: deps({ nceiYears: [2024] }).fetchText });
    expect(r2.status).toBe('failed');
    expect(r2.issues[0]?.message).toMatch(/missing expected columns/);
    expect(await StormEventModel.countDocuments({})).toBe(0);
  });

  it('only one import runs at a time, and a crashed run is detected and can be resumed', async () => {
    const d = deps();
    const r = await createRun({ source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, d);
    await expect(createRun({ source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, d)).rejects.toMatchObject({ code: 'IMPORT_RUNNING', status: 409 });
    // simulate the process dying: heartbeat is old
    await StormImportRunModel.updateOne({ _id: r._id }, { $set: { heartbeatAt: new Date(d.now!().getTime() - 60 * 60_000) } });
    const next = await createRun({ source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, d);
    expect((await StormImportRunModel.findById(r._id))?.status).toBe('failed');
    expect(((await StormImportRunModel.findById(r._id))?.issues ?? [])[0]?.message).toMatch(/stopped/);
    const done = await executeRun(next._id.toString(), { source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, d);
    expect(done.status).toBe('completed');
    // a held lock stops a second instance
    await StormLockModel.create({ _id: 'storm-import', holder: 'other-server', expiresAt: new Date(Date.now() + 60_000) });
    const third = await createRun({ source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, d);
    const blocked = await executeRun(third._id.toString(), { source: 'spc', kind: 'range', from: SPC_DAY, to: SPC_DAY }, d);
    expect(blocked.status).toBe('failed');
    expect(blocked.issues[0]?.message).toMatch(/lock/);
  });

  it('hands only newly inserted qualifying events with a point to the alert step, and nothing on a repeat import', async () => {
    const d = deps();
    const seen: string[][] = [];
    const go = async (force: boolean) => {
      const req = { source: 'spc' as const, kind: 'range' as const, from: SPC_DAY, to: SPC_DAY, force };
      const r = await createRun(req, d);
      return executeRun(r._id.toString(), req, d, async (ids) => { seen.push(ids.map(String)); });
    };
    await go(false);
    expect(seen).toHaveLength(1);
    const withPoint = await StormEventModel.countDocuments({ qualifies: true, latitude: { $exists: true } });
    expect(seen[0]).toHaveLength(withPoint);
    expect(withPoint).toBeGreaterThan(0);
    await go(true);
    expect(seen).toHaveLength(1); // the second run inserted nothing, so the alert step is not called
  });

  it('upsert is keyed by source and record id, so a corrected report updates in place', async () => {
    const base = { source: 'ncei' as const, sourceRecordId: 'E1', eventType: 'hail' as const, eventDate: new Date('2024-05-20T20:00:00Z'), eventEndDate: null, hailSizeInches: 1.5, windSpeedMph: null, sourceMagnitude: 1.5, sourceMagnitudeUnit: 'inch' as const, latitude: 32.7, longitude: -96.8, coordinatePrecision: 'exact' as const, locationDescription: 'A', county: 'Dallas', state: 'TX', qualityStatus: 'ok' as const, qualifies: true, sourceRef: 't', meta: {} };
    expect(await upsertEvents([base])).toMatchObject({ inserted: 1, updated: 0 });
    expect(await upsertEvents([base])).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
    expect(await upsertEvents([{ ...base, hailSizeInches: 1.75, sourceMagnitude: 1.75 }])).toMatchObject({ inserted: 0, updated: 1 });
    expect(await StormEventModel.countDocuments({})).toBe(1);
    expect((await StormEventModel.findOne({}))?.hailSizeInches).toBe(1.75);
    // the same id from the other source is a different report
    expect(await upsertEvents([{ ...base, source: 'spc' }])).toMatchObject({ inserted: 1 });
  });

  it('administrators start imports through the API; others cannot; the run is audited and visible', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');
    setIngestDepsForTests(deps());
    expect((await request(app).get('/api/v1/storm/imports').set(h(sales))).status).toBe(403);
    expect((await request(app).post('/api/v1/storm/imports/spc').set(h(sales)).send({ from: SPC_DAY, to: SPC_DAY })).status).toBe(403);
    expect((await request(app).post('/api/v1/storm/imports/backfill').set(h(sales)).send({})).status).toBe(403);
    expect((await request(app).post('/api/v1/storm/imports/spc').set(h(admin)).send({ from: '2024-05-21', to: '2024-05-20' })).status).toBe(400);
    expect((await request(app).post('/api/v1/storm/imports/backfill').set(h(admin)).send({ fromYear: 2005 })).status).toBe(400);
    const started = await request(app).post('/api/v1/storm/imports/spc').set(h(admin)).send({ from: SPC_DAY, to: SPC_DAY });
    expect(started.status).toBe(202);
    await waitForImportsForTests();
    const st = (await request(app).get('/api/v1/storm/imports').set(h(admin))).body.data;
    expect(st.runs[0]).toMatchObject({ source: 'spc', status: 'completed' });
    expect(st.runs[0].counts.inserted).toBeGreaterThan(40);
    expect(st.sources.spc.events).toBeGreaterThan(40);
    expect(st.sources.spc.lastSuccessfulSync).toBeTruthy();
    expect(await AuditLogModel.countDocuments({ action: { $in: ['storm.import_started', 'storm.import_finished'] } })).toBe(2);
  });
});
