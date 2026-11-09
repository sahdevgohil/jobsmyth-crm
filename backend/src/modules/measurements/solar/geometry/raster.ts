/**
 * Raster + polygon primitives for roof geometry. Pure functions, no I/O.
 *
 * Coordinates:
 *  - A GeoRaster is georeferenced in a projected CRS in metres (Google uses UTM). Row 0 is the NORTH edge.
 *  - "Local" coordinates are metres east (x) and north (y) of a chosen centre point; all roof geometry is stored in them.
 *  - Grid north of UTM is treated as true north (convergence is a fraction of a degree inside one building).
 */
import proj4 from 'proj4';

export type Pt = [number, number];

export type GeoRaster = {
  width: number;
  height: number;
  /** Projected X of the top-left corner of pixel (0,0). */
  originX: number;
  /** Projected Y of the top-left corner of pixel (0,0). */
  originY: number;
  /** Pixel size in metres (square pixels). */
  pixel: number;
  epsg: number;
  bands: Array<ArrayLike<number>>;
  nodata: Array<number | null>;
};

// ---------------------------------------------------------------- projection

/** proj4 definition for the UTM zones Google serves: WGS84 (326xx/327xx) and NAD83 (269xx). */
export function utmDefinition(epsg: number): string | null {
  if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 26901 && epsg <= 26923) return `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`;
  return null;
}

export function latLngToXY(epsg: number, lat: number, lng: number): Pt {
  const def = utmDefinition(epsg);
  if (!def) throw new Error(`Unsupported raster CRS EPSG:${epsg}`);
  const [x, y] = proj4('EPSG:4326', def, [lng, lat]);
  return [x as number, y as number];
}

export function xyToLatLng(epsg: number, x: number, y: number): { latitude: number; longitude: number } {
  const def = utmDefinition(epsg);
  if (!def) throw new Error(`Unsupported raster CRS EPSG:${epsg}`);
  const [lng, lat] = proj4(def, 'EPSG:4326', [x, y]);
  return { latitude: lat as number, longitude: lng as number };
}

/** Pixel (col,row) → projected X/Y of the pixel centre. */
export const pixelCenterXY = (r: GeoRaster, col: number, row: number): Pt => [r.originX + (col + 0.5) * r.pixel, r.originY - (row + 0.5) * r.pixel];

/** Projected X/Y → fractional pixel coordinates measured from the top-left corner (col, row). */
export const xyToPixel = (r: GeoRaster, x: number, y: number): Pt => [(x - r.originX) / r.pixel, (r.originY - y) / r.pixel];

/** Frame of reference for stored geometry: metres east/north of (cx, cy). */
export type LocalFrame = { cx: number; cy: number };
export const toLocal = (f: LocalFrame, x: number, y: number): Pt => [x - f.cx, y - f.cy];
/** Local metres → fractional pixel coordinates of a raster. */
export const localToPixel = (r: GeoRaster, f: LocalFrame, p: Pt): Pt => xyToPixel(r, p[0] + f.cx, p[1] + f.cy);
export const pixelToLocal = (r: GeoRaster, f: LocalFrame, col: number, row: number): Pt => [r.originX + col * r.pixel - f.cx, r.originY - row * r.pixel - f.cy];

// ---------------------------------------------------------------- band access

export function validAt(r: GeoRaster, band: number, col: number, row: number): number | null {
  if (col < 0 || row < 0 || col >= r.width || row >= r.height) return null;
  const v = (r.bands[band] as ArrayLike<number>)[row * r.width + col] as number;
  const nd = r.nodata[band];
  if (!Number.isFinite(v) || (nd !== null && nd !== undefined && v === nd) || v < -1e6) return null;
  return v;
}

/** Bilinear sample at fractional pixel coordinates (corner-based: integer = pixel corner). */
export function sampleBilinear(r: GeoRaster, band: number, colF: number, rowF: number): number | null {
  const c = colF - 0.5;
  const w = rowF - 0.5;
  const c0 = Math.floor(c);
  const r0 = Math.floor(w);
  const fc = c - c0;
  const fr = w - r0;
  let sum = 0;
  let wsum = 0;
  for (const [dc, dr, wt] of [[0, 0, (1 - fc) * (1 - fr)], [1, 0, fc * (1 - fr)], [0, 1, (1 - fc) * fr], [1, 1, fc * fr]] as const) {
    const v = validAt(r, band, c0 + dc, r0 + dr);
    if (v !== null && wt > 0) {
      sum += v * wt;
      wsum += wt;
    }
  }
  return wsum > 0.25 ? sum / wsum : null;
}

// ---------------------------------------------------------------- binary masks

export type Mask = { width: number; height: number; data: Uint8Array };

export function maskFromBand(r: GeoRaster, band = 0): Mask {
  const data = new Uint8Array(r.width * r.height);
  for (let i = 0; i < data.length; i++) data[i] = (r.bands[band] as ArrayLike<number>)[i] ? 1 : 0;
  return { width: r.width, height: r.height, data };
}

function morph(m: Mask, grow: boolean): Mask {
  const out = new Uint8Array(m.data.length);
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      let any = false;
      let all = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const v = xx >= 0 && yy >= 0 && xx < m.width && yy < m.height ? m.data[yy * m.width + xx] : 0;
          if (v) any = true;
          else all = false;
        }
      }
      out[y * m.width + x] = (grow ? any : all) ? 1 : 0;
    }
  }
  return { width: m.width, height: m.height, data: out };
}
export const dilate = (m: Mask): Mask => morph(m, true);
export const erode = (m: Mask): Mask => morph(m, false);
/** Closing fills pinholes; opening removes specks. */
export const close = (m: Mask): Mask => erode(dilate(m));
export const open = (m: Mask): Mask => dilate(erode(m));

export type Components = { labels: Int32Array; count: number; sizes: number[]; width: number; height: number };

/** 4-connected component labelling. Labels start at 1; 0 = background. */
export function labelComponents(m: Mask): Components {
  const labels = new Int32Array(m.data.length);
  const sizes: number[] = [0];
  let count = 0;
  const stack: number[] = [];
  for (let i = 0; i < m.data.length; i++) {
    if (!m.data[i] || labels[i]) continue;
    count += 1;
    let size = 0;
    stack.push(i);
    labels[i] = count;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      size += 1;
      const x = p % m.width;
      const y = (p - x) / m.width;
      if (x > 0 && m.data[p - 1] && !labels[p - 1]) { labels[p - 1] = count; stack.push(p - 1); }
      if (x < m.width - 1 && m.data[p + 1] && !labels[p + 1]) { labels[p + 1] = count; stack.push(p + 1); }
      if (y > 0 && m.data[p - m.width] && !labels[p - m.width]) { labels[p - m.width] = count; stack.push(p - m.width); }
      if (y < m.height - 1 && m.data[p + m.width] && !labels[p + m.width]) { labels[p + m.width] = count; stack.push(p + m.width); }
    }
    sizes.push(size);
  }
  return { labels, count, sizes, width: m.width, height: m.height };
}

// ---------------------------------------------------------------- polygons

export function ringArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as Pt;
    const b = p[(i + 1) % p.length] as Pt;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function ringCentroid(p: Pt[]): Pt {
  const a = ringArea(p);
  if (Math.abs(a) < 1e-9) return p[0] ?? [0, 0];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i] as Pt;
    const n = p[(i + 1) % p.length] as Pt;
    const f = q[0] * n[1] - n[0] * q[1];
    cx += (q[0] + n[0]) * f;
    cy += (q[1] + n[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function pointInRing(pt: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Pt;
    const [xj, yj] = ring[j] as Pt;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function dp(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points;
  let maxD = 0;
  let idx = 0;
  const a = points[0] as Pt;
  const b = points[points.length - 1] as Pt;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i] as Pt, a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...dp(points.slice(0, idx + 1), tol).slice(0, -1), ...dp(points.slice(idx), tol)];
}

/** Douglas–Peucker for a closed ring. Splits at the two farthest-apart vertices so the start point does not bias the result. */
export function simplifyRing(ring: Pt[], tol: number): Pt[] {
  if (ring.length <= 4) return ring;
  let ia = 0;
  let ib = 0;
  let best = -1;
  const step = Math.max(1, Math.floor(ring.length / 200));
  for (let i = 0; i < ring.length; i += step) {
    for (let j = i + 1; j < ring.length; j += step) {
      const d = (ring[i]![0] - ring[j]![0]) ** 2 + (ring[i]![1] - ring[j]![1]) ** 2;
      if (d > best) { best = d; ia = i; ib = j; }
    }
  }
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
  const first = dp(ring.slice(lo, hi + 1), tol);
  const second = dp([...ring.slice(hi), ...ring.slice(0, lo + 1)], tol);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * Outer boundary of one connected component as a ring of pixel-CORNER coordinates (col,row).
 * Built from the unit edges between inside and outside pixels and stitched into loops;
 * the longest loop is the outer boundary (holes are ignored).
 */
export function traceOuterRing(c: Components, label: number): Pt[] {
  const { width: w, height: h, labels } = c;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === label;
  // Directed edges keep the component on the right-hand side when walking in image coordinates (y down).
  const next = new Map<string, Array<[number, number]>>();
  const key = (x: number, y: number): string => `${x},${y}`;
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const k = key(x0, y0);
    const list = next.get(k);
    if (list) list.push([x1, y1]);
    else next.set(k, [[x1, y1]]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y); // top edge →
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right edge ↓
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1); // bottom edge ←
      if (!inside(x - 1, y)) add(x, y + 1, x, y); // left edge ↑
    }
  }
  const loops: Pt[][] = [];
  const used = new Set<string>();
  for (const [startKey, outs] of next) {
    for (const o of outs) {
      const eid = `${startKey}>${o[0]},${o[1]}`;
      if (used.has(eid)) continue;
      const loop: Pt[] = [];
      let [cx, cy] = startKey.split(',').map(Number) as [number, number];
      let [nx, ny] = o;
      used.add(eid);
      loop.push([cx, cy]);
      let guard = 0;
      while (guard++ < 5_000_000) {
        cx = nx;
        cy = ny;
        if (key(cx, cy) === startKey) break;
        loop.push([cx, cy]);
        const cand = (next.get(key(cx, cy)) ?? []).filter((n) => !used.has(`${key(cx, cy)}>${n[0]},${n[1]}`));
        if (cand.length === 0) break;
        // At a pinch point prefer the sharpest right turn so loops do not cross.
        const dx = cx - (loop[loop.length - 2] as Pt)[0];
        const dy = cy - (loop[loop.length - 2] as Pt)[1];
        cand.sort((a, b) => Math.atan2(dx * (a[1] - cy) - dy * (a[0] - cx), dx * (a[0] - cx) + dy * (a[1] - cy)) - Math.atan2(dx * (b[1] - cy) - dy * (b[0] - cx), dx * (b[0] - cx) + dy * (b[1] - cy)));
        const pick = cand[cand.length - 1] as [number, number];
        used.add(`${key(cx, cy)}>${pick[0]},${pick[1]}`);
        nx = pick[0];
        ny = pick[1];
      }
      loops.push(loop);
    }
  }
  if (loops.length === 0) return [];
  loops.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  return removeCollinear(loops[0] as Pt[]);
}

export function removeCollinear(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length] as Pt;
    const b = ring[i] as Pt;
    const c = ring[(i + 1) % ring.length] as Pt;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);


/** Direction (degrees, 0-90) of the longest edge of a ring, folded into one quadrant: roofs are mostly built square to one axis. */
export function dominantAngle(ring: Pt[]): number {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % ring.length] as Pt;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) { best = l; angle = ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 90; }
  }
  return angle;
}

/**
 * Cleans a traced ring: edges within `tol` degrees of the dominant axis (or its 45 degree diagonals) are rotated onto it, and the
 * vertices re-solved as line intersections. Only small moves are accepted (vertex shift under `maxShift` metres, area change under
 * 15%), otherwise the original ring is kept. This makes outlines crisp without inventing geometry the data does not show.
 */
export function snapRing(ring: Pt[], dominant: number, tol = 8, maxShift = 0.7): Pt[] {
  const n = ring.length;
  if (n < 4) return ring;
  type Line = { p: Pt; d: Pt } | null;
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.6) { lines.push(null); continue; }
    const ang = ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 360;
    const rel = (((ang - dominant) % 45) + 45) % 45;
    const off = Math.min(rel, 45 - rel);
    if (off > tol) { lines.push(null); continue; }
    const snapped = rel <= 45 - rel ? ang - rel : ang + (45 - rel);
    const r = (snapped * Math.PI) / 180;
    lines.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d: [Math.cos(r), Math.sin(r)] });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const v = ring[i] as Pt;
    if (l1 && l2) {
      const cross = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
      if (Math.abs(cross) > 0.2) {
        const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / cross;
        const q: Pt = [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t];
        if (Math.hypot(q[0] - v[0], q[1] - v[1]) <= maxShift) { out.push(q); continue; }
      }
    }
    out.push(v);
  }
  const clean = out.filter((p, i) => Math.hypot(p[0] - (out[(i + 1) % out.length] as Pt)[0], p[1] - (out[(i + 1) % out.length] as Pt)[1]) > 0.05);
  const a0 = Math.abs(ringArea(ring));
  const a1 = Math.abs(ringArea(clean));
  return clean.length >= 3 && a0 > 0 && Math.abs(a1 - a0) / a0 < 0.15 ? clean : ring;
}
