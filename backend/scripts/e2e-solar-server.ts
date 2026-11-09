/**
 * TEST-ONLY API server for browser tests of the roof measurement workflow.
 *
 * It runs the normal app with the Google adapter wired to deterministic FIXTURE responses (never live Google).
 * It refuses to start unless NODE_ENV=test and E2E_MOCK_GOOGLE=1, and the adapter override itself is
 * disabled outside NODE_ENV=test, so this cannot run in production.
 *
 *   NODE_ENV=test E2E_MOCK_GOOGLE=1 PORT=4100 MONGODB_URI=... CORS_ORIGINS=http://localhost:5180 \
 *     npx tsx --env-file=.env scripts/e2e-solar-server.ts
 */
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { connectMongo } from '../src/db/connection.js';
import { geocodeFixture } from '../src/modules/measurements/solar/fixtures.js';
import { GABLE, insightsFor, makeRasters } from '../src/modules/measurements/solar/geometry/fixtures.js';
import { writeGeoTiff } from '../src/modules/measurements/solar/geometry/tiff-fixture.js';
import { GoogleSolarAdapter } from '../src/modules/measurements/solar/google-solar.adapter.js';
import { setSolarAdapterForTests } from '../src/modules/measurements/solar/solar.service.js';
import { setIngestDepsForTests } from '../src/modules/storm/storm.routes.js';

if (process.env.NODE_ENV !== 'test' || process.env.E2E_MOCK_GOOGLE !== '1') {
  console.error('Refusing to start: this server uses mock Google responses and needs NODE_ENV=test and E2E_MOCK_GOOGLE=1.');
  process.exit(1);
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

loadEnv();
setSolarAdapterForTests(
  new GoogleSolarAdapter({
    apiKey: 'E2E-MOCK-KEY-NOT-GOOGLE',
    fetchImpl: async (u) => {
      const url = new URL(String(u));
      if (url.pathname.includes('geocode')) {
        // Echo the street number typed by the test so each run measures a brand-new address (the CRM reuses recent results).
        const n = (url.searchParams.get('address') ?? '').trim().split(/\s+/)[0] ?? '500';
        const fx = geocodeFixture(true) as { results: Array<{ formatted_address: string; address_components: Array<{ long_name: string; short_name: string; types: string[] }> }> };
        const r = fx.results[0]!;
        r.formatted_address = r.formatted_address.replace('500', n);
        const c = r.address_components.find((x) => x.types.includes('street_number'))!;
        c.long_name = n;
        c.short_name = n;
        return json(200, fx);
      }
      // Synthetic gable roof: Building Insights, plus Data Layers rasters generated from the same plane equations.
      if (url.pathname.includes('buildingInsights')) return json(200, insightsFor(GABLE));
      if (url.pathname.includes('dataLayers')) {
        const link = (id: string): string => `https://solar.googleapis.com/v1/solar/geoTiff:get?id=${id}`;
        return json(200, { imageryDate: { year: 2024, month: 5, day: 20 }, imageryQuality: 'HIGH', rgbUrl: link('rgb'), dsmUrl: link('dsm'), maskUrl: link('mask') });
      }
      if (url.pathname.includes('geoTiff')) {
        const set = makeRasters(GABLE);
        const id = url.searchParams.get('id');
        return new Response(id === 'rgb' ? writeGeoTiff(set.rgb!, 'rgb') : id === 'dsm' ? writeGeoTiff(set.dsm, 'dsm') : writeGeoTiff(set.mask, 'mask'), { status: 200, headers: { 'Content-Type': 'image/tiff' } });
      }
      return json(404, { error: { status: 'NOT_FOUND' } });
    },
  }),
);

// ---- Storm data: the browser tests never reach NOAA or a geocoder. SPC/NCEI calls are served from the real sample files
// in src/modules/storm/fixtures, and the address lookup returns one fixed point (Waupun, WI) so searches are repeatable.
const stormFixture = (n: string): string => readFileSync(new URL(`../src/modules/storm/fixtures/${n}`, import.meta.url), 'utf8');
// A new nonce per server start makes each start's "today" reports new records (their ids hash the location text), so a fresh start can show alerts.
const nonce = Date.now().toString(36);
const stamped = (csv: string): string => csv.split('\n').map((l, i) => (i === 0 ? l : l.replace(/^([^,]*,[^,]*,)([^,]*)/, `$1$2 [${nonce}]`))).join('\n');
setIngestDepsForTests({
  fetchText: async (url) => {
    if (url.includes('swdi/stormevents')) return { ok: true, status: 200, text: async () => '<a href="StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz">f</a>' };
    const m = /_rpts_filtered_(hail|wind)\.csv/.exec(url);
    if (m) return { ok: true, status: 200, text: async () => stamped(stormFixture(`spc_240520_filtered_${m[1]}.csv`)) }; // any requested day gets the sample rows
    return { ok: false, status: 404, text: async () => '' };
  },
  openGzipText: async () => Readable.from([Buffer.from(stormFixture('ncei_details_sample.csv'))]),
});
process.env.STORM_GEOCODER = 'census';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u.includes('geocoding.geo.census.gov')) return json(200, { result: { addressMatches: [{ matchedAddress: 'W1234 TEST RD, WAUPUN, WI, 53963', coordinates: { x: -88.77, y: 43.63 } }] } });
  return realFetch(input, init);
}) as typeof fetch;
await connectMongo();
const port = Number(process.env.PORT ?? 4100);
createApp().listen(port, () => console.log(`E2E (mock Google) API listening on ${port}`));
