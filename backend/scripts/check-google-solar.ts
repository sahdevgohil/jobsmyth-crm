/** Real Google Solar connection check using the server env. Prints sanitized results only. Run: npx tsx --env-file=.env scripts/check-google-solar.ts */
import { loadEnv } from '../src/config/env.js';
import { GoogleSolarAdapter } from '../src/modules/measurements/solar/google-solar.adapter.js';
import { SolarError } from '../src/modules/measurements/solar/errors.js';

const env = loadEnv();
console.log('key loaded:', Boolean(env.GOOGLE_SOLAR_API_KEY), 'length:', env.GOOGLE_SOLAR_API_KEY?.length ?? 0);
if (!env.GOOGLE_SOLAR_API_KEY) process.exit(2);
const a = new GoogleSolarAdapter({ apiKey: env.GOOGLE_SOLAR_API_KEY });
for (const q of ['HIGH', 'BASE'] as const) {
  try {
    const r = await a.findClosestBuilding(37.445, -122.139, q);
    console.log(q, 'OK', { quality: r.imageryQuality, date: r.imageryDate, segments: r.solarPotential?.roofSegmentStats?.length ?? 0 });
    break;
  } catch (e) {
    console.log(q, 'FAILED', e instanceof SolarError ? { code: e.code, http: e.httpStatus, message: e.message } : String(e));
  }
}
try {
  const g = await a.geocode('1600 Amphitheatre Parkway, Mountain View, CA');
  console.log('geocode OK', g[0]?.locationType);
} catch (e) {
  console.log('geocode FAILED', e instanceof SolarError ? { code: e.code, http: e.httpStatus } : String(e));
}
