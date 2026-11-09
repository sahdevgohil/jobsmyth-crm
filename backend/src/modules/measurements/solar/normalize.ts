import type { GoogleBuildingInsights, GoogleDate, ImageryQuality, LatLng } from './google-solar.adapter.js';
import { SolarError } from './errors.js';
import { compassFromAzimuth, m2ToSqFt, pitchLabelFromDegrees, pitchRatioFromDegrees, round, sqFtToSquares } from './geo.js';

export type NormalizedSegment = {
  id: string;
  providerIndex: number;
  areaM2: number;
  areaSqFt: number;
  squares: number;
  groundAreaSqFt: number | null;
  pitchDegrees: number;
  pitchRatio: number;
  pitchLabel: string;
  azimuthDegrees: number;
  compass: string;
  center: LatLng | null;
  boundingBox: { sw: LatLng; ne: LatLng } | null;
  planeHeightM: number | null;
  /** Building Insights provides a centre and bounding box only; exact outlines are not part of that response. */
  polygon: null;
  source: 'google_solar';
};

export type PitchBucket = { pitch: string; pitchDegreesAvg: number; segmentCount: number; areaSqFt: number; percent: number };

export type NormalizedRoof = {
  provider: 'google_solar';
  areaM2: number;
  areaSqFt: number;
  squares: number;
  groundAreaSqFt: number | null;
  segmentCount: number;
  predominantPitch: string;
  predominantPitchDegrees: number;
  /** Compass direction faced by the largest share of roof area. */
  dominantOrientation: string;
  pitchDistribution: PitchBucket[];
  segments: NormalizedSegment[];
  imagery: { date: string | null; processedDate: string | null; quality: ImageryQuality | null };
  buildingCenter: LatLng | null;
  warnings: string[];
};

const iso = (d?: GoogleDate): string | null => (d && d.year ? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}` : null);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Turns a Building Insights response into the CRM's roof summary. Nothing is estimated: a segment without an area
 * or pitch is dropped with a warning, and a response with no usable segments throws NO_ROOF_DATA.
 */
export function normalizeBuildingInsights(bi: GoogleBuildingInsights): NormalizedRoof {
  const raw = bi.solarPotential?.roofSegmentStats;
  if (!Array.isArray(raw) || raw.length === 0) throw new SolarError('NO_ROOF_DATA');
  const warnings: string[] = [];
  const segments: NormalizedSegment[] = [];
  raw.forEach((s, providerIndex) => {
    const areaM2 = s.stats?.areaMeters2;
    if (!num(areaM2) || areaM2 <= 0 || !num(s.pitchDegrees) || !num(s.azimuthDegrees)) {
      warnings.push(`Roof segment ${providerIndex + 1} was skipped because Google did not supply its area, pitch or direction.`);
      return;
    }
    const areaSqFt = m2ToSqFt(areaM2);
    const bb = s.boundingBox?.sw && s.boundingBox?.ne ? { sw: s.boundingBox.sw, ne: s.boundingBox.ne } : null;
    segments.push({
      id: `S${segments.length + 1}`,
      providerIndex,
      areaM2: round(areaM2, 3),
      areaSqFt: round(areaSqFt),
      squares: round(sqFtToSquares(areaSqFt)),
      groundAreaSqFt: num(s.stats?.groundAreaMeters2) ? round(m2ToSqFt(s.stats.groundAreaMeters2)) : null,
      pitchDegrees: round(s.pitchDegrees, 2),
      pitchRatio: round(pitchRatioFromDegrees(s.pitchDegrees), 2),
      pitchLabel: pitchLabelFromDegrees(s.pitchDegrees),
      azimuthDegrees: round(s.azimuthDegrees, 1),
      compass: compassFromAzimuth(s.azimuthDegrees),
      center: s.center ?? null,
      boundingBox: bb,
      planeHeightM: num(s.planeHeightAtCenterMeters) ? round(s.planeHeightAtCenterMeters, 2) : null,
      polygon: null,
      source: 'google_solar',
    });
  });
  if (segments.length === 0) throw new SolarError('NO_ROOF_DATA');

  const areaM2 = segments.reduce((a, s) => a + s.areaM2, 0);
  const areaSqFt = segments.reduce((a, s) => a + s.areaSqFt, 0);
  const ground = segments.every((s) => s.groundAreaSqFt !== null) ? segments.reduce((a, s) => a + (s.groundAreaSqFt as number), 0) : null;

  const whole = bi.solarPotential?.wholeRoofStats?.areaMeters2;
  if (num(whole) && whole > 0 && Math.abs(whole - areaM2) / whole > 0.05) {
    warnings.push(`The sum of roof segments differs from Google's whole-roof area by more than 5% (${round(m2ToSqFt(areaM2), 0)} vs ${round(m2ToSqFt(whole), 0)} sq ft). The segment total is used; field verification is recommended.`);
  }

  const buckets = new Map<string, { degSum: number; areaSum: number; n: number }>();
  for (const s of segments) {
    const b = buckets.get(s.pitchLabel) ?? { degSum: 0, areaSum: 0, n: 0 };
    b.degSum += s.pitchDegrees * s.areaSqFt;
    b.areaSum += s.areaSqFt;
    b.n += 1;
    buckets.set(s.pitchLabel, b);
  }
  const pitchDistribution: PitchBucket[] = [...buckets.entries()]
    .map(([pitch, b]) => ({ pitch, pitchDegreesAvg: round(b.degSum / b.areaSum, 2), segmentCount: b.n, areaSqFt: round(b.areaSum), percent: round((b.areaSum / areaSqFt) * 100, 1) }))
    .sort((a, b) => b.areaSqFt - a.areaSqFt);
  const top = pitchDistribution[0] as PitchBucket;

  const byCompass = new Map<string, number>();
  for (const s of segments) byCompass.set(s.compass, (byCompass.get(s.compass) ?? 0) + s.areaSqFt);
  const dominantOrientation = [...byCompass.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N';

  return {
    provider: 'google_solar',
    areaM2: round(areaM2, 3),
    areaSqFt: round(areaSqFt),
    squares: round(sqFtToSquares(areaSqFt)),
    groundAreaSqFt: ground === null ? null : round(ground),
    segmentCount: segments.length,
    predominantPitch: top.pitch,
    predominantPitchDegrees: top.pitchDegreesAvg,
    dominantOrientation,
    pitchDistribution,
    segments,
    imagery: { date: iso(bi.imageryDate), processedDate: iso(bi.imageryProcessedDate), quality: bi.imageryQuality ?? null },
    buildingCenter: bi.center ?? null,
    warnings,
  };
}
