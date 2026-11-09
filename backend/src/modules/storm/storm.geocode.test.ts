import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { geocodeAddress, geocoderStatus } from './storm.geocode.js';

const json = (body: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

describe('storm geocoding (mocked HTTP; no live geocoder is called)', () => {
  beforeAll(async () => { await startTestDb(); }, 120_000);
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await clearCollections(); });

  const google = (fetchImpl: never) => ({ mode: 'google' as const, googleKey: 'TEST-KEY-1234567890', fetchImpl });

  it('uses Google rooftop results and labels them as rooftop', async () => {
    const calls: string[] = [];
    const f = (async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ status: 'OK', results: [{ formatted_address: '1532 Rebecca Ln, Lancaster, TX 75134, USA', geometry: { location: { lat: 32.5921, lng: -96.7561 }, location_type: 'ROOFTOP' } }] }) }; }) as never;
    const g = await geocodeAddress('1532 Rebecca Lane, Lancaster, TX 75134', google(f));
    expect(g).toMatchObject({ provider: 'google', accuracy: 'rooftop', precise: true, cached: false, latitude: 32.5921 });
    expect(calls[0]).toContain('key=TEST-KEY-1234567890'); // the key goes only to Google, server side
  });
  it('caches results so the same address is not geocoded twice', async () => {
    let n = 0;
    const f = (async () => { n += 1; return { ok: true, status: 200, json: async () => ({ status: 'OK', results: [{ formatted_address: 'x', geometry: { location: { lat: 30.1, lng: -97.1 }, location_type: 'ROOFTOP' } }] }) }; }) as never;
    await geocodeAddress('10 Main St, Austin, TX', google(f));
    const again = await geocodeAddress('10  MAIN st,  austin TX', google(f));
    expect(n).toBe(1);
    expect(again.cached).toBe(true);
  });
  it('a ZIP or city-level match is not treated as the building location', async () => {
    const f = json({ status: 'OK', results: [{ formatted_address: 'Austin, TX 78701', partial_match: true, geometry: { location: { lat: 30.27, lng: -97.74 }, location_type: 'APPROXIMATE' } }] }) as never;
    const g = await geocodeAddress('78701', google(f));
    expect(g).toMatchObject({ accuracy: 'approximate', precise: false });
  });
  it('maps Google failures to clear errors', async () => {
    await expect(geocodeAddress('Nowhere at all 99999', google(json({ status: 'ZERO_RESULTS', results: [] }) as never))).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND', status: 404 });
    await expect(geocodeAddress('1 A St, B, TX', google(json({ status: 'REQUEST_DENIED', error_message: 'API key invalid' }) as never))).rejects.toMatchObject({ code: 'GEOCODER_REJECTED' });
    await expect(geocodeAddress('2 A St, B, TX', google(json({ status: 'OVER_QUERY_LIMIT' }) as never))).rejects.toMatchObject({ code: 'GEOCODER_LIMIT', status: 429 });
    await expect(geocodeAddress('3 A St, B, TX', google((async () => { throw new Error('ECONNRESET'); }) as never))).rejects.toMatchObject({ code: 'GEOCODER_UNAVAILABLE' });
    await expect(geocodeAddress('abc', google(json({}) as never))).rejects.toMatchObject({ code: 'ADDRESS_INVALID' });
  });
  it('falls back to the free Census geocoder when no Google key is set, labelled as a street estimate', async () => {
    const f = json({ result: { addressMatches: [{ matchedAddress: '1532 REBECCA LN, LANCASTER, TX, 75134', coordinates: { x: -96.7561, y: 32.5921 } }] } }) as never;
    const g = await geocodeAddress('1532 Rebecca Lane, Lancaster, TX 75134', { mode: 'auto', fetchImpl: f });
    expect(g).toMatchObject({ provider: 'census', accuracy: 'street_estimate', precise: true });
    await expect(geocodeAddress('9 Nowhere Rd, Z, TX', { mode: 'census', fetchImpl: json({ result: { addressMatches: [] } }) as never })).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });
  it('reports honestly when geocoding is off or misconfigured instead of pretending', async () => {
    expect(geocoderStatus({ mode: 'none' })).toMatchObject({ provider: 'none', configured: false });
    expect(geocoderStatus({ mode: 'google' })).toMatchObject({ configured: false });
    expect(geocoderStatus({ mode: 'auto', googleKey: 'KEY-0123456789' })).toMatchObject({ provider: 'google', configured: true });
    expect(geocoderStatus({ mode: 'auto' })).toMatchObject({ provider: 'census', configured: true });
    await expect(geocodeAddress('1 Main St, Austin, TX', { mode: 'none' })).rejects.toMatchObject({ code: 'GEOCODER_NOT_CONFIGURED', status: 503 });
  });
});
