/**
 * NOAA Storm Prediction Center daily storm reports (https://www.spc.noaa.gov/climo/reports/).
 *
 * Verified against the live files:
 *  - dated files:   {base}/{YYMMDD}_rpts_filtered_{hail|wind}.csv  (also _rpts_{hail|wind}.csv unfiltered; today_ / yesterday_ aliases)
 *  - header:        Hail  `Time,Size,Location,County,State,Lat,Lon,Comments`
 *                   Wind  `Time,Speed,Location,County,State,Lat,Lon,Comments`
 *  - Time is HHMM in UTC. A report day runs 1200 UTC on the date in the file name to 1159 UTC the next day,
 *    so a time before 1200 belongs to the next calendar date.
 *  - Size is in hundredths of an inch (175 = 1.75"). Speed is in mph, or UNK when only damage was reported.
 *  - Lat/Lon are decimal degrees to two decimals. Reports are preliminary.
 * The "filtered" files are SPC's own de-duplicated severe-report lists, so they are the ones imported.
 */
import { createHash } from 'node:crypto';
import { HAIL_MIN_INCHES, WIND_MIN_MPH, type NormalizedEvent, type StormEventType } from '../storm.types.js';
import { BOM_RE, parseCsvText, toRecords } from './csv.js';
import { validLatLng } from '../geo.js';

export const SPC_BASE_URL = 'https://www.spc.noaa.gov/climo/reports';

/** `2024-05-20` -> `240520`. */
export const spcDayCode = (dayKey: string): string => dayKey.slice(2).replace(/-/g, '');

export function spcUrl(dayKey: string, kind: StormEventType, base = SPC_BASE_URL): string {
  return `${base}/${spcDayCode(dayKey)}_rpts_filtered_${kind}.csv`;
}

export type ParseResult = { events: NormalizedEvent[]; rows: number; skippedBelowThreshold: number; skippedInvalid: number };

/** Convective day + HHMM UTC to an instant. */
export function spcInstant(dayKey: string, hhmm: string): Date | null {
  const t = hhmm.trim().padStart(4, '0');
  if (!/^\d{4}$/.test(t)) return null;
  const h = Number(t.slice(0, 2));
  const m = Number(t.slice(2));
  if (h > 23 || m > 59) return null;
  const d = new Date(`${dayKey}T${t.slice(0, 2)}:${t.slice(2)}:00Z`);
  if (h < 12) d.setUTCDate(d.getUTCDate() + 1);
  return Number.isNaN(d.getTime()) ? null : d;
}

const decimals = (s: string): number => (s.includes('.') ? s.split('.')[1]!.length : 0);

/** Parses one SPC CSV (hail or wind) for the given report day. Pure: no network, no database. */
export function parseSpcCsv(text: string, kind: StormEventType, dayKey: string, sourceRef: string): ParseResult {
  const records = toRecords(parseCsvText(text));
  const events: NormalizedEvent[] = [];
  let skippedBelowThreshold = 0;
  let skippedInvalid = 0;
  const seen = new Map<string, number>();
  for (const r of records) {
    const instant = spcInstant(dayKey, r.Time ?? '');
    const raw = (kind === 'hail' ? r.Size : r.Speed) ?? '';
    if (!instant) { skippedInvalid += 1; continue; }
    let hail: number | null = null;
    let wind: number | null = null;
    let magnitude: number | null = null;
    let quality: NormalizedEvent['qualityStatus'] = 'ok';
    if (kind === 'hail') {
      const t = raw.trim();
      if (!/^\d+$/.test(t) || Number(t) <= 0) { skippedInvalid += 1; continue; } // a hail report without a size cannot meet the 1 inch threshold
      magnitude = Number(t);
      hail = magnitude / 100;
      if (hail < HAIL_MIN_INCHES) { skippedBelowThreshold += 1; continue; }
    } else {
      const t = raw.trim().toUpperCase();
      if (t === 'UNK' || t === '') quality = 'speed_unknown';
      else {
        const n = Number(t);
        if (!Number.isFinite(n) || n <= 0) { skippedInvalid += 1; continue; }
        magnitude = n;
        wind = n;
        if (wind <= WIND_MIN_MPH) { skippedBelowThreshold += 1; continue; }
      }
    }
    const lat = Number((r.Lat ?? '').trim());
    const lng = Number((r.Lon ?? '').trim());
    const hasPoint = (r.Lat ?? '').trim() !== '' && validLatLng(lat, lng);
    const precision = hasPoint ? (decimals(r.Lat ?? '') >= 3 && decimals(r.Lon ?? '') >= 3 ? 'exact' : 'approximate') : (r.County ?? '').trim() ? 'county' : 'none';
    // SPC publishes no record id: derive a stable one from the report itself. Identical rows in one file get a counter.
    const base = [dayKey, kind, (r.Time ?? '').trim(), raw.trim(), (r.Lat ?? '').trim(), (r.Lon ?? '').trim(), (r.Location ?? '').trim(), (r.State ?? '').trim()].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = `${dayKey.replace(/-/g, '')}-${kind}-${createHash('sha1').update(base).digest('hex').slice(0, 16)}${n > 1 ? `-${n}` : ''}`;
    const comments = (r.Comments ?? '').trim();
    events.push({
      source: 'spc',
      sourceRecordId: id,
      eventType: kind,
      eventDate: instant,
      eventEndDate: null,
      hailSizeInches: hail,
      windSpeedMph: wind,
      sourceMagnitude: magnitude,
      sourceMagnitudeUnit: kind === 'hail' ? 'hundredths_inch' : magnitude === null ? null : 'mph',
      latitude: hasPoint ? lat : null,
      longitude: hasPoint ? lng : null,
      coordinatePrecision: precision,
      locationDescription: (r.Location ?? '').trim(),
      county: (r.County ?? '').trim(),
      state: (r.State ?? '').trim().toUpperCase(),
      qualityStatus: quality,
      qualifies: kind === 'hail' ? (hail ?? 0) >= HAIL_MIN_INCHES : (wind ?? 0) > WIND_MIN_MPH,
      sourceRef,
      meta: { reportDay: dayKey, ...(comments ? { comments: comments.slice(0, 500) } : {}) },
    });
  }
  return { events, rows: records.length, skippedBelowThreshold, skippedInvalid };
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export class SourceUnavailableError extends Error {
  constructor(message: string, readonly status?: number, readonly notPublished = false) { super(message); }
}

/** Downloads one SPC file. A 404 means SPC has no file for that day (reported as notPublished, never as success). */
export async function fetchSpcFile(dayKey: string, kind: StormEventType, fetchImpl: FetchLike, base?: string): Promise<{ text: string; url: string }> {
  const url = spcUrl(dayKey, kind, base);
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new SourceUnavailableError(`SPC is unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 404) throw new SourceUnavailableError(`SPC has no ${kind} file for ${dayKey}.`, 404, true);
  if (!res.ok) throw new SourceUnavailableError(`SPC answered HTTP ${res.status} for ${url}.`, res.status);
  const text = await res.text();
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const expected = kind === 'hail' ? 'Time,Size,Location,County,State,Lat,Lon,Comments' : 'Time,Speed,Location,County,State,Lat,Lon,Comments';
  if (first.replace(BOM_RE, '').trim() !== expected) throw new SourceUnavailableError(`SPC file ${url} does not have the expected header (got "${first.slice(0, 80)}").`);
  return { text, url };
}
