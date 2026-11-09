/**
 * NOAA NCEI Storm Events Database, bulk CSV (https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/).
 *
 * Verified against the live files:
 *  - one gzip per data year: StormEvents_details-ftp_v1.0_d{YYYY}_c{YYYYMMDD}.csv.gz (the c-date is the creation date and
 *    changes whenever NCEI adds or corrects records for that year; the directory listing is the only way to learn it)
 *  - 51 columns, including EVENT_ID, EPISODE_ID, STATE (full upper-case name), EVENT_TYPE, CZ_TYPE (C county, Z zone, M marine),
 *    CZ_NAME, BEGIN_DATE_TIME / END_DATE_TIME as `DD-MON-YY HH:MM:SS`, CZ_TIMEZONE (e.g. `CST-6`, a fixed offset from UTC),
 *    MAGNITUDE + MAGNITUDE_TYPE (EG/ES estimated gust/sustained, MG/MS measured gust/sustained), BEGIN_LOCATION,
 *    BEGIN_LAT/BEGIN_LON, END_LAT/END_LON, EPISODE_NARRATIVE, EVENT_NARRATIVE, SOURCE (who reported), DATA_SOURCE.
 *  - Hail MAGNITUDE is in inches. Wind MAGNITUDE is in knots (the 2024 file has 14,787 of 19,940 thunderstorm-wind rows
 *    at 50-59, the NWS 50-knot severe criterion, which only makes sense in knots).
 *  - The data lag real time by roughly 75 to 120 days; recent events come from SPC.
 * Imported event types: Hail and Thunderstorm Wind, plus High Wind and Strong Wind. Marine variants are not imported.
 */
import { createHash } from 'node:crypto';
import { HAIL_MIN_INCHES, KNOTS_TO_MPH, WIND_MIN_MPH, stateCode, type NormalizedEvent } from '../storm.types.js';
import { validLatLng } from '../geo.js';
import { SourceUnavailableError } from './spc.js';

export const NCEI_BASE_URL = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles';
export const NCEI_FIRST_YEAR = 2009;

export const REQUIRED_COLUMNS = ['EVENT_ID', 'STATE', 'EVENT_TYPE', 'CZ_TYPE', 'CZ_NAME', 'BEGIN_DATE_TIME', 'END_DATE_TIME', 'CZ_TIMEZONE', 'MAGNITUDE', 'MAGNITUDE_TYPE', 'BEGIN_LOCATION', 'BEGIN_LAT', 'BEGIN_LON'] as const;

const WIND_TYPES = new Set(['Thunderstorm Wind', 'High Wind', 'Strong Wind']);
const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** `30-APR-24 20:33:00` local standard time at `CST-6` -> UTC instant. */
export function nceiInstant(stamp: string, tz: string): Date | null {
  const m = /^(\d{1,2})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stamp.trim().toUpperCase());
  if (!m) return null;
  const mon = MONTHS[m[2] as string];
  if (mon === undefined) return null;
  const yy = Number(m[3]);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy; // the files start in 1950
  const off = /(-?\d{1,2})$/.exec(tz.trim());
  const offsetHours = off ? Number(off[1]) : 0; // CST-6 means local = UTC - 6
  const utc = Date.UTC(year, mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offsetHours * 3_600_000;
  return Number.isNaN(utc) ? null : new Date(utc);
}

const decimals = (s: string): number => (s.includes('.') ? s.split('.')[1]!.length : 0);

export type NceiRowResult = { event: NormalizedEvent | null; reason?: 'not_relevant' | 'below_threshold' | 'invalid' };

/** Normalizes one details row. Pure. Returns a reason when the row is not imported, so the importer can count it. */
export function normalizeNceiRow(r: Record<string, string>, sourceRef: string): NceiRowResult {
  const type = (r.EVENT_TYPE ?? '').trim();
  const isHail = type === 'Hail';
  const isWind = WIND_TYPES.has(type);
  if (!isHail && !isWind) return { event: null, reason: 'not_relevant' };
  const id = (r.EVENT_ID ?? '').trim();
  const start = nceiInstant(r.BEGIN_DATE_TIME ?? '', r.CZ_TIMEZONE ?? '');
  if (!id || !start) return { event: null, reason: 'invalid' };
  const end = nceiInstant(r.END_DATE_TIME ?? '', r.CZ_TIMEZONE ?? '');
  const rawMag = (r.MAGNITUDE ?? '').trim();
  const mag = rawMag === '' ? null : Number(rawMag);
  if (mag !== null && !Number.isFinite(mag)) return { event: null, reason: 'invalid' };

  let hail: number | null = null;
  let wind: number | null = null;
  let quality: NormalizedEvent['qualityStatus'] = 'ok';
  let unit: NormalizedEvent['sourceMagnitudeUnit'] = null;
  if (isHail) {
    if (mag === null || mag <= 0) return { event: null, reason: 'below_threshold' }; // no size: cannot meet the 1 inch threshold, and none is invented
    hail = mag;
    unit = 'inch';
    if (hail < HAIL_MIN_INCHES) return { event: null, reason: 'below_threshold' };
  } else if (mag === null || mag <= 0) {
    quality = 'speed_unknown';
  } else {
    unit = 'knot';
    wind = Math.round(mag * KNOTS_TO_MPH * 10) / 10;
    if (wind <= WIND_MIN_MPH) return { event: null, reason: 'below_threshold' };
  }

  const latS = (r.BEGIN_LAT ?? '').trim();
  const lngS = (r.BEGIN_LON ?? '').trim();
  const lat = Number(latS);
  const lng = Number(lngS);
  const hasPoint = latS !== '' && lngS !== '' && validLatLng(lat, lng);
  const czType = (r.CZ_TYPE ?? '').trim();
  const county = (r.CZ_NAME ?? '').trim();
  const precision: NormalizedEvent['coordinatePrecision'] = hasPoint
    ? (decimals(latS) >= 3 && decimals(lngS) >= 3 ? 'exact' : 'approximate')
    : czType === 'C' && county ? 'county' : 'none';

  const meta: Record<string, string> = {
    eventId: id,
    episodeId: (r.EPISODE_ID ?? '').trim(),
    eventTypeName: type,
    magnitudeType: (r.MAGNITUDE_TYPE ?? '').trim(),
    reporter: (r.SOURCE ?? '').trim(),
    wfo: (r.WFO ?? '').trim(),
    timezone: (r.CZ_TIMEZONE ?? '').trim(),
    czType,
    narrative: (r.EVENT_NARRATIVE ?? '').trim().slice(0, 600),
  };
  for (const k of Object.keys(meta)) if (meta[k] === '') delete meta[k];
  return {
    event: {
      source: 'ncei',
      sourceRecordId: id,
      eventType: isHail ? 'hail' : 'wind',
      eventDate: start,
      eventEndDate: end,
      hailSizeInches: hail,
      windSpeedMph: wind,
      sourceMagnitude: mag,
      sourceMagnitudeUnit: unit,
      latitude: hasPoint ? lat : null,
      longitude: hasPoint ? lng : null,
      coordinatePrecision: precision,
      locationDescription: (r.BEGIN_LOCATION ?? '').trim(),
      county,
      state: stateCode(r.STATE ?? ''),
      qualityStatus: quality,
      qualifies: isHail ? (hail ?? 0) >= HAIL_MIN_INCHES : (wind ?? 0) > WIND_MIN_MPH,
      sourceRef,
      meta,
    },
  };
}

export type NceiFile = { year: number; name: string; url: string; version: string };

/** Reads the directory listing and returns the newest details file for each year. */
export function parseNceiListing(html: string, base = NCEI_BASE_URL): NceiFile[] {
  const byYear = new Map<number, NceiFile>();
  for (const m of html.matchAll(/StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz/g)) {
    const year = Number(m[1]);
    const version = m[2] as string;
    const cur = byYear.get(year);
    if (!cur || version > cur.version) byYear.set(year, { year, name: m[0], url: `${base}/${m[0]}`, version });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

export async function listNceiFiles(fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>, base = NCEI_BASE_URL): Promise<NceiFile[]> {
  let res;
  try {
    res = await fetchImpl(`${base}/`);
  } catch (err) {
    throw new SourceUnavailableError(`NCEI is unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new SourceUnavailableError(`NCEI directory listing answered HTTP ${res.status}.`, res.status);
  const files = parseNceiListing(await res.text(), base);
  if (files.length === 0) throw new SourceUnavailableError('The NCEI directory listing contained no Storm Events details files (the layout may have changed).');
  return files;
}

/** Stable per-file hash helper used to detect unchanged yearly files in tests. */
export const fileFingerprint = (name: string, version: string): string => createHash('sha1').update(`${name}:${version}`).digest('hex').slice(0, 12);
