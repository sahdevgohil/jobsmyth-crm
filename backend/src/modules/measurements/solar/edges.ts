/**
 * Roof edge classification from plane geometry.
 *
 * IMPORTANT LIMIT: Google Solar's Building Insights returns, for each roof segment, only a centre, a bounding box,
 * a pitch and an azimuth. That is NOT enough to find shared edges, so for Google results this module reports every
 * edge type as "manual verification required" and invents nothing (see `edgesUnavailable`).
 * `classifyEdges` works on real polygons (for example outlines derived from Data Layers DSM/mask rasters in the
 * future, or a user-drawn tracing) and is covered by tests on synthetic roofs only.
 *
 * Geometry convention: local metres, x = east, y = north. `azimuthDegrees` is the compass direction the plane
 * faces (the downhill direction), clockwise from north. Confidence is never "high": polygon-derived edges are
 * estimates and stay "unverified" until a person verifies them.
 */
import { metersToFeet, round } from './geo.js';

export const EDGE_TYPES = ['ridge', 'hip', 'valley', 'eave', 'rake'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export type PlaneGeometry = {
  id: string;
  polygon: Array<[number, number]>;
  pitchDegrees: number;
  azimuthDegrees: number;
};

export type Edge = {
  id: string;
  type: EdgeType | 'unclassified';
  lengthFt: number | null;
  unit: 'ft';
  source: 'geometry' | 'manual' | 'unavailable';
  confidence: 'medium' | 'low' | 'none';
  verification: 'unverified' | 'manual_required' | 'verified';
  planeIds: string[];
  note: string;
};

const TOL_DIST = 0.15; // metres: how close two edges must be to count as the same line
const MIN_LEN = 0.3; // metres: shorter pieces are ignored as noise

type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
const len = (a: V2): number => Math.hypot(a[0], a[1]);

function signedArea(p: V2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as V2;
    const b = p[(i + 1) % p.length] as V2;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

type PlaneEdge = { plane: PlaneGeometry; a: V2; b: V2; dir: V2; length: number; out: V2; down: V2; slopeDot: number };

function planeEdges(pl: PlaneGeometry): PlaneEdge[] {
  const pts = signedArea(pl.polygon) < 0 ? [...pl.polygon].reverse() : pl.polygon; // counter-clockwise
  const az = (pl.azimuthDegrees * Math.PI) / 180;
  const down: V2 = [Math.sin(az), Math.cos(az)];
  const out: PlaneEdge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as V2;
    const b = pts[(i + 1) % pts.length] as V2;
    const l = len(sub(b, a));
    if (l < 1e-6) continue;
    const dir: V2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const o: V2 = [dir[1], -dir[0]]; // outward normal for a counter-clockwise ring
    out.push({ plane: pl, a, b, dir, length: l, out: o, down, slopeDot: dot(down, o) });
  }
  return out;
}

/** Is `f` on the same line as `e`? Returns the overlap interval along `e` (metres from e.a) or null. */
function overlap(e: PlaneEdge, f: PlaneEdge): [number, number] | null {
  const dist = (p: V2): number => Math.abs((p[0] - e.a[0]) * e.out[0] + (p[1] - e.a[1]) * e.out[1]);
  if (dist(f.a) > TOL_DIST || dist(f.b) > TOL_DIST) return null;
  const t1 = dot(sub(f.a, e.a), e.dir);
  const t2 = dot(sub(f.b, e.a), e.dir);
  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(e.length, Math.max(t1, t2));
  return hi - lo >= MIN_LEN ? [lo, hi] : null;
}

/** True 3D length of a plan-view segment lying in a plane with the given pitch and downhill direction. */
function trueLengthM(planLen: number, dir: V2, down: V2, pitchDeg: number): number {
  const dz = -Math.tan((pitchDeg * Math.PI) / 180) * dot(down, dir) * planLen;
  return Math.hypot(planLen, dz);
}

/** Upward unit normal of a plane; it tilts toward the downhill direction. */
function normal3(pitchDeg: number, down: V2): [number, number, number] {
  const p = (pitchDeg * Math.PI) / 180;
  return [Math.sin(p) * down[0], Math.sin(p) * down[1], Math.cos(p)];
}

export function classifyEdges(planes: PlaneGeometry[]): Edge[] {
  const all = planes.map(planeEdges);
  const result: Edge[] = [];
  let n = 0;
  const nextId = (): string => `E${++n}`;

  for (let pi = 0; pi < planes.length; pi++) {
    for (const e of all[pi] as PlaneEdge[]) {
      // Pieces of this edge shared with other planes.
      const shared: Array<{ lo: number; hi: number; other: PlaneEdge }> = [];
      for (let pj = 0; pj < planes.length; pj++) {
        if (pj === pi) continue;
        for (const f of all[pj] as PlaneEdge[]) {
          const ov = overlap(e, f);
          if (ov) shared.push({ lo: ov[0], hi: ov[1], other: f });
        }
      }
      // Count each shared piece once (from the plane listed first).
      for (const s of shared) {
        if (planes.indexOf(s.other.plane) < pi) continue;
        const planLen = s.hi - s.lo;
        const sA = e.slopeDot;
        const sB = s.other.slopeDot;
        const nA = normal3(e.plane.pitchDegrees, e.down);
        const nB = normal3(s.other.plane.pitchDegrees, s.other.down);
        const t = [nA[1] * nB[2] - nA[2] * nB[1], nA[2] * nB[0] - nA[0] * nB[2], nA[0] * nB[1] - nA[1] * nB[0]];
        const tl = Math.hypot(t[0] as number, t[1] as number, t[2] as number);
        const horizontal = tl > 1e-9 && Math.abs(t[2] as number) / tl < 0.1;
        const away = sA < -0.3 && sB < -0.3;
        const toward = sA > 0.3 && sB > 0.3;
        const strong = Math.min(Math.abs(sA), Math.abs(sB)) >= 0.5;
        const lengthFt = round(metersToFeet(trueLengthM(planLen, e.dir, e.down, e.plane.pitchDegrees)), 1);
        const planeIds = [e.plane.id, s.other.plane.id];
        if (away || toward) {
          const type: EdgeType = away ? (horizontal ? 'ridge' : 'hip') : 'valley';
          result.push({ id: nextId(), type, lengthFt, unit: 'ft', source: 'geometry', confidence: strong ? 'medium' : 'low', verification: strong ? 'unverified' : 'manual_required', planeIds, note: `Shared edge between ${planeIds.join(' and ')}.` });
        } else {
          result.push({ id: nextId(), type: 'unclassified', lengthFt: null, unit: 'ft', source: 'geometry', confidence: 'low', verification: 'manual_required', planeIds, note: 'Shared edge between planes that do not clearly meet as a ridge, hip or valley (possible step or wall).' });
        }
      }
      // Remaining (unshared) pieces of the edge are perimeter.
      const covered = shared.map((s) => [s.lo, s.hi] as [number, number]).sort((x, y) => x[0] - y[0]);
      const free: Array<[number, number]> = [];
      let cur = 0;
      for (const [lo, hi] of covered) {
        if (lo - cur >= MIN_LEN) free.push([cur, lo]);
        cur = Math.max(cur, hi);
      }
      if (e.length - cur >= MIN_LEN) free.push([cur, e.length]);
      for (const [lo, hi] of free) {
        const planLen = hi - lo;
        const lengthFt = round(metersToFeet(trueLengthM(planLen, e.dir, e.down, e.plane.pitchDegrees)), 1);
        const s = e.slopeDot;
        if (s > 0.8) {
          result.push({ id: nextId(), type: 'eave', lengthFt, unit: 'ft', source: 'geometry', confidence: 'medium', verification: 'unverified', planeIds: [e.plane.id], note: 'Low horizontal perimeter edge.' });
        } else if (Math.abs(s) < 0.3) {
          result.push({ id: nextId(), type: 'rake', lengthFt, unit: 'ft', source: 'geometry', confidence: 'medium', verification: 'unverified', planeIds: [e.plane.id], note: 'Perimeter edge running up the slope.' });
        } else {
          result.push({ id: nextId(), type: 'unclassified', lengthFt: null, unit: 'ft', source: 'geometry', confidence: 'low', verification: 'manual_required', planeIds: [e.plane.id], note: s < -0.8 ? 'Free high edge (a ridge against a wall, or flashing): verify on site.' : 'Diagonal perimeter edge: verify on site.' });
        }
      }
    }
  }
  return result;
}

export type EdgeSummary = { type: EdgeType; lengthFt: number | null; edgeCount: number; needsVerification: number; status: 'estimated' | 'verified' | 'manual_required' };

/** Totals per type. Only classified edges with at least medium confidence contribute length. */
export function summarizeEdges(edges: Edge[]): EdgeSummary[] {
  return EDGE_TYPES.map((type) => {
    const mine = edges.filter((e) => e.type === type);
    const usable = mine.filter((e) => e.lengthFt !== null && e.confidence !== 'low' && e.confidence !== 'none');
    const needs = mine.length - usable.length;
    const lengthFt = usable.length > 0 ? round(usable.reduce((a, e) => a + (e.lengthFt as number), 0), 1) : null;
    const status: EdgeSummary['status'] = usable.length === 0 ? 'manual_required' : usable.every((e) => e.verification === 'verified') && needs === 0 ? 'verified' : 'estimated';
    return { type, lengthFt, edgeCount: mine.length, needsVerification: needs, status };
  });
}

/** What Google Building Insights gives us: no edge geometry. Every type is reported as needing manual entry. */
export function edgesUnavailable(): Edge[] {
  return EDGE_TYPES.map((type, i) => ({
    id: `E${i + 1}`,
    type,
    lengthFt: null,
    unit: 'ft' as const,
    source: 'unavailable' as const,
    confidence: 'none' as const,
    verification: 'manual_required' as const,
    planeIds: [],
    note: 'Google Solar does not return roof edge geometry. Measure on site or from a roof report and enter it manually.',
  }));
}
