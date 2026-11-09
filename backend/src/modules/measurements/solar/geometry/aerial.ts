import { PNG } from 'pngjs';
import type { GeometryImagery, RoofGeometry } from './types.js';
import { pixelToLocal, type GeoRaster, type LocalFrame } from './raster.js';

export const MAX_AERIAL_PX = 1600;

/**
 * Crops the Google RGB raster around the building and encodes it as a PNG (a derived report asset).
 * It is aerial imagery, not an inspection photograph. Proportions are preserved (square pixels, no stretching);
 * images larger than {@link MAX_AERIAL_PX} are box-averaged down by a whole factor.
 */
export function renderAerialPng(rgb: GeoRaster, f: LocalFrame, focus: { minX: number; maxX: number; minY: number; maxY: number }, marginM = 8): { png: Buffer; imagery: Pick<GeometryImagery, 'extent' | 'widthPx' | 'heightPx'> } | null {
  if (rgb.bands.length < 3) return null;
  const col0 = Math.max(0, Math.floor((focus.minX + f.cx - marginM - rgb.originX) / rgb.pixel));
  const col1 = Math.min(rgb.width, Math.ceil((focus.maxX + f.cx + marginM - rgb.originX) / rgb.pixel));
  const row0 = Math.max(0, Math.floor((rgb.originY - (focus.maxY + f.cy + marginM)) / rgb.pixel));
  const row1 = Math.min(rgb.height, Math.ceil((rgb.originY - (focus.minY + f.cy - marginM)) / rgb.pixel));
  const w = col1 - col0;
  const h = row1 - row0;
  if (w < 8 || h < 8) return null;
  const k = Math.max(1, Math.ceil(Math.max(w, h) / MAX_AERIAL_PX));
  const ow = Math.floor(w / k);
  const oh = Math.floor(h / k);
  const png = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = (row0 + y * k + dy) * rgb.width + col0 + x * k + dx;
          r += (rgb.bands[0] as ArrayLike<number>)[i] as number;
          g += (rgb.bands[1] as ArrayLike<number>)[i] as number;
          b += (rgb.bands[2] as ArrayLike<number>)[i] as number;
        }
      }
      const o = (y * ow + x) * 4;
      const n = k * k;
      png.data[o] = Math.round(r / n);
      png.data[o + 1] = Math.round(g / n);
      png.data[o + 2] = Math.round(b / n);
      png.data[o + 3] = 255;
    }
  }
  const tl = pixelToLocal(rgb, f, col0, row0);
  const br = pixelToLocal(rgb, f, col0 + ow * k, row0 + oh * k);
  return { png: PNG.sync.write(png), imagery: { extent: { minX: tl[0], maxX: br[0], minY: br[1], maxY: tl[1] }, widthPx: ow, heightPx: oh } };
}

export function geometryBounds(g: RoofGeometry): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const pts = g.structures.flatMap((s) => s.footprint).concat(g.facets.flatMap((x) => x.polygon));
  if (pts.length === 0) return null;
  return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
}
