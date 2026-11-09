/**
 * Minimal GeoTIFF writer for tests: uncompressed, single strip, little-endian. Produces files shaped like Google's
 * Data Layers output (UTM CRS, square pixels, 8-bit RGB / 8-bit mask / float32 DSM) from the synthetic rasters.
 */
import type { GeoRaster } from './raster.js';

type Entry = { tag: number; type: 1 | 2 | 3 | 4 | 12; count: number; data: Buffer };

const u16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const f64 = (n: number): Buffer => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; };

export function writeGeoTiff(r: GeoRaster, kind: 'rgb' | 'dsm' | 'mask'): ArrayBuffer {
  const spp = kind === 'rgb' ? 3 : 1;
  const bytes = kind === 'dsm' ? 4 : 1;
  const pix = Buffer.alloc(r.width * r.height * spp * bytes);
  for (let i = 0; i < r.width * r.height; i++) {
    for (let b = 0; b < spp; b++) {
      const v = (r.bands[b] as ArrayLike<number>)[i] as number;
      if (kind === 'dsm') pix.writeFloatLE(v, (i * spp + b) * 4);
      else pix[i * spp + b] = v;
    }
  }
  const nodata = kind === 'dsm' ? null : '0';
  const geoKeys = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, r.epsg];
  const entries: Entry[] = ([
    { tag: 256, type: 4, count: 1, data: u32(r.width) },
    { tag: 257, type: 4, count: 1, data: u32(r.height) },
    { tag: 258, type: 3, count: spp, data: Buffer.concat(Array.from({ length: spp }, () => u16(bytes * 8))) },
    { tag: 259, type: 3, count: 1, data: u16(1) },
    { tag: 262, type: 3, count: 1, data: u16(kind === 'rgb' ? 2 : 1) },
    { tag: 273, type: 4, count: 1, data: u32(0) }, // patched below
    { tag: 277, type: 3, count: 1, data: u16(spp) },
    { tag: 278, type: 4, count: 1, data: u32(r.height) },
    { tag: 279, type: 4, count: 1, data: u32(pix.length) },
    { tag: 284, type: 3, count: 1, data: u16(1) },
    { tag: 339, type: 3, count: spp, data: Buffer.concat(Array.from({ length: spp }, () => u16(kind === 'dsm' ? 3 : 1))) },
    { tag: 33550, type: 12, count: 3, data: Buffer.concat([f64(r.pixel), f64(r.pixel), f64(0)]) },
    { tag: 33922, type: 12, count: 6, data: Buffer.concat([f64(0), f64(0), f64(0), f64(r.originX), f64(r.originY), f64(0)]) },
    { tag: 34735, type: 3, count: geoKeys.length, data: Buffer.concat(geoKeys.map(u16)) },
    ...(nodata ? [{ tag: 42113, type: 2 as const, count: nodata.length + 1, data: Buffer.from(`${nodata}\0`, 'latin1') }] : []),
  ] as Entry[]).sort((a, b) => a.tag - b.tag);

  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = 8 + ifdSize;
  const placed = entries.map((e) => {
    if (e.data.length <= 4) return { e, offset: -1 };
    const offset = extra;
    extra += e.data.length + (e.data.length % 2);
    return { e, offset };
  });
  const stripOffset = extra;
  const out = Buffer.alloc(stripOffset + pix.length);
  out.write('II', 0);
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  out.writeUInt16LE(entries.length, 8);
  placed.forEach(({ e, offset }, i) => {
    const o = 10 + i * 12;
    out.writeUInt16LE(e.tag, o);
    out.writeUInt16LE(e.type, o + 2);
    out.writeUInt32LE(e.count, o + 4);
    const data = e.tag === 273 ? u32(stripOffset) : e.data;
    if (offset < 0) data.copy(out, o + 8);
    else { out.writeUInt32LE(offset, o + 8); data.copy(out, offset); }
  });
  pix.copy(out, stripOffset);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length) as ArrayBuffer;
}
