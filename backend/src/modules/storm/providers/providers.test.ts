import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bearingDegrees, compass, dayKeyAtOffset, distanceMiles, pointInRing, standardOffsetHours } from '../geo.js';
import { parseCsvText, toRecords, CsvParser } from './csv.js';
import { fetchSpcFile, parseSpcCsv, spcInstant, spcUrl } from './spc.js';
import { nceiInstant, normalizeNceiRow, parseNceiListing, listNceiFiles } from './ncei.js';

// Real, unmodified files published by NOAA SPC for the 2024-05-20 report day (downloaded from spc.noaa.gov), and real
// rows from NCEI's StormEvents_details files for 2009 and 2024. They are samples, not proof of live availability.
const fx = (n: string): string => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

describe('CSV parser', () => {
  it('handles quotes, commas and line breaks inside quoted fields, and chunk boundaries', () => {
    const text = 'a,b,c\n1,"x, ""y""",3\n"multi\nline",5,\n';
    const whole = parseCsvText(text);
    expect(whole).toEqual([['a', 'b', 'c'], ['1', 'x, "y"', '3'], ['multi\nline', '5', '']]);
    const p = new CsvParser();
    const rows: string[][] = [];
    for (const ch of text) rows.push(...p.push(ch)); // one character at a time
    rows.push(...p.end());
    expect(rows).toEqual(whole);
  });
  it('keeps a final row without a newline and tolerates CRLF and a BOM', () => {
    expect(toRecords(parseCsvText(String.fromCharCode(0xfeff) + 'x,y\r\n1,2\r\n3,4'))).toEqual([{ x: '1', y: '2' }, { x: '3', y: '4' }]);
  });
});

describe('SPC parsing (real 2024-05-20 files)', () => {
  const hail = parseSpcCsv(fx('spc_240520_filtered_hail.csv'), 'hail', '2024-05-20', 'test');
  const wind = parseSpcCsv(fx('spc_240520_filtered_wind.csv'), 'wind', '2024-05-20', 'test');

  it('converts hundredths of an inch and applies the 1.00 inch threshold', () => {
    expect(hail.rows).toBeGreaterThan(60);
    expect(hail.events.length + hail.skippedBelowThreshold + hail.skippedInvalid).toBe(hail.rows);
    expect(hail.events.every((e) => (e.hailSizeInches ?? 0) >= 1)).toBe(true);
    const waupun = hail.events.find((e) => e.locationDescription === '2 WSW Waupun');
    expect(waupun).toMatchObject({ hailSizeInches: 1.25, sourceMagnitude: 125, sourceMagnitudeUnit: 'hundredths_inch', county: 'Dodge', state: 'WI', latitude: 43.63, longitude: -88.77, coordinatePrecision: 'approximate', qualifies: true });
  });
  it('keeps UNK wind speed as unknown (never a number) and applies the greater-than-50 mph rule to numbers', () => {
    const unk = wind.events.filter((e) => e.qualityStatus === 'speed_unknown');
    expect(unk.length).toBeGreaterThan(30);
    expect(unk.every((e) => e.windSpeedMph === null && e.sourceMagnitude === null && e.qualifies === false)).toBe(true);
    const measured = wind.events.filter((e) => e.windSpeedMph !== null);
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.every((e) => (e.windSpeedMph as number) > 50 && e.sourceMagnitudeUnit === 'mph' && e.qualifies)).toBe(true);
  });
  it('treats 50 mph as not qualifying and 51 as qualifying', () => {
    const csv = 'Time,Speed,Location,County,State,Lat,Lon,Comments\n1800,50,A,C,TX,32.1,-96.1,\n1801,51,B,C,TX,32.2,-96.2,\n';
    const r = parseSpcCsv(csv, 'wind', '2024-05-20', 't');
    expect(r.events.map((e) => e.windSpeedMph)).toEqual([51]);
    expect(r.skippedBelowThreshold).toBe(1);
  });
  it('places times before 12Z on the next calendar date (report days run 12Z to 12Z)', () => {
    expect(spcInstant('2024-05-20', '1533')?.toISOString()).toBe('2024-05-20T15:33:00.000Z');
    expect(spcInstant('2024-05-20', '0130')?.toISOString()).toBe('2024-05-21T01:30:00.000Z');
    expect(spcInstant('2024-05-20', '2560')).toBeNull();
  });
  it('gives every row a stable, unique id so a re-import cannot duplicate', () => {
    const again = parseSpcCsv(fx('spc_240520_filtered_hail.csv'), 'hail', '2024-05-20', 'other');
    expect(again.events.map((e) => e.sourceRecordId)).toEqual(hail.events.map((e) => e.sourceRecordId));
    expect(new Set(hail.events.map((e) => e.sourceRecordId)).size).toBe(hail.events.length);
  });
  it('rows without a usable point keep county-level precision and no coordinates', () => {
    const csv = 'Time,Size,Location,County,State,Lat,Lon,Comments\n1800,150,Somewhere,Dallas,TX,,,\n1801,150,Nowhere,,TX,0,0,\n';
    const r = parseSpcCsv(csv, 'hail', '2024-05-20', 't');
    expect(r.events[0]).toMatchObject({ latitude: null, longitude: null, coordinatePrecision: 'county' });
    expect(r.events[1]).toMatchObject({ latitude: null, coordinatePrecision: 'none' });
  });
  it('builds the dated filtered-file URL', () => {
    expect(spcUrl('2024-05-20', 'hail')).toBe('https://www.spc.noaa.gov/climo/reports/240520_rpts_filtered_hail.csv');
  });
  it('reports source problems instead of treating them as an empty day', async () => {
    await expect(fetchSpcFile('2024-05-20', 'hail', async () => ({ ok: false, status: 404, text: async () => '' }))).rejects.toMatchObject({ notPublished: true });
    await expect(fetchSpcFile('2024-05-20', 'hail', async () => ({ ok: false, status: 503, text: async () => '' }))).rejects.toThrow(/HTTP 503/);
    await expect(fetchSpcFile('2024-05-20', 'hail', async () => { throw new Error('ECONNRESET'); })).rejects.toThrow(/unreachable/);
    await expect(fetchSpcFile('2024-05-20', 'hail', async () => ({ ok: true, status: 200, text: async () => '<html>maintenance</html>' }))).rejects.toThrow(/expected header/);
    const ok = await fetchSpcFile('2024-05-20', 'hail', async () => ({ ok: true, status: 200, text: async () => fx('spc_240520_filtered_hail.csv') }));
    expect(ok.url).toContain('240520_rpts_filtered_hail.csv');
  });
});

describe('NCEI parsing (real rows from the 2009 and 2024 details files)', () => {
  const rows = toRecords(parseCsvText(fx('ncei_details_sample.csv')));
  const results = rows.map((r) => ({ r, res: normalizeNceiRow(r, 'sample') }));
  const events = results.flatMap((x) => (x.res.event ? [x.res.event] : []));

  it('reads the real column layout', () => {
    expect(rows.length).toBeGreaterThan(15);
    for (const c of ['EVENT_ID', 'BEGIN_DATE_TIME', 'CZ_TIMEZONE', 'MAGNITUDE', 'MAGNITUDE_TYPE', 'BEGIN_LAT', 'EVENT_NARRATIVE']) expect(Object.keys(rows[0]!)).toContain(c);
  });
  it('imports hail in inches and wind converted from knots, keeping the original value and unit', () => {
    const wind = events.filter((e) => e.eventType === 'wind');
    expect(wind.length).toBeGreaterThan(3);
    for (const e of wind) {
      expect(e.sourceMagnitudeUnit).toBe('knot');
      expect(e.windSpeedMph).toBeCloseTo((e.sourceMagnitude as number) * 1.150779, 1);
      expect(e.windSpeedMph as number).toBeGreaterThan(50);
    }
    const hail = events.filter((e) => e.eventType === 'hail');
    expect(hail.length).toBeGreaterThan(3);
    for (const e of hail) {
      expect(e.sourceMagnitudeUnit).toBe('inch');
      expect(e.hailSizeInches).toBe(e.sourceMagnitude);
      expect(e.hailSizeInches as number).toBeGreaterThanOrEqual(1);
    }
  });
  it('applies thresholds: hail under 1 inch and wind of 43 knots or less are not imported; other event types and marine are ignored', () => {
    const reasons = results.map((x) => x.res.reason).filter(Boolean);
    expect(reasons).toContain('below_threshold');
    expect(reasons).toContain('not_relevant');
    for (const x of results) {
      if (x.r.EVENT_TYPE === 'Hail' && Number(x.r.MAGNITUDE) < 1) expect(x.res.event).toBeNull();
      if (x.r.EVENT_TYPE === 'Thunderstorm Wind' && Number(x.r.MAGNITUDE) <= 43) expect(x.res.event).toBeNull();
      if ((x.r.EVENT_TYPE ?? '').startsWith('Marine') || x.r.EVENT_TYPE === 'Tornado') expect(x.res.event).toBeNull();
    }
    // 44 knots = 50.6 mph is the lowest whole-knot value above 50 mph
    expect(normalizeNceiRow({ ...rows.find((r) => r.EVENT_TYPE === 'Thunderstorm Wind')!, MAGNITUDE: '43.00' }, 's').event).toBeNull();
    expect(normalizeNceiRow({ ...rows.find((r) => r.EVENT_TYPE === 'Thunderstorm Wind')!, MAGNITUDE: '44.00' }, 's').event?.windSpeedMph).toBeCloseTo(50.6, 1);
  });
  it('keeps coordinates, precision, county, state abbreviation, begin/end times, narrative and source ids', () => {
    const e = events.find((x) => x.sourceRecordId === '1174463') ?? events[0]!;
    expect(e.latitude).not.toBeNull();
    expect(['exact', 'approximate']).toContain(e.coordinatePrecision);
    expect(e.state).toMatch(/^[A-Z]{2}$/);
    expect(e.county).not.toBe('');
    expect(e.eventEndDate).not.toBeNull();
    expect(e.meta.eventId).toBe(e.sourceRecordId);
    expect(e.meta.narrative).toBeDefined();
  });
  it('converts local standard time with the CZ_TIMEZONE offset to UTC', () => {
    expect(nceiInstant('30-APR-24 20:33:00', 'CST-6')?.toISOString()).toBe('2024-05-01T02:33:00.000Z');
    expect(nceiInstant('14-MAY-09 01:00:00', 'EST-5')?.toISOString()).toBe('2009-05-14T06:00:00.000Z');
    expect(nceiInstant('garbage', 'CST-6')).toBeNull();
  });
  it('4-decimal coordinates are exact, 2-decimal are approximate, none falls back to county or none', () => {
    const base = rows.find((r) => r.EVENT_TYPE === 'Hail' && Number(r.MAGNITUDE) >= 1)!;
    expect(normalizeNceiRow({ ...base, BEGIN_LAT: '34.3444', BEGIN_LON: '-98.983' }, 's').event?.coordinatePrecision).toBe('exact');
    expect(normalizeNceiRow({ ...base, BEGIN_LAT: '34.18', BEGIN_LON: '-89.03' }, 's').event?.coordinatePrecision).toBe('approximate');
    const county = normalizeNceiRow({ ...base, BEGIN_LAT: '', BEGIN_LON: '', CZ_TYPE: 'C' }, 's').event;
    expect(county).toMatchObject({ coordinatePrecision: 'county', latitude: null, longitude: null });
    expect(normalizeNceiRow({ ...base, BEGIN_LAT: '', BEGIN_LON: '', CZ_TYPE: 'Z', CZ_NAME: '' }, 's').event?.coordinatePrecision).toBe('none');
  });
  it('wind rows without a magnitude are kept as speed unknown, never given a speed', () => {
    const w = rows.find((r) => r.EVENT_TYPE === 'Thunderstorm Wind')!;
    const e = normalizeNceiRow({ ...w, MAGNITUDE: '', MAGNITUDE_TYPE: '' }, 's').event!;
    expect(e).toMatchObject({ windSpeedMph: null, sourceMagnitude: null, qualityStatus: 'speed_unknown', qualifies: false });
  });
  it('rejects rows with a bad id, date or number', () => {
    const w = rows.find((r) => r.EVENT_TYPE === 'Hail')!;
    expect(normalizeNceiRow({ ...w, EVENT_ID: '' }, 's').reason).toBe('invalid');
    expect(normalizeNceiRow({ ...w, BEGIN_DATE_TIME: '2024-05-01' }, 's').reason).toBe('invalid');
    expect(normalizeNceiRow({ ...w, MAGNITUDE: 'abc' }, 's').reason).toBe('invalid');
  });
  it('picks the newest file per year from the directory listing and fails loudly when the layout changes', async () => {
    const html = '<a href="StormEvents_details-ftp_v1.0_d2024_c20250101.csv.gz">x</a><a href="StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz">x</a><a href="StormEvents_details-ftp_v1.0_d2009_c20260323.csv.gz">y</a><a href="StormEvents_locations-ftp_v1.0_d2024_c20260728.csv.gz">z</a>';
    expect(parseNceiListing(html).map((f) => [f.year, f.version])).toEqual([[2009, '20260323'], [2024, '20260728']]);
    await expect(listNceiFiles(async () => ({ ok: true, status: 200, text: async () => '<html>nothing</html>' }))).rejects.toThrow(/no Storm Events/);
    await expect(listNceiFiles(async () => ({ ok: false, status: 500, text: async () => '' }))).rejects.toThrow(/HTTP 500/);
  });
});

describe('geodesy', () => {
  const dallas = { lat: 32.7767, lng: -96.797 };
  const houston = { lat: 29.7604, lng: -95.3698 };
  it('computes great-circle distance, bearing and compass direction', () => {
    expect(distanceMiles(dallas, houston)).toBeGreaterThan(223);
    expect(distanceMiles(dallas, houston)).toBeLessThan(226);
    expect(distanceMiles(dallas, dallas)).toBe(0);
    expect(compass(bearingDegrees(dallas, houston))).toBe('SSE');
    expect(compass(bearingDegrees(houston, dallas))).toBe('NNW');
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
  });
  it('one degree of latitude is about 69 miles', () => {
    expect(distanceMiles({ lat: 30, lng: -97 }, { lat: 31, lng: -97 })).toBeCloseTo(69.09, 1);
  });
  it('point in polygon and standard-time day buckets', () => {
    const ring: Array<[number, number]> = [[-97, 32], [-96, 32], [-96, 33], [-97, 33]];
    expect(pointInRing({ lat: 32.5, lng: -96.5 }, ring)).toBe(true);
    expect(pointInRing({ lat: 33.5, lng: -96.5 }, ring)).toBe(false);
    expect(standardOffsetHours(-96.8)).toBe(-6);
    expect(dayKeyAtOffset(new Date('2024-05-21T02:33:00Z'), -6)).toBe('2024-05-20');
  });
});
