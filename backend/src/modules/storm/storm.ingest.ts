/**
 * Storm report ingestion: idempotent, resumable, batch-wise. Source specifics live in providers/; this file only
 * orchestrates units (NCEI data years, SPC report days), counts, locks and run bookkeeping.
 */
import { randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { Types } from 'mongoose';
import { recordAudit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import { addDaysKey } from './geo.js';
import { BOM_RE, CsvParser } from './providers/csv.js';
import { NCEI_BASE_URL, NCEI_FIRST_YEAR, REQUIRED_COLUMNS, listNceiFiles, normalizeNceiRow, type NceiFile } from './providers/ncei.js';
import { SPC_BASE_URL, SourceUnavailableError, fetchSpcFile, parseSpcCsv, type FetchLike } from './providers/spc.js';
import { StormEventModel, StormImportRunModel, StormImportUnitModel, StormLockModel, type StormImportRunDocument } from './storm.model.js';
import type { NormalizedEvent, StormSource } from './storm.types.js';

let log: Logger | undefined;
const getLog = (): Logger => (log ??= createLogger());

export type IngestDeps = {
  fetchText: FetchLike;
  /** Opens a gzip file and returns its decompressed text as a stream. */
  openGzipText: (url: string) => Promise<Readable>;
  spcBase?: string;
  nceiBase?: string;
  now?: () => Date;
};

export function defaultDeps(): IngestDeps {
  return {
    fetchText: async (url, init) => fetch(url, { signal: init?.signal, headers: { 'User-Agent': 'LegacyRoofingCRM storm-ingest (contact: office)' } }),
    openGzipText: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000), headers: { 'User-Agent': 'LegacyRoofingCRM storm-ingest (contact: office)' } });
      if (!res.ok || !res.body) throw new SourceUnavailableError(`NCEI answered HTTP ${res.status} for ${url}.`, res.status);
      return Readable.fromWeb(res.body as never).pipe(createGunzip());
    },
  };
}

export type Counts = { rows: number; inserted: number; updated: number; skipped: number; belowThreshold: number; invalid: number };
const zero = (): Counts => ({ rows: 0, inserted: 0, updated: 0, skipped: 0, belowThreshold: 0, invalid: 0 });
const add = (a: Counts, b: Partial<Counts>): void => { for (const k of Object.keys(a) as Array<keyof Counts>) a[k] += b[k] ?? 0; };

// ------------------------------------------------------------------ storing events

const BATCH = 500;

function toDoc(e: NormalizedEvent): Record<string, unknown> {
  const set: Record<string, unknown> = {
    eventType: e.eventType,
    eventDate: e.eventDate,
    hailSizeInches: e.hailSizeInches ?? undefined,
    windSpeedMph: e.windSpeedMph ?? undefined,
    sourceMagnitude: e.sourceMagnitude ?? undefined,
    sourceMagnitudeUnit: e.sourceMagnitudeUnit ?? undefined,
    coordinatePrecision: e.coordinatePrecision,
    locationDescription: e.locationDescription,
    county: e.county,
    state: e.state,
    qualityStatus: e.qualityStatus,
    qualifies: e.qualifies,
    sourceRef: e.sourceRef,
    rawSourceMetadata: e.meta,
  };
  if (e.eventEndDate) set.eventEndDate = e.eventEndDate;
  if (e.latitude !== null && e.longitude !== null) {
    set.latitude = e.latitude;
    set.longitude = e.longitude;
    set.location = { type: 'Point', coordinates: [e.longitude, e.latitude] };
  }
  for (const k of Object.keys(set)) if (set[k] === undefined) delete set[k];
  return set;
}

/** Upserts by (source, sourceRecordId). Running it twice on the same data inserts nothing the second time. */
export async function upsertEvents(events: NormalizedEvent[]): Promise<{ inserted: number; updated: number; skipped: number; insertedQualifyingIds: Types.ObjectId[] }> {
  let inserted = 0, updated = 0, skipped = 0;
  const ids: Types.ObjectId[] = [];
  const importedAt = new Date();
  for (let i = 0; i < events.length; i += BATCH) {
    const slice = events.slice(i, i + BATCH);
    const res = await StormEventModel.bulkWrite(
      slice.map((e) => ({ updateOne: { filter: { source: e.source, sourceRecordId: e.sourceRecordId }, update: { $set: toDoc(e), $setOnInsert: { source: e.source, sourceRecordId: e.sourceRecordId, importedAt } }, upsert: true } })),
      { ordered: false },
    );
    inserted += res.upsertedCount;
    updated += res.modifiedCount;
    skipped += res.matchedCount - res.modifiedCount;
    for (const [idx, id] of Object.entries(res.upsertedIds)) {
      const ev = slice[Number(idx)];
      if (ev?.qualifies && ev.latitude !== null) ids.push(id as Types.ObjectId);
    }
  }
  return { inserted, updated, skipped, insertedQualifyingIds: ids };
}

// ------------------------------------------------------------------ units

type RunCtx = { run: StormImportRunDocument; counts: Counts; newIds: Types.ObjectId[] };

async function importSpcDay(dayKey: string, deps: IngestDeps, ctx: RunCtx): Promise<Counts> {
  const counts = zero();
  const kinds = ['hail', 'wind'] as const;
  let published = 0;
  let lastErr: SourceUnavailableError | null = null;
  for (const kind of kinds) {
    let file;
    try {
      file = await fetchSpcFile(dayKey, kind, deps.fetchText, deps.spcBase ?? SPC_BASE_URL);
    } catch (err) {
      if (err instanceof SourceUnavailableError) { lastErr = err; if (err.notPublished) continue; throw err; }
      throw err;
    }
    published += 1;
    const parsed = parseSpcCsv(file.text, kind, dayKey, file.url);
    const r = await upsertEvents(parsed.events);
    add(counts, { rows: parsed.rows, inserted: r.inserted, updated: r.updated, skipped: r.skipped, belowThreshold: parsed.skippedBelowThreshold, invalid: parsed.skippedInvalid });
    ctx.newIds.push(...r.insertedQualifyingIds);
  }
  if (published === 0) throw lastErr ?? new SourceUnavailableError(`SPC has no files for ${dayKey}.`, 404, true);
  return counts;
}

async function importNceiYear(file: NceiFile, deps: IngestDeps, ctx: RunCtx, heartbeat: () => Promise<void>): Promise<Counts> {
  const counts = zero();
  const stream = await deps.openGzipText(file.url);
  const decoder = new StringDecoder('utf8');
  const parser = new CsvParser();
  let header: string[] | null = null;
  let batch: NormalizedEvent[] = [];
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const r = await upsertEvents(batch);
    add(counts, { inserted: r.inserted, updated: r.updated, skipped: r.skipped });
    ctx.newIds.push(...r.insertedQualifyingIds);
    batch = [];
    await heartbeat();
  };
  const handle = async (rows: string[][]): Promise<void> => {
    for (const row of rows) {
      if (!header) {
        header = row.map((h, i) => (i === 0 ? h.replace(BOM_RE, '') : h).trim());
        const missing = REQUIRED_COLUMNS.filter((c) => !header!.includes(c));
        if (missing.length > 0) throw new SourceUnavailableError(`NCEI file ${file.name} is missing expected columns (${missing.join(', ')}); the format may have changed.`);
        continue;
      }
      counts.rows += 1;
      const rec: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) rec[header[i] as string] = row[i] ?? '';
      const res = normalizeNceiRow(rec, file.url);
      if (res.event) batch.push(res.event);
      else if (res.reason === 'below_threshold') counts.belowThreshold += 1;
      else if (res.reason === 'invalid') counts.invalid += 1;
      if (batch.length >= BATCH) await flush();
    }
  };
  for await (const chunk of stream) {
    await handle(parser.push(decoder.write(chunk as Buffer)));
  }
  await handle(parser.push(decoder.end()));
  await handle(parser.end());
  if (!header) throw new SourceUnavailableError(`NCEI file ${file.name} was empty.`);
  await flush();
  return counts;
}

// ------------------------------------------------------------------ locking

const LOCK_ID = 'storm-import';
const LOCK_MS = 15 * 60_000;

async function acquireLock(holder: string): Promise<boolean> {
  const now = new Date();
  try {
    const r = await StormLockModel.findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ expiresAt: { $lt: now } }, { holder }] },
      { $set: { holder, expiresAt: new Date(now.getTime() + LOCK_MS) } },
      { upsert: true, new: true },
    );
    return r?.holder === holder;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // another holder owns an unexpired lock
    throw err;
  }
}
const extendLock = (holder: string): Promise<unknown> => StormLockModel.updateOne({ _id: LOCK_ID, holder }, { $set: { expiresAt: new Date(Date.now() + LOCK_MS) } });
const releaseLock = (holder: string): Promise<unknown> => StormLockModel.deleteOne({ _id: LOCK_ID, holder });

// ------------------------------------------------------------------ runs

export type RunRequest =
  | { source: 'ncei'; kind: 'backfill'; fromYear?: number; toYear?: number; force?: boolean; userId?: string }
  | { source: 'spc'; kind: 'range'; from: string; to: string; force?: boolean; userId?: string }
  | { source: 'all'; kind: 'daily'; userId?: string };

const nowOf = (d: IngestDeps): Date => (d.now ? d.now() : new Date());
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

/** SPC report day containing this instant (a day runs 12Z to 12Z). */
export const convectiveDay = (now: Date): string => {
  const d = new Date(now);
  if (d.getUTCHours() < 12) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysKey(d, 1)) { out.push(d); if (out.length > 3700) break; }
  return out;
}

export async function createRun(req: RunRequest, deps: IngestDeps): Promise<StormImportRunDocument> {
  await markStaleRuns(nowOf(deps));
  const running = await StormImportRunModel.findOne({ status: 'running' });
  if (running) throw new AppError({ status: 409, code: 'IMPORT_RUNNING', message: 'An import is already running. Wait for it to finish, or check its progress on this page.' });
  if (req.kind === 'range') {
    if (!isDay(req.from) || !isDay(req.to) || req.from > req.to) throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'Give a valid date range (from is not after to).' });
    if (daysBetween(req.from, req.to).length > 3650) throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'An SPC range is limited to 10 years per run.' });
  }
  const nowY = nowOf(deps).getUTCFullYear();
  const run = await StormImportRunModel.create({
    source: req.source,
    kind: req.kind,
    rangeFrom: req.kind === 'range' ? req.from : req.kind === 'backfill' ? String(req.fromYear ?? NCEI_FIRST_YEAR) : undefined,
    rangeTo: req.kind === 'range' ? req.to : req.kind === 'backfill' ? String(req.toYear ?? nowY) : undefined,
    status: 'running',
    startedBy: req.userId,
    startedAt: nowOf(deps),
    heartbeatAt: nowOf(deps),
  });
  await recordAudit({ actorType: req.userId ? 'user' : 'system', actorId: req.userId, action: 'storm.import_started', entityType: 'storm_import', entityId: run._id.toString(), changes: req }).catch(() => undefined);
  return run;
}

/** Marks runs that stopped heart-beating (process killed) as failed so a new run can resume their remaining units. */
export async function markStaleRuns(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 20 * 60_000);
  await StormImportRunModel.updateMany({ status: 'running', heartbeatAt: { $lt: cutoff } }, { $set: { status: 'failed', finishedAt: now }, $push: { issues: { unit: '-', message: 'The server stopped while this import was running. Start it again to continue from where it stopped.', at: new Date() } } });
}

async function recordUnit(source: StormSource, unitKey: string, patch: Record<string, unknown>): Promise<void> {
  await StormImportUnitModel.updateOne({ source, unitKey }, { $set: patch, $inc: { attempts: 1 } }, { upsert: true });
}

/** Runs a prepared run to the end. Never throws for a unit failure: the run records it and carries on with the next unit. */
export async function executeRun(runId: string, req: RunRequest, deps: IngestDeps, afterNewEvents?: (ids: Types.ObjectId[]) => Promise<void>): Promise<StormImportRunDocument> {
  const run = (await StormImportRunModel.findById(runId))!;
  const holder = randomUUID();
  if (!(await acquireLock(holder))) {
    run.status = 'failed';
    run.finishedAt = new Date();
    run.issues.push({ unit: '-', message: 'Another import holds the lock.', at: new Date() });
    await run.save();
    return run;
  }
  const ctx: RunCtx = { run, counts: zero(), newIds: [] };
  const beat = async (): Promise<void> => { await Promise.all([StormImportRunModel.updateOne({ _id: run._id }, { $set: { heartbeatAt: new Date() } }), extendLock(holder)]); };
  const fail = async (unit: string, message: string): Promise<void> => {
    run.issues.push({ unit, message: message.slice(0, 400), at: new Date() });
    if (run.issues.length > 50) run.issues.splice(0, run.issues.length - 50);
    await run.save();
  };
  try {
    // ---- plan
    type Unit = { source: StormSource; key: string; kind: 'ncei' | 'spc'; file?: NceiFile; day?: string; always?: boolean };
    const units: Unit[] = [];
    let listingError: string | null = null;
    if (req.source === 'ncei' || req.source === 'all') {
      const nowY = nowOf(deps).getUTCFullYear();
      const fromY = req.kind === 'backfill' ? req.fromYear ?? NCEI_FIRST_YEAR : nowY;
      const toY = req.kind === 'backfill' ? req.toYear ?? nowY : nowY;
      try {
        const files = await listNceiFiles(async (u) => deps.fetchText(u), deps.nceiBase ?? NCEI_BASE_URL);
        for (let y = fromY; y <= toY; y++) {
          const f = files.find((x) => x.year === y);
          if (f) units.push({ source: 'ncei', key: `ncei:${y}`, kind: 'ncei', file: f });
          else { units.push({ source: 'ncei', key: `ncei:${y}`, kind: 'ncei' }); }
        }
      } catch (err) {
        listingError = err instanceof Error ? err.message : String(err);
      }
    }
    if (req.source === 'spc' || req.source === 'all') {
      let from: string, to: string;
      if (req.kind === 'range') { from = req.from; to = req.to; }
      else { to = convectiveDay(nowOf(deps)); from = addDaysKey(to, -2); }
      for (const d of daysBetween(from, to)) units.push({ source: 'spc', key: `spc:${d}`, kind: 'spc', day: d, always: req.kind === 'daily' || d >= addDaysKey(convectiveDay(nowOf(deps)), -3) });
    }
    run.unitsTotal = units.length + (listingError ? 1 : 0);
    await run.save();
    if (listingError) { run.unitsFailed += 1; await fail('ncei:listing', listingError); }

    // ---- execute
    for (const u of units) {
      run.current = u.key;
      await beat();
      const existing = await StormImportUnitModel.findOne({ source: u.source, unitKey: u.key });
      const force = 'force' in req && req.force === true;
      const fresh = existing?.status === 'done' && !force && !u.always && (u.kind === 'spc' || existing.sourceVersion === u.file?.version);
      if (fresh) { run.unitsSkipped += 1; run.unitsDone += 1; await run.save(); continue; }
      try {
        let c: Counts;
        if (u.kind === 'ncei') {
          if (!u.file) throw new SourceUnavailableError(`NCEI has no Storm Events file for ${u.key.slice(5)} yet.`, 404, true);
          c = await importNceiYear(u.file, deps, ctx, beat);
        } else c = await importSpcDay(u.day as string, deps, ctx);
        add(ctx.counts, c);
        await recordUnit(u.source, u.key, { status: 'done', sourceVersion: u.file?.version ?? '', counts: c, lastError: '', completedAt: nowOf(deps), lastRunId: run._id });
        run.unitsDone += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const unavailable = err instanceof SourceUnavailableError && err.notPublished;
        await recordUnit(u.source, u.key, { status: unavailable ? 'unavailable' : 'failed', lastError: message.slice(0, 400), lastRunId: run._id });
        if (unavailable) run.unitsUnavailable += 1; else run.unitsFailed += 1;
        await fail(u.key, message);
        getLog().warn({ unit: u.key, message }, 'Storm import unit failed');
      }
      run.counts = ctx.counts;
      run.newQualifyingEventIds = ctx.newIds.slice(0, 5000);
      await run.save();
    }
    run.current = '';
    run.status = run.unitsFailed > 0 || run.unitsUnavailable > 0 ? (run.unitsDone === 0 ? 'failed' : 'completed_with_errors') : 'completed';
  } catch (err) {
    run.status = 'failed';
    await fail('-', err instanceof Error ? err.message : String(err));
  } finally {
    run.finishedAt = new Date();
    run.counts = ctx.counts;
    run.newQualifyingEventIds = ctx.newIds.slice(0, 5000);
    await run.save();
    await releaseLock(holder);
  }
  await recordAudit({ actorType: run.startedBy ? 'user' : 'system', actorId: run.startedBy?.toString(), action: 'storm.import_finished', entityType: 'storm_import', entityId: run._id.toString(), changes: { status: run.status, counts: run.counts, failed: run.unitsFailed, unavailable: run.unitsUnavailable } }).catch(() => undefined);
  if (afterNewEvents && ctx.newIds.length > 0) {
    try { await afterNewEvents(ctx.newIds); } catch (err) { getLog().error({ err }, 'Storm alert evaluation failed after import'); }
  }
  return run;
}

// ------------------------------------------------------------------ status

export async function importStatus(deps?: Pick<IngestDeps, 'now'>) {
  await markStaleRuns(deps?.now ? deps.now() : new Date());
  const nowY = (deps?.now ? deps.now() : new Date()).getUTCFullYear();
  const [runs, units, counts, running] = await Promise.all([
    StormImportRunModel.find({}).sort({ startedAt: -1 }).limit(10).lean(),
    StormImportUnitModel.find({}).select('source unitKey status sourceVersion completedAt lastError counts attempts').lean(),
    StormEventModel.aggregate<{ _id: string; n: number; first: Date; last: Date }>([{ $group: { _id: '$source', n: { $sum: 1 }, first: { $min: '$eventDate' }, last: { $max: '$eventDate' } } }]),
    StormImportRunModel.findOne({ status: 'running' }).lean(),
  ]);
  const bySource = (s: StormSource) => units.filter((u) => u.source === s);
  const lastDone = (s: StormSource): Date | null => bySource(s).filter((u) => u.status === 'done' && u.completedAt).map((u) => u.completedAt as Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const nceiYears = bySource('ncei');
  const requested: number[] = [];
  for (let y = NCEI_FIRST_YEAR; y <= nowY; y++) requested.push(y);
  const doneYears = new Set(nceiYears.filter((u) => u.status === 'done').map((u) => Number(u.unitKey.slice(5))));
  const missing = requested.filter((y) => !doneYears.has(y));
  const spc = bySource('spc');
  return {
    running: running ? { id: String(running._id), source: running.source, current: running.current, unitsDone: running.unitsDone, unitsTotal: running.unitsTotal } : null,
    sources: {
      ncei: {
        label: 'NOAA NCEI Storm Events (historical, from 2009)',
        lastSuccessfulSync: lastDone('ncei')?.toISOString() ?? null,
        yearsImported: [...doneYears].sort((a, b) => a - b),
        yearsMissing: missing,
        backfillComplete: missing.length === 0,
        failedUnits: nceiYears.filter((u) => u.status === 'failed' || u.status === 'unavailable').map((u) => ({ unit: u.unitKey, status: u.status, error: u.lastError })),
        events: counts.find((c) => c._id === 'ncei')?.n ?? 0,
        earliestEvent: counts.find((c) => c._id === 'ncei')?.first?.toISOString() ?? null,
        latestEvent: counts.find((c) => c._id === 'ncei')?.last?.toISOString() ?? null,
      },
      spc: {
        label: 'NOAA SPC daily storm reports (hail and wind)',
        lastSuccessfulSync: lastDone('spc')?.toISOString() ?? null,
        daysImported: spc.filter((u) => u.status === 'done').length,
        failedUnits: spc.filter((u) => u.status === 'failed' || u.status === 'unavailable').slice(0, 20).map((u) => ({ unit: u.unitKey, status: u.status, error: u.lastError })),
        events: counts.find((c) => c._id === 'spc')?.n ?? 0,
        earliestEvent: counts.find((c) => c._id === 'spc')?.first?.toISOString() ?? null,
        latestEvent: counts.find((c) => c._id === 'spc')?.last?.toISOString() ?? null,
      },
    },
    runs: runs.map((r) => ({ id: String(r._id), source: r.source, kind: r.kind, rangeFrom: r.rangeFrom ?? null, rangeTo: r.rangeTo ?? null, status: r.status, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, unitsTotal: r.unitsTotal, unitsDone: r.unitsDone, unitsFailed: r.unitsFailed, unitsUnavailable: r.unitsUnavailable, unitsSkipped: r.unitsSkipped, counts: r.counts, errors: r.issues.slice(-5).map((e) => ({ unit: e.unit, message: e.message, at: e.at?.toISOString() })) })),
    note: 'A source is only reported as fully backfilled when every requested year has been imported without error.',
  };
}
