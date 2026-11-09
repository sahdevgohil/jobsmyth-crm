/** Dev probe: fetches Data Layers for one coordinate and prints sanitized raster metadata. Spends one Data Layers request + 3 downloads. */
import { writeFileSync } from 'node:fs';
import { fromArrayBuffer } from 'geotiff';
import { loadEnv } from '../src/config/env.js';

const env = loadEnv();
const key = env.GOOGLE_SOLAR_API_KEY!;
const [lat, lng, radius, px, outDir] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4] ?? 40), Number(process.argv[5] ?? 0.25), process.argv[6] ?? '.'];
const u = new URL('https://solar.googleapis.com/v1/dataLayers:get');
u.searchParams.set('location.latitude', String(lat)); u.searchParams.set('location.longitude', String(lng));
u.searchParams.set('radiusMeters', String(radius)); u.searchParams.set('view', 'IMAGERY_LAYERS'); u.searchParams.set('requiredQuality', 'BASE'); u.searchParams.set('pixelSizeMeters', String(px)); u.searchParams.set('key', key);
const res = await fetch(u);
const j = (await res.json()) as Record<string, unknown>;
console.log('status', res.status, Object.keys(j));
if (res.status !== 200) { console.log(JSON.stringify(j).replace(key, '[k]').slice(0, 300)); process.exit(1); }
console.log({ imageryDate: j.imageryDate, quality: j.imageryQuality });
for (const name of ['rgbUrl', 'dsmUrl', 'maskUrl'] as const) {
  const r = await fetch(`${String(j[name])}&key=${key}`);
  const buf = await r.arrayBuffer();
  console.log(name, r.status, r.headers.get('content-type'), buf.byteLength);
  writeFileSync(`${outDir}/${name}.tif`, Buffer.from(buf));
  const img = await (await fromArrayBuffer(buf)).getImage();
  console.log('  ', img.getWidth(), img.getHeight(), 'spp', img.getSamplesPerPixel(), 'origin', img.getOrigin(), 'res', img.getResolution(), 'geokeys', img.getGeoKeys(), 'nodata', img.getGDALNoData(), 'fd', img.getFileDirectory().BitsPerSample, img.getFileDirectory().SampleFormat);
}
