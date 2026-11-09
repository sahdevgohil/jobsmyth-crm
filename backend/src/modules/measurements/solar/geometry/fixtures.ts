/**
 * Deterministic SYNTHETIC roofs for tests and demos: rasters are generated from plane equations, never from Google.
 * They exist so the geometry code can be checked against roofs whose true dimensions are known.
 */
import type { GoogleBuildingInsights } from '../google-solar.adapter.js';
import { normalizeBuildingInsights, type NormalizedRoof } from '../normalize.js';
import { m2ToSqFt } from '../geo.js';
import { pointInRing, xyToLatLng, type GeoRaster, type Pt } from './raster.js';
import type { RasterSet } from './derive.js';

export type PlaneSpec = {
  polygon: Pt[];
  pitchDegrees: number;
  /** Direction the plane faces (downhill), degrees clockwise from north. */
  azimuthDegrees: number;
  /** Height of the plane at local (0,0). */
  z0: number;
};

export type RoofSpec = {
  planes: PlaneSpec[];
  /** Extra buildings: flat boxes with no Building Insights segments. */
  extraBuildings?: Pt[][];
  pixel?: number;
  half?: number;
  noiseM?: number;
};

export const FIXTURE_EPSG = 32614;
export const FIXTURE_CENTER_XY: Pt = [500000, 3350000];

const sinCos = (deg: number): Pt => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];

function planeZ(p: PlaneSpec, x: number, y: number): number {
  const d = sinCos(p.azimuthDegrees);
  return p.z0 - Math.tan((p.pitchDegrees * Math.PI) / 180) * (x * d[0] + y * d[1]);
}

export function makeRasters(spec: RoofSpec): RasterSet {
  const pixel = spec.pixel ?? 0.25;
  const half = spec.half ?? 24;
  const size = Math.round((2 * half) / pixel);
  const dsm = new Float32Array(size * size);
  const mask = new Uint8Array(size * size);
  const rgb = [new Uint8Array(size * size), new Uint8Array(size * size), new Uint8Array(size * size)];
  let seed = 1234567;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = -half + (col + 0.5) * pixel;
      const y = half - (row + 0.5) * pixel;
      const i = row * size + col;
      let z = 0;
      let inside = false;
      for (const p of spec.planes) {
        if (pointInRing([x, y], p.polygon)) { z = planeZ(p, x, y); inside = true; break; }
      }
      if (!inside) for (const b of spec.extraBuildings ?? []) if (pointInRing([x, y], b)) { z = 3; inside = true; break; }
      dsm[i] = z + (spec.noiseM ? rnd() * spec.noiseM : 0);
      mask[i] = inside ? 1 : 0;
      const shade = inside ? 120 + Math.round(z * 12) : 70 + Math.round(rnd() * 20);
      rgb[0]![i] = Math.min(255, shade);
      rgb[1]![i] = Math.min(255, inside ? shade - 10 : shade + 25);
      rgb[2]![i] = Math.min(255, inside ? shade - 20 : shade);
    }
  }
  const base = { width: size, height: size, originX: FIXTURE_CENTER_XY[0] - half, originY: FIXTURE_CENTER_XY[1] + half, pixel, epsg: FIXTURE_EPSG };
  return {
    dsm: { ...base, bands: [dsm], nodata: [null] },
    mask: { ...base, bands: [mask], nodata: [0] },
    rgb: { ...base, bands: rgb, nodata: [0, 0, 0] },
  };
}

function polygonBounds(poly: Pt[]): { min: Pt; max: Pt } {
  return { min: [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1]))], max: [Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))] };
}

function polyArea(poly: Pt[]): number {
  let s = 0;
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length] as Pt; s += a[0] * b[1] - b[0] * a[1]; });
  return Math.abs(s) / 2;
}

/** Building Insights response consistent with the planes, as Google would describe them (area, pitch, direction, centre, box). */
export function insightsFor(spec: RoofSpec): GoogleBuildingInsights {
  const ll = (p: Pt) => xyToLatLng(FIXTURE_EPSG, FIXTURE_CENTER_XY[0] + p[0], FIXTURE_CENTER_XY[1] + p[1]);
  return {
    name: 'buildings/SYNTHETIC_FIXTURE_NOT_GOOGLE',
    center: ll([0, 0]),
    imageryDate: { year: 2024, month: 1, day: 15 },
    imageryProcessedDate: { year: 2024, month: 3, day: 1 },
    imageryQuality: 'HIGH',
    solarPotential: {
      roofSegmentStats: spec.planes.map((p) => {
        const plan = polyArea(p.polygon);
        const { min, max } = polygonBounds(p.polygon);
        const c: Pt = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
        return {
          pitchDegrees: p.pitchDegrees,
          azimuthDegrees: p.azimuthDegrees,
          stats: { areaMeters2: plan / Math.cos((p.pitchDegrees * Math.PI) / 180), groundAreaMeters2: plan },
          center: ll(c),
          boundingBox: { sw: ll(min), ne: ll(max) },
          planeHeightAtCenterMeters: planeZ(p, c[0], c[1]),
        };
      }),
    },
  };
}

export const roofOf = (spec: RoofSpec): NormalizedRoof => normalizeBuildingInsights(insightsFor(spec));

const P = 26.565; // 6/12

export const GABLE: RoofSpec = {
  planes: [
    { polygon: [[-6, 0], [6, 0], [6, 4], [-6, 4]], pitchDegrees: P, azimuthDegrees: 0, z0: 6 },
    { polygon: [[-6, -4], [6, -4], [6, 0], [-6, 0]], pitchDegrees: P, azimuthDegrees: 180, z0: 6 },
  ],
};

export const HIP: RoofSpec = {
  planes: [
    { polygon: [[-6, -4], [6, -4], [2, 0], [-2, 0]], pitchDegrees: P, azimuthDegrees: 180, z0: 6 },
    { polygon: [[-2, 0], [2, 0], [6, 4], [-6, 4]], pitchDegrees: P, azimuthDegrees: 0, z0: 6 },
    { polygon: [[6, -4], [6, 4], [2, 0]], pitchDegrees: P, azimuthDegrees: 90, z0: 6 + 0.5 * 2 },
    { polygon: [[-6, 4], [-6, -4], [-2, 0]], pitchDegrees: P, azimuthDegrees: 270, z0: 6 - 0.5 * 2 },
  ],
};

/** Main gable (ridge along x) with a cross wing (ridge along y): two valleys. */
export const COMPLEX: RoofSpec = {
  planes: [
    { polygon: [[-8, -4], [8, -4], [8, 0], [-8, 0]], pitchDegrees: P, azimuthDegrees: 180, z0: 6 },
    { polygon: [[-8, 0], [0, 0], [-4, 4], [-8, 4]], pitchDegrees: P, azimuthDegrees: 0, z0: 6 },
    { polygon: [[0, 0], [8, 0], [8, 4], [4, 4]], pitchDegrees: P, azimuthDegrees: 0, z0: 6 },
    { polygon: [[0, 0], [-4, 4], [-4, 10], [0, 10]], pitchDegrees: P, azimuthDegrees: 270, z0: 6 },
    { polygon: [[0, 0], [0, 10], [4, 10], [4, 4]], pitchDegrees: P, azimuthDegrees: 90, z0: 6 },
  ],
};

export const FLAT: RoofSpec = { planes: [{ polygon: [[-5, -4], [5, -4], [5, 4], [-5, 4]], pitchDegrees: 1, azimuthDegrees: 0, z0: 5 }] };

export const TWO_BUILDINGS: RoofSpec = { ...GABLE, extraBuildings: [[[14, -2], [19, -2], [19, 2], [14, 2]]] };

export const knownAreaSqFt = (spec: RoofSpec): number => spec.planes.reduce((a, p) => a + m2ToSqFt(polyArea(p.polygon) / Math.cos((p.pitchDegrees * Math.PI) / 180)), 0);

/** A raster with every building pixel removed, to simulate "no building at this address". */
export function emptyRasters(): RasterSet {
  const r = makeRasters({ planes: [] });
  return r;
}

export type { GeoRaster };
