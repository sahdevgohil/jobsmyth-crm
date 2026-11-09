/**
 * Vector roof diagrams (SVG strings). One renderer feeds the web UI and the PDF report.
 * Everything is drawn from extracted geometry; when there is none, only a clearly labelled approximate fallback exists.
 */
import { EDGE_TYPE_LABEL, type DerivedEdge, type GeometryEdgeType, type RoofGeometry } from './types.js';
import { pointInRing, ringArea, type Pt } from './raster.js';
import { ftLabel } from '../report/format.js';

export const DIAGRAM_KINDS = ['outline', 'facets', 'area', 'pitch', 'edges'] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

export const EDGE_COLOR: Record<GeometryEdgeType, string> = {
  ridge: '#c32930', hip: '#e07b39', valley: '#2b6cb0', eave: '#2f855a', rake: '#6b46c1', wall_flashing: '#b7791f', step_flashing: '#b7791f',
  curb_flashing: '#b7791f', transition: '#0e7490', parapet: '#4a5568', unspecified: '#757575',
};
const CHARCOAL = '#3c3c3c';
const GREY = '#757575';
const FILLS = ['#ececec', '#dcdcdc', '#cbcbcb', '#f4d3d5', '#ebb1b5', '#de8a90'];
const FONT = 'Helvetica, Arial, sans-serif';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const f1 = (n: number): string => n.toFixed(1);

type View = { w: number; h: number; scale: number; ox: number; oy: number; minX: number; maxY: number };

function viewFor(g: RoofGeometry, w: number, h: number, mainOnly: boolean, pad = 56): View {
  const mains = g.structures.filter((s) => s.kind === 'main');
  const mp = mains.flatMap((s) => s.footprint).concat(g.facets.flatMap((x) => x.polygon));
  const mb = { x0: Math.min(...mp.map((p) => p[0])), x1: Math.max(...mp.map((p) => p[0])), y0: Math.min(...mp.map((p) => p[1])), y1: Math.max(...mp.map((p) => p[1])) };
  const near = (s: RoofGeometry['structures'][number]): boolean => s.footprint.some((p) => p[0] > mb.x0 - 4 && p[0] < mb.x1 + 4 && p[1] > mb.y0 - 4 && p[1] < mb.y1 + 4);
  const pts = (mainOnly ? mains : g.structures.filter((s) => s.kind === 'main' || near(s))).flatMap((s) => s.footprint).concat(g.facets.flatMap((x) => x.polygon));
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const scale = Math.min((w - 2 * pad) / Math.max(maxX - minX, 1), (h - 2 * pad - 30) / Math.max(maxY - minY, 1));
  return { w, h, scale, ox: (w - (maxX - minX) * scale) / 2, oy: (h - 30 - (maxY - minY) * scale) / 2, minX, maxY };
}
const X = (v: View, x: number): number => v.ox + (x - v.minX) * v.scale;
const Y = (v: View, y: number): number => v.oy + (v.maxY - y) * v.scale;
const path = (v: View, ring: Pt[]): string => ring.map((p, i) => `${i ? 'L' : 'M'}${f1(X(v, p[0]))} ${f1(Y(v, p[1]))}`).join(' ') + ' Z';

/** Point inside the polygon that is as far from its edges as a coarse grid search can find (label anchor). */
export function labelPoint(ring: Pt[]): Pt {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  let best: Pt = [(minX + maxX) / 2, (minY + maxY) / 2];
  let bestD = -1;
  for (let i = 1; i < 16; i++) {
    for (let j = 1; j < 16; j++) {
      const p: Pt = [minX + ((maxX - minX) * i) / 16, minY + ((maxY - minY) * j) / 16];
      if (!pointInRing(p, ring)) continue;
      let d = Infinity;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k] as Pt;
        const b = ring[(k + 1) % ring.length] as Pt;
        const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
        d = Math.min(d, Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1]))));
      }
      if (d > bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

function northArrow(v: View): string {
  const x = v.w - 40;
  return `<g aria-label="North"><path d="M${x} 24 L${x - 8} 52 L${x} 46 L${x + 8} 52 Z" fill="${CHARCOAL}"/><text x="${x}" y="68" font-size="12" font-weight="700" text-anchor="middle" fill="${CHARCOAL}" font-family="${FONT}">N</text></g>`;
}

function scaleBar(v: View): string {
  const nice = [5, 10, 20, 25, 50, 100].find((ft) => ft * 0.3048 * v.scale >= 60) ?? 100;
  const len = nice * 0.3048 * v.scale;
  const x = 24;
  const y = v.h - 44;
  return `<g><path d="M${x} ${y} h${f1(len)} M${x} ${y - 4} v8 M${x + len} ${y - 4} v8" stroke="${CHARCOAL}" stroke-width="1.2" fill="none"/><text x="${x + len / 2}" y="${y - 8}" font-size="10" text-anchor="middle" fill="${CHARCOAL}" font-family="${FONT}">${nice} ft</text></g>`;
}

function legend(items: Array<{ label: string; color: string; dashed?: boolean }>, v: View): string {
  const y = v.h - 18;
  let x = 24;
  let out = '';
  for (const it of items) {
    out += it.dashed
      ? `<line x1="${x}" x2="${x + 14}" y1="${y - 3}" y2="${y - 3}" stroke="${it.color}" stroke-width="2.5" stroke-dasharray="4 2"/>`
      : `<rect x="${x}" y="${y - 8}" width="14" height="10" fill="${it.color}" stroke="${CHARCOAL}" stroke-width="0.5"/>`;
    out += `<text x="${x + 19}" y="${y}" font-size="10" fill="${CHARCOAL}" font-family="${FONT}">${esc(it.label)}</text>`;
    x += 26 + it.label.length * 5.6;
  }
  return out;
}

const pitchRank = (g: RoofGeometry): Map<string, number> => {
  const labels = [...new Set(g.facets.map((x) => x.pitchLabel))].sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b));
  return new Map(labels.map((l, i) => [l, i]));
};

function frame(w: number, h: number, body: string, title: string, v: View, legendSvg: string, extraNote?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}"><rect width="${w}" height="${h}" fill="#ffffff"/>${body}${northArrow(v)}${scaleBar(v)}${legendSvg}<text x="24" y="26" font-size="14" font-weight="700" fill="${CHARCOAL}" font-family="${FONT}">${esc(title)}</text>${extraNote ? `<text x="24" y="42" font-size="10" fill="${GREY}" font-family="${FONT}">${esc(extraNote)}</text>` : ''}</svg>`;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const boxAt = (cx: number, cy: number, w: number, h: number): Box => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });

/** Placement of text labels without overlaps. Everything placed is remembered; later labels avoid it. */
class Labels {
  private placed: Box[] = [];
  free(b: Box): boolean { return !this.placed.some((p) => hit(p, b)); }
  take(b: Box): void { this.placed.push(b); }
}

type Anchor = { x: number; y: number };

/** Candidate label centres inside a polygon, best (furthest from the boundary) first, in diagram pixels. */
function candidates(ring: Pt[], v: View): Anchor[] {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const out: Array<{ a: Anchor; d: number }> = [];
  const n = 18;
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < n; j++) {
      const p: Pt = [minX + ((maxX - minX) * i) / n, minY + ((maxY - minY) * j) / n];
      if (!pointInRing(p, ring)) continue;
      let d = Infinity;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k] as Pt;
        const b = ring[(k + 1) % ring.length] as Pt;
        const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
        d = Math.min(d, Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1]))));
      }
      out.push({ a: { x: X(v, p[0]), y: Y(v, p[1]) }, d });
    }
  }
  return out.sort((p, q) => q.d - p.d).map((o) => o.a);
}

export type DiagramOptions = {
  width?: number;
  height?: number;
  highlightEdge?: string | null;
  /** Report mode: no title, legend or note inside the drawing (the page supplies them), larger drawing area. */
  bare?: boolean;
  /** Draw neighbouring structures (dashed, outline only) even on detail diagrams. */
  showExtras?: boolean;
};

const textW = (s: string, size: number): number => s.length * size * 0.56;

export function renderDiagram(g: RoofGeometry, kind: DiagramKind, opts: DiagramOptions = {}): string {
  const w = opts.width ?? 900;
  const h = opts.height ?? 640;
  const bare = Boolean(opts.bare);
  // Only the overall outline shows neighbouring structures; the detail diagrams zoom to the measured building.
  const mainOnly = kind !== 'outline' && !opts.showExtras;
  const v = viewFor(g, w, h, mainOnly, bare ? 30 : 56);
  let body = '';
  const labels = new Labels();
  const extra = mainOnly ? [] : g.structures.filter((s) => s.kind === 'additional');
  for (const s of mainOnly ? g.structures.filter((x) => x.kind === 'main') : g.structures) {
    body += `<path d="${path(v, s.footprint)}" fill="${s.kind === 'main' ? '#f7f7f7' : '#fcfcfc'}" stroke="${CHARCOAL}" stroke-width="${s.kind === 'main' ? 1.4 : 1}" ${s.kind === 'additional' ? 'stroke-dasharray="5 3"' : ''}/>`;
    if (s.kind === 'additional') {
      const c = labelPoint(s.footprint);
      body += `<text x="${f1(X(v, c[0]))}" y="${f1(Y(v, c[1]))}" font-size="9" text-anchor="middle" fill="${GREY}" font-family="${FONT}">${esc(s.id)} (outline only)</text>`;
    }
  }
  const ranks = pitchRank(g);
  if (kind !== 'outline') {
    for (const fc of g.facets) {
      const fill = kind === 'pitch' ? (fc.flat ? '#f1f1f1' : (FILLS[(ranks.get(fc.pitchLabel) ?? 0) % FILLS.length] as string)) : kind === 'edges' ? '#fafafa' : '#eef1f4';
      body += `<path d="${path(v, fc.polygon)}" fill="${fill}" fill-opacity="0.9" stroke="${kind === 'edges' ? '#c8c8c8' : '#5a5a5a'}" stroke-width="${kind === 'edges' ? 0.7 : 0.9}"/>`;
    }
    // Facet labels: largest facets first so small ones get the leftover room.
    const order = [...g.facets].sort((a, b) => b.planAreaM2 - a.planAreaM2);
    for (const fc of order) {
      const size = 9.5;
      const lines: string[] = kind === 'facets' ? [fc.id, fc.flat ? 'flat' : fc.pitchLabel] : kind === 'area' ? [fc.id, `${Math.round(fc.areaSqFt).toLocaleString('en-US')}`] : kind === 'pitch' ? [fc.id, fc.flat ? 'flat' : fc.pitchLabel, `${Math.round(fc.azimuthDegrees)}°`] : [fc.id];
      const arrow = kind === 'pitch' && !fc.flat;
      const lw = Math.max(...lines.map((t) => textW(t, size))) + 4;
      const lh = lines.length * (size + 2) + (arrow ? 16 : 0);
      const ring = fc.polygon;
      const tryFit = (ls: string[], hh: number, ww: number): { a: Anchor; box: Box } | null => {
        for (const a of candidates(ring, v)) {
          const box = boxAt(a.x, a.y, ww, hh);
          const corners: Pt[] = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
          if (!corners.every(([px, py]) => pointInRing([(px - v.ox) / v.scale + v.minX, v.maxY - (py - v.oy) / v.scale], ring))) continue;
          if (labels.free(box)) return { a, box };
        }
        void ls;
        return null;
      };
      let spot = tryFit(lines, lh, lw);
      let useLines = lines;
      let leader: Anchor | null = null;
      if (!spot) { // fall back to the facet id alone, then to a label beside the facet with a leader line
        useLines = [fc.id];
        spot = tryFit(useLines, size + 4, textW(fc.id, size) + 4);
        if (!spot) {
          const c = labelPoint(ring);
          const cx = X(v, c[0]);
          const cy = Y(v, c[1]);
          for (let r = 18; r <= 110 && !spot; r += 12) {
            for (let k = 0; k < 12 && !spot; k++) {
              const ang = (k / 12) * Math.PI * 2;
              const box = boxAt(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, textW(fc.id, size) + 4, size + 4);
              if (box.x0 > 4 && box.y0 > 4 && box.x1 < w - 4 && box.y1 < h - 4 && labels.free(box)) { spot = { a: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, box }; leader = { x: cx, y: cy }; }
            }
          }
        }
      }
      if (!spot) continue; // the table keeps every value even when the drawing has no room for it
      labels.take(spot.box);
      const cx = spot.a.x;
      const cy = spot.a.y;
      if (leader) body += `<line x1="${f1(leader.x)}" y1="${f1(leader.y)}" x2="${f1(cx)}" y2="${f1(cy)}" stroke="${GREY}" stroke-width="0.6"/>`;
      if (arrow && useLines === lines) {
        const a = (fc.azimuthDegrees * Math.PI) / 180;
        const dx = Math.sin(a);
        const dy = -Math.cos(a);
        const ay = cy - ((lines.length * (size + 2)) / 2) - 9;
        const L = 11;
        body += `<g stroke="${CHARCOAL}" fill="${CHARCOAL}"><line x1="${f1(cx - dx * L)}" y1="${f1(ay - dy * L)}" x2="${f1(cx + dx * L)}" y2="${f1(ay + dy * L)}" stroke-width="1.3"/><path d="M${f1(cx + dx * L)} ${f1(ay + dy * L)} l${f1(-dx * 6 - dy * 3.5)} ${f1(-dy * 6 + dx * 3.5)} l${f1(dy * 7)} ${f1(-dx * 7)} Z" stroke="none"/></g>`;
      }
      useLines.forEach((t, i) => {
        body += `<text x="${f1(cx)}" y="${f1(cy + (i - (useLines.length - 1) / 2) * (size + 2) + size * 0.35 + (arrow && useLines === lines ? 6 : 0))}" font-size="${i === 0 ? size + 0.5 : size}" font-weight="${i === 0 ? 700 : 400}" text-anchor="middle" fill="${CHARCOAL}" font-family="${FONT}">${esc(t)}</text>`;
      });
    }
  }
  if (kind === 'edges') {
    const drawn = [...g.edges].sort((a, b) => (b.lengthFt ?? 0) - (a.lengthFt ?? 0));
    for (const e of g.edges) {
      const col = EDGE_COLOR[e.type];
      const x1 = X(v, e.a[0]), y1 = Y(v, e.a[1]), x2 = X(v, e.b[0]), y2 = Y(v, e.b[1]);
      if (e.a[0] === e.b[0] && e.a[1] === e.b[1]) continue; // manual edge without a drawn line
      const sure = e.verification === 'verified' || e.source === 'manual';
      body += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${col}" stroke-width="${e.id === opts.highlightEdge ? 4.5 : 2.4}" stroke-linecap="round" ${sure ? '' : 'stroke-dasharray="6 3"'} opacity="${e.included ? 1 : 0.3}"/>`;
    }
    // Edge labels by priority: longest first, skipped when they would collide or the line is too short to carry one.
    for (const e of drawn) {
      if (!e.included || e.lengthFt === null || (e.a[0] === e.b[0] && e.a[1] === e.b[1])) continue;
      const x1 = X(v, e.a[0]), y1 = Y(v, e.a[1]), x2 = X(v, e.b[0]), y2 = Y(v, e.b[1]);
      const lenPx = Math.hypot(x2 - x1, y2 - y1);
      const text = ftLabel(e.lengthFt);
      const tw = textW(text, 8.5) + 4;
      if (lenPx < tw + 8) continue;
      let ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const nx = -(y2 - y1) / (lenPx || 1);
      const ny = (x2 - x1) / (lenPx || 1);
      for (const side of [1, -1]) {
        const lx = mx + nx * 7 * side;
        const ly = my + ny * 7 * side;
        // The rotated label is approximated by its axis-aligned bounds.
        const rad = (ang * Math.PI) / 180;
        const bw = Math.abs(Math.cos(rad)) * tw + Math.abs(Math.sin(rad)) * 10;
        const bh = Math.abs(Math.sin(rad)) * tw + Math.abs(Math.cos(rad)) * 10;
        const box = boxAt(lx, ly, bw, bh);
        if (!labels.free(box)) continue;
        labels.take(box);
        const tf = `translate(${f1(lx)} ${f1(ly + 3)}) rotate(${f1(ang)})`;
        body += `<text transform="${tf}" x="0" y="0" font-size="8.5" font-weight="700" text-anchor="middle" fill="#ffffff" stroke="#ffffff" stroke-width="3" font-family="${FONT}">${text}</text>`;
        body += `<text transform="${tf}" x="0" y="0" font-size="8.5" font-weight="700" text-anchor="middle" fill="${EDGE_COLOR[e.type]}" font-family="${FONT}">${text}</text>`;
        break;
      }
    }
  }
  if (bare) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}">${body}${northArrow(v)}${scaleBar(v)}</svg>`;
  }
  const approx = g.facets.some((f) => f.confidence === 'low') || g.status === 'partial';
  const titles: Record<DiagramKind, string> = { outline: 'Roof outline', facets: 'Roof facets', area: 'Facet areas', pitch: 'Pitch and direction', edges: 'Roof edges and lengths' };
  const note = kind === 'edges' ? 'Dashed lines are derived from elevation data and not yet field verified; solid lines are verified.' : kind === 'area' ? 'Facet areas in square feet.' : approx ? 'Some outlines are approximate (see notes).' : undefined;
  let leg: string;
  if (kind === 'edges') {
    const used = [...new Set(g.edges.filter((e) => e.included).map((e) => e.type))] as GeometryEdgeType[];
    leg = legend(used.map((t) => ({ label: EDGE_TYPE_LABEL[t], color: EDGE_COLOR[t], dashed: true })), v);
  } else if (kind === 'pitch') {
    leg = legend([...ranks.keys()].map((l) => ({ label: `${l} pitch`, color: FILLS[(ranks.get(l) ?? 0) % FILLS.length] as string })).concat([{ label: 'arrow = downhill', color: CHARCOAL }]), v);
  } else {
    leg = legend([{ label: 'Main building', color: '#f6f6f6' }, ...(extra.length ? [{ label: 'Other structure (outline only)', color: '#fafafa' }] : [])], v);
  }
  return frame(w, h, body, titles[kind], v, leg, note);
}

/** Overlay for the aerial image, in the image's own pixel space: building outline, facet lines and an address pin. */
export function renderAerialOverlay(g: RoofGeometry, centerLocal: Pt = [0, 0]): string | null {
  const im = g.imagery;
  if (!im) return null;
  const sx = im.widthPx / (im.extent.maxX - im.extent.minX);
  const sy = im.heightPx / (im.extent.maxY - im.extent.minY);
  const P = (p: Pt): string => `${f1((p[0] - im.extent.minX) * sx)} ${f1((im.extent.maxY - p[1]) * sy)}`;
  const ring = (r: Pt[]): string => r.map((p, i) => `${i ? 'L' : 'M'}${P(p)}`).join(' ') + ' Z';
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${im.widthPx} ${im.heightPx}" width="${im.widthPx}" height="${im.heightPx}">`;
  for (const f of g.facets) out += `<path d="${ring(f.polygon)}" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="${Math.max(1, im.widthPx / 700)}"/>`;
  for (const s of g.structures) out += `<path d="${ring(s.footprint)}" fill="none" stroke="#c32930" stroke-width="${Math.max(2, im.widthPx / 330)}" ${s.kind === 'additional' ? 'stroke-dasharray="8 5"' : ''}/>`;
  const pin = P(centerLocal).split(' ').map(Number);
  const r = Math.max(5, im.widthPx / 120);
  out += `<circle cx="${pin[0]}" cy="${pin[1]}" r="${f1(r)}" fill="#c32930" stroke="#ffffff" stroke-width="${f1(r / 3)}"/></svg>`;
  return out;
}

/**
 * Fallback when no outline could be extracted: one dashed rectangle per Google segment bounding box, loudly labelled.
 * It is NOT a roof outline and is never presented as one.
 */
export function renderApproximateDiagram(segments: Array<{ id: string; pitchLabel: string; areaSqFt: number; boundingBox: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } } | null }>, w = 900, h = 640): string {
  const boxed = segments.filter((s) => s.boundingBox);
  const lat0 = boxed.reduce((a, s) => a + (s.boundingBox!.sw.latitude + s.boundingBox!.ne.latitude) / 2, 0) / Math.max(boxed.length, 1);
  const lng0 = boxed.reduce((a, s) => a + (s.boundingBox!.sw.longitude + s.boundingBox!.ne.longitude) / 2, 0) / Math.max(boxed.length, 1);
  const mx = (lng: number): number => (lng - lng0) * Math.cos((lat0 * Math.PI) / 180) * 111_320;
  const my = (lat: number): number => (lat - lat0) * 110_540;
  const xs = boxed.flatMap((s) => [mx(s.boundingBox!.sw.longitude), mx(s.boundingBox!.ne.longitude)]);
  const ys = boxed.flatMap((s) => [my(s.boundingBox!.sw.latitude), my(s.boundingBox!.ne.latitude)]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((w - 120) / Math.max(maxX - minX, 1), (h - 160) / Math.max(maxY - minY, 1));
  let body = '';
  for (const s of boxed) {
    const b = s.boundingBox!;
    const x = 60 + (mx(b.sw.longitude) - minX) * scale;
    const y = 70 + (maxY - my(b.ne.latitude)) * scale;
    body += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1((mx(b.ne.longitude) - mx(b.sw.longitude)) * scale)}" height="${f1((my(b.ne.latitude) - my(b.sw.latitude)) * scale)}" fill="#757575" fill-opacity="0.12" stroke="${GREY}" stroke-dasharray="6 4"/><text x="${f1(x + 5)}" y="${f1(y + 14)}" font-size="11" font-weight="700" fill="${CHARCOAL}" font-family="${FONT}">${esc(s.id)} ${esc(s.pitchLabel)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}"><rect width="${w}" height="${h}" fill="#ffffff"/>${body}<text x="24" y="26" font-size="14" font-weight="700" fill="#c32930" font-family="${FONT}">APPROXIMATE: roof outline not available</text><text x="24" y="44" font-size="10" fill="${GREY}" font-family="${FONT}">Dashed rectangles are Google's bounding boxes for each roof segment. They are not the true roof shape.</text></svg>`;
}

export const footprintAreaM2 = (ring: Pt[]): number => Math.abs(ringArea(ring));
export type { DerivedEdge };
