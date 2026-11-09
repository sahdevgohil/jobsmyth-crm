/**
 * Address -> point for storm searches. Never falls back to a ZIP centroid.
 *
 * Providers (STORM_GEOCODER = auto | google | census | none):
 *  - google: Google Geocoding API with the server-side key (GOOGLE_SOLAR_API_KEY must have the Geocoding API enabled).
 *            ROOFTOP results are labelled "rooftop"; RANGE_INTERPOLATED "street-address estimate".
 *  - census: US Census Bureau Geocoder (no key). Address-range interpolation along the street, labelled "street-address estimate".
 *  - none:   geocoding is switched off; searches by a saved property or coordinates still work.
 * Results are cached for 30 days.
 */
import { createHash } from 'node:crypto';
import { AppError } from '../../utils/errors.js';
import { validLatLng } from './geo.js';
import { StormGeocodeCacheModel } from './storm.model.js';

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  provider: 'google' | 'census';
  /** rooftop | street_estimate | approximate */
  accuracy: 'rooftop' | 'street_estimate' | 'approximate';
  /** True when the point is good enough to treat as the building location. */
  precise: boolean;
  cached: boolean;
};

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type GeocoderConfig = { mode: 'auto' | 'google' | 'census' | 'none'; googleKey?: string; fetchImpl?: Fetcher; googleUrl?: string; censusUrl?: string };

export function geocoderConfigFromEnv(): GeocoderConfig {
  const mode = (process.env.STORM_GEOCODER ?? 'auto').toLowerCase();
  return { mode: (['auto', 'google', 'census', 'none'].includes(mode) ? mode : 'auto') as GeocoderConfig['mode'], googleKey: process.env.GOOGLE_SOLAR_API_KEY };
}

export function geocoderStatus(cfg: GeocoderConfig): { provider: 'google' | 'census' | 'none'; configured: boolean; message: string } {
  const useGoogle = (cfg.mode === 'google' || cfg.mode === 'auto') && Boolean(cfg.googleKey);
  if (cfg.mode === 'none') return { provider: 'none', configured: false, message: 'Address geocoding is turned off (STORM_GEOCODER=none).' };
  if (useGoogle) return { provider: 'google', configured: true, message: 'Google Geocoding API (rooftop where Google can resolve it).' };
  if (cfg.mode === 'google') return { provider: 'none', configured: false, message: 'STORM_GEOCODER=google but no GOOGLE_SOLAR_API_KEY is set on the server.' };
  return { provider: 'census', configured: true, message: 'US Census Bureau geocoder (no key needed; street-address estimate, not rooftop).' };
}

const norm = (a: string): string => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function geocodeAddress(address: string, cfg: GeocoderConfig = geocoderConfigFromEnv()): Promise<GeocodeResult> {
  const q = address.trim();
  if (q.length < 5) throw new AppError({ status: 400, code: 'ADDRESS_INVALID', message: 'Enter a street address, city and state.' });
  const st = geocoderStatus(cfg);
  if (!st.configured) throw new AppError({ status: 503, code: 'GEOCODER_NOT_CONFIGURED', message: st.message });
  const key = createHash('sha1').update(`${st.provider}:${norm(q)}`).digest('hex');
  const hit = await StormGeocodeCacheModel.findOne({ key }).lean();
  if (hit) return { latitude: hit.latitude, longitude: hit.longitude, formattedAddress: hit.formattedAddress ?? '', provider: hit.provider as 'google' | 'census', accuracy: hit.accuracy as GeocodeResult['accuracy'], precise: Boolean(hit.precise), cached: true };

  const fetchImpl: Fetcher = cfg.fetchImpl ?? ((url, init) => fetch(url, init));
  let result: Omit<GeocodeResult, 'cached'>;
  try {
    result = st.provider === 'google' ? await viaGoogle(q, cfg, fetchImpl) : await viaCensus(q, cfg, fetchImpl);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError({ status: 502, code: 'GEOCODER_UNAVAILABLE', message: `The geocoder could not be reached: ${err instanceof Error ? err.message : String(err)}` });
  }
  await StormGeocodeCacheModel.updateOne({ key }, { $set: { provider: result.provider, latitude: result.latitude, longitude: result.longitude, formattedAddress: result.formattedAddress, accuracy: result.accuracy, precise: result.precise, createdAt: new Date() } }, { upsert: true });
  return { ...result, cached: false };
}

async function viaGoogle(q: string, cfg: GeocoderConfig, fetchImpl: Fetcher): Promise<Omit<GeocodeResult, 'cached'>> {
  const url = new URL(cfg.googleUrl ?? 'https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', q);
  url.searchParams.set('region', 'us');
  url.searchParams.set('key', cfg.googleKey as string);
  const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json()) as { status?: string; error_message?: string; results?: Array<{ formatted_address: string; partial_match?: boolean; geometry: { location: { lat: number; lng: number }; location_type: string } }> };
  switch (body.status) {
    case 'OK': break;
    case 'ZERO_RESULTS': throw new AppError({ status: 404, code: 'ADDRESS_NOT_FOUND', message: 'No match for that address. Check the street number, city and state.' });
    case 'REQUEST_DENIED': throw new AppError({ status: 502, code: 'GEOCODER_REJECTED', message: `Google rejected the geocoding request${body.error_message ? `: ${body.error_message}` : ''}. Enable the Geocoding API for the server key.` });
    case 'OVER_QUERY_LIMIT': case 'OVER_DAILY_LIMIT': throw new AppError({ status: 429, code: 'GEOCODER_LIMIT', message: 'The geocoding quota is used up. Try again later.' });
    default: throw new AppError({ status: 502, code: 'GEOCODER_UNAVAILABLE', message: `Google geocoding answered ${body.status ?? res.status}.` });
  }
  const r = body.results?.[0];
  if (!r) throw new AppError({ status: 404, code: 'ADDRESS_NOT_FOUND', message: 'No match for that address.' });
  const { lat, lng } = r.geometry.location;
  if (!validLatLng(lat, lng)) throw new AppError({ status: 502, code: 'GEOCODER_UNAVAILABLE', message: 'The geocoder returned an unusable point.' });
  const t = r.geometry.location_type;
  const accuracy: GeocodeResult['accuracy'] = t === 'ROOFTOP' ? 'rooftop' : t === 'RANGE_INTERPOLATED' ? 'street_estimate' : 'approximate';
  return { latitude: lat, longitude: lng, formattedAddress: r.formatted_address, provider: 'google', accuracy, precise: accuracy !== 'approximate' && !r.partial_match };
}

async function viaCensus(q: string, cfg: GeocoderConfig, fetchImpl: Fetcher): Promise<Omit<GeocodeResult, 'cached'>> {
  const url = new URL(cfg.censusUrl ?? 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address', q);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new AppError({ status: 502, code: 'GEOCODER_UNAVAILABLE', message: `The Census geocoder answered HTTP ${res.status}.` });
  const body = (await res.json()) as { result?: { addressMatches?: Array<{ matchedAddress: string; coordinates: { x: number; y: number } }> } };
  const m = body.result?.addressMatches?.[0];
  if (!m) throw new AppError({ status: 404, code: 'ADDRESS_NOT_FOUND', message: 'No match for that address. Check the street number, city and state.' });
  const { x, y } = m.coordinates;
  if (!validLatLng(y, x)) throw new AppError({ status: 502, code: 'GEOCODER_UNAVAILABLE', message: 'The geocoder returned an unusable point.' });
  return { latitude: y, longitude: x, formattedAddress: m.matchedAddress, provider: 'census', accuracy: 'street_estimate', precise: true };
}
