/**
 * Roof geometry extraction from Google Solar rasters (building mask + DSM) and Building Insights segments.
 *
 * Method (documented honestly, see docs/MEASUREMENT_UPGRADE.md):
 *  1. The building mask gives the footprint. Noise is removed, the component nearest the building centre is the main structure.
 *  2. Every roof pixel is assigned to the Building Insights segment whose plane (pitch + direction, from Google) best matches
 *     the local DSM slope and whose bounding box is close. Region outlines are traced from that label map.
 *  3. Each outline segment is classified from DSM heights across the line (ridge/hip = higher than both sides, valley = lower),
 *     or as eave/rake/flashing candidate when it sits on the footprint edge.
 * This is an estimate. Nothing is claimed as measured on site: edges start "unverified" and uncertain ones "needs_verification".
 */
import type { NormalizedRoof, NormalizedSegment } from '../normalize.js';
import { metersToFeet, m2ToSqFt, round } from '../geo.js';
import {
  close, dilate, dist, dominantAngle, erode, labelComponents, latLngToXY, localToPixel, maskFromBand, open, pixelToLocal, ringArea, sampleBilinear, simplifyRing, snapRing, traceOuterRing, validAt,
  type Components, type GeoRaster, type LocalFrame, type Pt,
} from './raster.js';
import type { DerivedEdge, GeometryEdgeType, RoofFacet, RoofGeometry, RoofStructure } from './types.js';

export type RasterSet = { dsm: GeoRaster; mask: GeoRaster; rgb?: GeoRaster };

const MIN_STRUCTURE_M2 = 12;
const SIMPLIFY_TOL_M = 0.35;
const MIN_EDGE_M = 0.5;
const PROBE_M = 0.75;
const FLAT_DEGREES = 5;

type SegBox = { seg: NormalizedSegment; center: Pt; min: Pt; max: Pt; normal: [number, number, number] };

function segBoxes(roof: NormalizedRoof, epsg: number, f: LocalFrame): SegBox[] {
  const out: SegBox[] = [];
  for (const s of roof.segments) {
    if (!s.center) continue;
    const c = latLngToXY(epsg, s.center.latitude, s.center.longitude);
    const center: Pt = [c[0] - f.cx, c[1] - f.cy];
    let min: Pt = [center[0] - 4, center[1] - 4];
    let max: Pt = [center[0] + 4, center[1] + 4];
    if (s.boundingBox) {
      const sw = latLngToXY(epsg, s.boundingBox.sw.latitude, s.boundingBox.sw.longitude);
      const ne = latLngToXY(epsg, s.boundingBox.ne.latitude, s.boundingBox.ne.longitude);
      min = [Math.min(sw[0], ne[0]) - f.cx - 0.5, Math.min(sw[1], ne[1]) - f.cy - 0.5];
      max = [Math.max(sw[0], ne[0]) - f.cx + 0.5, Math.max(sw[1], ne[1]) - f.cy + 0.5];
    }
    const p = (s.pitchDegrees * Math.PI) / 180;
    const az = (s.azimuthDegrees * Math.PI) / 180;
    out.push({ seg: s, center, min, max, normal: [Math.sin(p) * Math.sin(az), Math.sin(p) * Math.cos(az), Math.cos(p)] });
  }
  return out;
}

const boxDist = (p: Pt, b: SegBox): number => Math.hypot(Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]), Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]));

/** Smoothed DSM slope (rise/run east and north) at a pixel, or null where the DSM is missing. */
function gradient(dsm: GeoRaster, col: number, row: number): [number, number] | null {
  const g = (c: number, r: number): number | null => validAt(dsm, 0, c, r);
  const avg = (c: number, r: number): number | null => {
    let s = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = g(c + dx, r + dy); if (v !== null) { s += v; n += 1; } }
    return n >= 5 ? s / n : null;
  };
  const k = 2;
  const e = avg(col + k, row);
  const w = avg(col - k, row);
  const n = avg(col, row - k);
  const s = avg(col, row + k);
  if (e === null || w === null || n === null || s === null) return null;
  const span = 2 * k * dsm.pixel;
  return [(e - w) / span, (n - s) / span];
}

function pickMainComponent(c: Components, mask: GeoRaster, f: LocalFrame): number {
  // The component containing, or closest to, the building centre.
  let best = 0;
  let bestD = Infinity;
  const cx = (f.cx - mask.originX) / mask.pixel;
  const cy = (mask.originY - f.cy) / mask.pixel;
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      const l = c.labels[y * c.width + x] as number;
      if (!l || (c.sizes[l] as number) * mask.pixel ** 2 < MIN_STRUCTURE_M2) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestD) { bestD = d; best = l; }
    }
  }
  return bestD * mask.pixel > 30 ? 0 : best;
}

const ccw = (ring: Pt[]): Pt[] => (ringArea(ring) < 0 ? [...ring].reverse() : ring);

function toLocalRing(ringPx: Pt[], r: GeoRaster, f: LocalFrame): Pt[] {
  return ringPx.map(([c, row]) => pixelToLocal(r, f, c, row));
}

/** Majority filter over a label map (restricted to roof pixels). */
function majority(labels: Int32Array, roof: Uint8Array, w: number, h: number): Int32Array {
  const out = new Int32Array(labels);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!roof[i]) continue;
      const counts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = labels[(y + dy) * w + x + dx] as number; if (l > 0) counts.set(l, (counts.get(l) ?? 0) + 1); }
      let best = labels[i] as number;
      let bc = counts.get(best) ?? 0;
      for (const [l, n] of counts) if (n > bc) { best = l; bc = n; }
      out[i] = best;
    }
  }
  return out;
}

/** Re-labels roof pixels of facets smaller than `minPixels` with the most common neighbouring facet. */
function mergeTiny(labels: Int32Array, roof: Uint8Array, w: number, h: number, count: number, minPixels: number): Int32Array {
  if (count < 2) return labels;
  const sizes = new Array<number>(count + 1).fill(0);
  for (let i = 0; i < labels.length; i++) if (roof[i] && (labels[i] as number) > 0) sizes[labels[i] as number] = (sizes[labels[i] as number] as number) + 1;
  const out = new Int32Array(labels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = labels[i] as number;
      if (!roof[i] || l <= 0 || (sizes[l] as number) >= minPixels) continue;
      const votes = new Map<number, number>();
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = labels[yy * w + xx] as number;
        if (n > 0 && n !== l && (sizes[n] as number) >= minPixels) votes.set(n, (votes.get(n) ?? 0) + 1);
      }
      let best = l; let bv = 0;
      for (const [n, v] of votes) if (v > bv) { best = n; bv = v; }
      out[i] = best;
    }
  }
  return out;
}

/** Gives unassigned roof pixels (left by removed stray pieces and spurs) the majority label of their neighbours. */
function fillHoles(labels: Int32Array, roof: Uint8Array, w: number, h: number): Int32Array {
  let cur = labels;
  for (let pass = 0; pass < 4; pass++) {
    const out = new Int32Array(cur);
    let changed = false;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!roof[i] || (cur[i] as number) > 0) continue;
        const votes = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = cur[(y + dy) * w + x + dx] as number; if (n > 0) votes.set(n, (votes.get(n) ?? 0) + 1); }
        let best = 0; let bv = 0;
        for (const [n, v] of votes) if (v > bv) { best = n; bv = v; }
        if (best > 0) { out[i] = best; changed = true; }
      }
    }
    cur = out;
    if (!changed) break;
  }
  return cur;
}

export type BuildInput = { rasters: RasterSet; roof: NormalizedRoof; center: { latitude: number; longitude: number }; now?: Date };

export function buildRoofGeometry(input: BuildInput): RoofGeometry {
  const { rasters, roof } = input;
  const { dsm, mask } = rasters;
  const warnings: string[] = [];
  const base = (status: RoofGeometry['status'], reason: string | null, extra: Partial<RoofGeometry> = {}): RoofGeometry => ({
    version: 1, method: 'dsm-mask-segment-assignment', status, reason, frame: { epsg: dsm.epsg, cx: 0, cy: 0, latitude: input.center.latitude, longitude: input.center.longitude },
    pixelSizeM: dsm.pixel, structures: [], facets: [], edges: [], imagery: null, warnings, builtAt: (input.now ?? new Date()).toISOString(), ...extra,
  });
  if (dsm.width !== mask.width || dsm.height !== mask.height || dsm.pixel !== mask.pixel || Math.abs(dsm.originX - mask.originX) > 1e-6 || Math.abs(dsm.originY - mask.originY) > 1e-6) {
    return base('unavailable', 'The DSM and building mask do not cover the same area.');
  }
  const [px, py] = latLngToXY(dsm.epsg, input.center.latitude, input.center.longitude);
  const f: LocalFrame = { cx: px, cy: py };
  const frame = { epsg: dsm.epsg, cx: px, cy: py, latitude: input.center.latitude, longitude: input.center.longitude };

  // 1. Footprint(s)
  const cleaned = open(close(maskFromBand(mask)));
  const comps = labelComponents(cleaned);
  const mainLabel = pickMainComponent(comps, mask, f);
  if (!mainLabel) return base('unavailable', 'Google returned no building outline near this address.', { frame });
  const structures: RoofStructure[] = [];
  const mainRingPx = traceOuterRing(comps, mainLabel);
  if (mainRingPx.length < 4) return base('unavailable', 'The building outline could not be traced.', { frame });
  const rawMain = ccw(simplifyRing(toLocalRing(mainRingPx, mask, f), SIMPLIFY_TOL_M));
  const axis = dominantAngle(rawMain);
  const mainRing = ccw(snapRing(rawMain, axis));
  structures.push({ id: 'ST1', kind: 'main', footprint: mainRing, footprintAreaSqFt: round(m2ToSqFt(Math.abs(ringArea(mainRing))), 1), facetIds: [], roofAreaMeasured: true, note: 'Main building' });
  for (let l = 1; l <= comps.count; l++) {
    if (l === mainLabel || (comps.sizes[l] as number) * mask.pixel ** 2 < 20) continue;
    const ring = ccw(snapRing(simplifyRing(toLocalRing(traceOuterRing(comps, l), mask, f), SIMPLIFY_TOL_M), axis));
    if (ring.length < 4) continue;
    structures.push({ id: `ST${structures.length + 1}`, kind: 'additional', footprint: ring, footprintAreaSqFt: round(m2ToSqFt(Math.abs(ringArea(ring))), 1), facetIds: [], roofAreaMeasured: false, note: 'Outline only: Google returned roof segments for the main building, so this structure has no measured roof area.' });
  }
  if (structures.length > 1) warnings.push(`${structures.length - 1} additional structure outline(s) were found nearby. They are shown as outlines only and are not included in the roof area.`);

  // 2. Facet assignment on the main structure
  const boxes = segBoxes(roof, dsm.epsg, f);
  if (boxes.length === 0) return base('partial', 'Building Insights segments have no locations to match against.', { frame, structures });
  const w = dsm.width;
  const h = dsm.height;
  const roofPix = new Uint8Array(w * h);
  for (let i = 0; i < roofPix.length; i++) roofPix[i] = comps.labels[i] === mainLabel ? 1 : 0;
  let labels: Int32Array = new Int32Array(w * h);
  let assigned = 0;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!roofPix[i]) continue;
      const lp = pixelToLocal(dsm, f, col + 0.5, row + 0.5);
      const gr = gradient(dsm, col, row);
      let normal: [number, number, number] | null = null;
      if (gr) { const l = Math.hypot(gr[0], gr[1], 1); normal = [-gr[0] / l, -gr[1] / l, 1 / l]; }
      let best = 0;
      let bestCost = Infinity;
      boxes.forEach((b, k) => {
        const spatial = boxDist(lp, b) / 2.5;
        const angular = normal ? Math.acos(Math.max(-1, Math.min(1, normal[0] * b.normal[0] + normal[1] * b.normal[1] + normal[2] * b.normal[2]))) / 0.3 : 0.7;
        const cost = angular + spatial;
        if (cost < bestCost) { bestCost = cost; best = k + 1; }
      });
      labels[i] = best;
      assigned += 1;
    }
  }
  if (assigned === 0) return base('partial', 'No roof pixels were available to assign.', { frame, structures });
  labels = majority(majority(labels, roofPix, w, h), roofPix, w, h);
  labels = mergeTiny(labels, roofPix, w, h, boxes.length, 3 / dsm.pixel ** 2);

  // Keep each label's largest connected piece; reassign stray pieces by majority.
  const labelMap: Components = { labels, count: boxes.length, sizes: [], width: w, height: h };
  const perLabel: Array<{ pixels: number; ring: Pt[] }> = [];
  for (let k = 1; k <= boxes.length; k++) {
    const m = new Uint8Array(w * h);
    let n = 0;
    for (let i = 0; i < m.length; i++) if (labels[i] === k) { m[i] = 1; n += 1; }
    if (n === 0) { perLabel[k] = { pixels: 0, ring: [] }; continue; }
    const comp = labelComponents({ width: w, height: h, data: m });
    let big = 1;
    for (let c = 2; c <= comp.count; c++) if ((comp.sizes[c] as number) > (comp.sizes[big] as number)) big = c;
    for (let i = 0; i < m.length; i++) if (m[i] && comp.labels[i] !== big) labels[i] = 0; // stray piece (refilled below)
    // Remove thin spurs from larger facets (an opening removes features narrower than about 0.5 m).
    if ((comp.sizes[big] as number) * dsm.pixel ** 2 > 8) {
      const bigMask = new Uint8Array(w * h);
      for (let i = 0; i < bigMask.length; i++) if (comp.labels[i] === big) bigMask[i] = 1;
      const opened = open({ width: w, height: h, data: bigMask });
      const oc = labelComponents(opened);
      if (oc.count > 0) {
        let ob = 1;
        for (let c = 2; c <= oc.count; c++) if ((oc.sizes[c] as number) > (oc.sizes[ob] as number)) ob = c;
        if ((oc.sizes[ob] as number) > 0.8 * (comp.sizes[big] as number)) {
          for (let i = 0; i < bigMask.length; i++) if (bigMask[i] && oc.labels[i] !== ob) labels[i] = 0;
          perLabel[k] = { pixels: oc.sizes[ob] as number, ring: traceOuterRing(oc, ob) };
          continue;
        }
      }
    }
    perLabel[k] = { pixels: comp.sizes[big] as number, ring: traceOuterRing(comp, big) };
  }
  labels = fillHoles(labels, roofPix, w, h);
  void labelMap;
  void erode; void dilate; void dist;
  const facets: RoofFacet[] = [];
  const idForLabel = new Map<number, string>();
  boxes.forEach((b, i) => {
    const pl = perLabel[i + 1];
    if (!pl || pl.pixels * dsm.pixel ** 2 < 1.5 || pl.ring.length < 4) return;
    const ring = ccw(snapRing(simplifyRing(toLocalRing(pl.ring, dsm, f), SIMPLIFY_TOL_M), axis));
    if (ring.length < 3) return;
    const planAreaM2 = Math.abs(ringArea(ring));
    const ground = b.seg.groundAreaSqFt;
    const agreement = ground ? Math.min(planAreaM2 * 10.7639104167, ground) / Math.max(planAreaM2 * 10.7639104167, ground) : null;
    const id = `F${facets.length + 1}`;
    idForLabel.set(i + 1, id);
    facets.push({
      id, segmentId: b.seg.id, polygon: ring, planAreaM2: round(planAreaM2, 2), areaSqFt: b.seg.areaSqFt, pitchLabel: b.seg.pitchLabel, pitchDegrees: b.seg.pitchDegrees,
      azimuthDegrees: b.seg.azimuthDegrees, flat: b.seg.pitchDegrees < FLAT_DEGREES, structureId: 'ST1', agreement: agreement === null ? null : round(agreement, 2),
      confidence: agreement !== null && agreement >= 0.6 ? 'medium' : 'low',
    });
  });
  const missing = roof.segments.length - facets.length;
  if (missing > 0) warnings.push(`${missing} Google roof segment(s) could not be located in the imagery and have no outline (their area is still counted).`);
  const weak = facets.filter((x) => x.confidence === 'low').length;
  if (weak > 0) warnings.push(`${weak} facet outline(s) disagree with Google's segment size by more than 40%. Treat their shapes as approximate.`);
  (structures[0] as RoofStructure).facetIds = facets.map((x) => x.id);
  if (facets.length === 0) return base('partial', 'Roof planes could not be separated in the elevation data.', { frame, structures });

  // 3. Edges
  const edges = deriveEdges(facets, labels, idForLabel, dsm, f, mainRing);
  return base(weak > 0 || missing > 0 ? 'partial' : 'ok', null, { frame, structures, facets, edges });
}

// ---------------------------------------------------------------------------- edges

function deriveEdges(facets: RoofFacet[], labels: Int32Array, idForLabel: Map<number, string>, dsm: GeoRaster, f: LocalFrame, footprint: Pt[]): DerivedEdge[] {
  const facetByLabel = new Map<number, RoofFacet>();
  for (const [l, id] of idForLabel) facetByLabel.set(l, facets.find((x) => x.id === id) as RoofFacet);
  const idToLabel = new Map<string, number>([...idForLabel].map(([l, id]) => [id, l]));
  const labelAt = (p: Pt): number | 'out' | 0 => {
    const [c, r] = localToPixel(dsm, f, p);
    const col = Math.floor(c);
    const row = Math.floor(r);
    if (col < 0 || row < 0 || col >= dsm.width || row >= dsm.height) return 'out';
    const l = labels[row * dsm.width + col] as number;
    if (l > 0) return l;
    // Not a facet pixel: either outside the building or an unassigned roof pixel.
    return pointNearFootprint(p) ? 0 : 'out';
  };
  const pointNearFootprint = (p: Pt): boolean => {
    let inside = false;
    for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
      const [xi, yi] = footprint[i] as Pt;
      const [xj, yj] = footprint[j] as Pt;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const H = (p: Pt): number | null => {
    const [c, r] = localToPixel(dsm, f, p);
    return sampleBilinear(dsm, 0, c, r);
  };
  const edges: DerivedEdge[] = [];
  const push = (e: Omit<DerivedEdge, 'id' | 'history' | 'source' | 'included'>): void => {
    edges.push({ ...e, id: `E${edges.length + 1}`, source: 'derived', included: true, history: [] });
  };

  for (const facet of facets) {
    const label = idToLabel.get(facet.id) as number;
    const ring = facet.polygon;
    const az = (facet.azimuthDegrees * Math.PI) / 180;
    const down: Pt = [Math.sin(az), Math.cos(az)];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Pt;
      const b = ring[(i + 1) % ring.length] as Pt;
      const L = dist(a, b);
      if (L < MIN_EDGE_M) continue;
      const e: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const o: Pt = [e[1], -e[0]]; // outward for a counter-clockwise ring
      // Walk the edge and group samples by what lies just outside it.
      const n = Math.max(2, Math.ceil(L / 0.25));
      const runs: Array<{ from: number; to: number; nb: number | 'out' | 0 }> = [];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const nb = labelAt([p[0] + o[0] * 0.6, p[1] + o[1] * 0.6]);
        const last = runs[runs.length - 1];
        if (last && last.nb === nb) last.to = (k + 1) / n;
        else runs.push({ from: k / n, to: (k + 1) / n, nb });
      }
      for (const run of runs) {
        const planLen = (run.to - run.from) * L;
        if (planLen < MIN_EDGE_M || run.nb === label || run.nb === 0) continue;
        const pa: Pt = [a[0] + (b[0] - a[0]) * run.from, a[1] + (b[1] - a[1]) * run.from];
        const pb: Pt = [a[0] + (b[0] - a[0]) * run.to, a[1] + (b[1] - a[1]) * run.to];
        const mid: Pt = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const hm = H(mid);
        const hOut = H([mid[0] + o[0] * PROBE_M, mid[1] + o[1] * PROBE_M]);
        const hIn = H([mid[0] - o[0] * PROBE_M, mid[1] - o[1] * PROBE_M]);
        const h1 = H([pa[0] + (pb[0] - pa[0]) * 0.15, pa[1] + (pb[1] - pa[1]) * 0.15]);
        const h2 = H([pa[0] + (pb[0] - pa[0]) * 0.85, pa[1] + (pb[1] - pa[1]) * 0.85]);
        const dzPlan = h1 !== null && h2 !== null ? Math.abs(h2 - h1) / 0.7 : null; // total rise along the run
        const lengthFor = (rise: number): number => round(metersToFeet(Math.hypot(planLen, rise)), 1);

        if (run.nb !== 'out') {
          // Shared by two facets: emit once, from the lower-numbered facet.
          const other = facetByLabel.get(run.nb as number);
          if (!other || other.id < facet.id) continue;
          const rise = dzPlan !== null ? Math.min(dzPlan, planLen * 1.7) : 0;
          let type: GeometryEdgeType = 'unspecified';
          let strong = false;
          // Height profile across the line (-1 m .. +1 m). A ridge/hip is an interior maximum, a valley an interior minimum;
          // looking for the extremum (not just the value on the line) tolerates the traced outline sitting a few cm off.
          const prof: Array<number | null> = [];
          for (let k = -4; k <= 4; k++) prof.push(H([mid[0] + o[0] * k * 0.25, mid[1] + o[1] * k * 0.25]));
          if (prof.every((v) => v !== null)) {
            const v = prof as number[];
            const hi = Math.max(...v);
            const lo = Math.min(...v);
            const iHi = v.indexOf(hi) - 4;
            const iLo = v.indexOf(lo) - 4;
            const dropHi = Math.min(hi - (v[0] as number), hi - (v[8] as number));
            const riseLo = Math.min((v[0] as number) - lo, (v[8] as number) - lo);
            if (Math.abs(iHi) <= 2 && dropHi >= 0.2 && dropHi >= riseLo) { type = rise / planLen < 0.12 ? 'ridge' : 'hip'; strong = dropHi >= 0.3; }
            else if (Math.abs(iLo) <= 2 && riseLo >= 0.2) { type = 'valley'; strong = riseLo >= 0.2; }
          }
          void hm; void hOut; void hIn;
          const known = type !== 'unspecified';
          if (!known && planLen < 0.8) continue; // sampling noise at junctions
          push({ type, lengthFt: known ? lengthFor(rise) : null, planLengthFt: round(metersToFeet(planLen), 1), a: pa, b: pb, facetIds: [facet.id, other.id], confidence: known && strong ? 'medium' : 'low', verification: known && strong ? 'unverified' : 'needs_verification', note: known ? `Shared by ${facet.id} and ${other.id}; classified from elevation across the line.` : `Shared by ${facet.id} and ${other.id}; the elevation profile does not clearly show a ridge, hip or valley (possible step or transition).` });
        } else {
          const along = Math.abs(e[0] * down[0] + e[1] * down[1]);
          const od = o[0] * down[0] + o[1] * down[1];
          const higherNeighbour = hm !== null && hOut !== null && hOut > hm + 0.5;
          const slopeRise = Math.tan((facet.pitchDegrees * Math.PI) / 180) * planLen * along;
          if (planLen < 1.5) continue; // short stair-step fragments at corners are not real edges
          if (facet.flat) {
            push({ type: 'unspecified', lengthFt: null, planLengthFt: round(metersToFeet(planLen), 1), a: pa, b: pb, facetIds: [facet.id], confidence: 'low', verification: 'needs_verification', note: 'Flat-roof perimeter: could be a parapet, edge metal or wall. Verify on site.' });
          } else if (higherNeighbour) {
            const type: GeometryEdgeType = along > 0.8 ? 'step_flashing' : 'wall_flashing';
            push({ type, lengthFt: lengthFor(along > 0.8 ? slopeRise : 0), planLengthFt: round(metersToFeet(planLen), 1), a: pa, b: pb, facetIds: [facet.id], confidence: 'low', verification: 'needs_verification', note: 'A higher surface adjoins this edge. Flashing type must be confirmed on site.' });
          } else if (along < 0.4 && od > 0.5) {
            push({ type: 'eave', lengthFt: lengthFor(0), planLengthFt: round(metersToFeet(planLen), 1), a: pa, b: pb, facetIds: [facet.id], confidence: 'medium', verification: 'unverified', note: 'Low edge running along the contour.' });
          } else if (along > 0.8) {
            push({ type: 'rake', lengthFt: lengthFor(slopeRise), planLengthFt: round(metersToFeet(planLen), 1), a: pa, b: pb, facetIds: [facet.id], confidence: 'medium', verification: 'unverified', note: 'Edge running up the slope.' });
          } else {
            push({ type: 'unspecified', lengthFt: null, planLengthFt: round(metersToFeet(planLen), 1), a: pa, b: pb, facetIds: [facet.id], confidence: 'low', verification: 'needs_verification', note: od < -0.5 ? 'High free edge (a ridge against a wall, or flashing): verify on site.' : 'Diagonal perimeter edge: verify on site.' });
          }
        }
      }
    }
  }
  return edges;
}

export type EdgeTotals = Record<GeometryEdgeType, { lengthFt: number | null; count: number; verifiedFt: number | null; needsVerification: number }>;

/** Totals per edge type. `verifiedFt` counts only verified (or manually entered) included edges. */
export function edgeTotals(edges: DerivedEdge[]): EdgeTotals {
  const out = {} as EdgeTotals;
  const types: GeometryEdgeType[] = ['ridge', 'hip', 'valley', 'eave', 'rake', 'wall_flashing', 'step_flashing', 'curb_flashing', 'transition', 'parapet', 'unspecified'];
  for (const t of types) {
    const mine = edges.filter((e) => e.type === t && e.included);
    const withLen = mine.filter((e) => e.lengthFt !== null);
    const ver = withLen.filter((e) => e.verification === 'verified' || e.source === 'manual');
    out[t] = {
      lengthFt: withLen.length ? round(withLen.reduce((a, e) => a + (e.lengthFt as number), 0), 1) : null,
      count: mine.length,
      verifiedFt: ver.length ? round(ver.reduce((a, e) => a + (e.lengthFt as number), 0), 1) : null,
      needsVerification: mine.filter((e) => e.verification !== 'verified' && e.source !== 'manual').length,
    };
  }
  return out;
}
