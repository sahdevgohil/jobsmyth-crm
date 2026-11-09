/**
 * Google Solar API + Geocoding API adapter. Server-side only: the API key never leaves this process.
 *
 * Endpoints (from the official docs, developers.google.com/maps/documentation/solar):
 *   GET https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude&location.longitude&requiredQuality&key
 *   GET https://solar.googleapis.com/v1/dataLayers:get?location.latitude&location.longitude&radiusMeters&view&requiredQuality&key
 *   GET https://maps.googleapis.com/maps/api/geocode/json?address&key        (Geocoding API, HTTP 200 + `status` field)
 * The key is sent as the `key` query parameter and is redacted from every error and log message.
 */
import { createHash } from 'node:crypto';
import { SolarError } from './errors.js';

export type ImageryQuality = 'HIGH' | 'MEDIUM' | 'BASE';
export type GoogleDate = { year: number; month: number; day: number };
export type LatLng = { latitude: number; longitude: number };

export type GoogleRoofSegmentStats = {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  stats?: { areaMeters2?: number; groundAreaMeters2?: number; sunshineQuantiles?: number[] };
  center?: LatLng;
  boundingBox?: { sw?: LatLng; ne?: LatLng };
  planeHeightAtCenterMeters?: number;
};

export type GoogleBuildingInsights = {
  name?: string;
  center?: LatLng;
  imageryDate?: GoogleDate;
  imageryProcessedDate?: GoogleDate;
  imageryQuality?: ImageryQuality;
  postalCode?: string;
  administrativeArea?: string;
  regionCode?: string;
  solarPotential?: {
    wholeRoofStats?: { areaMeters2?: number; groundAreaMeters2?: number };
    buildingStats?: { areaMeters2?: number; groundAreaMeters2?: number };
    roofSegmentStats?: GoogleRoofSegmentStats[];
  };
};

export type GoogleDataLayers = {
  imageryDate?: GoogleDate;
  imageryProcessedDate?: GoogleDate;
  imageryQuality?: ImageryQuality;
  dsmUrl?: string;
  rgbUrl?: string;
  maskUrl?: string;
};

export type GeocodeCandidate = {
  formattedAddress: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  latitude: number;
  longitude: number;
  placeId: string;
  /** ROOFTOP and RANGE_INTERPOLATED are precise; APPROXIMATE (e.g. a ZIP centroid) is not. */
  locationType: string;
  partialMatch: boolean;
};

export type SolarAdapterConfig = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  solarBaseUrl?: string;
  geocodeUrl?: string;
};

const redact = (s: string, key: string): string => (key ? s.split(key).join('[redacted]') : s);

export class GoogleSolarAdapter {
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly solarBase: string;
  private readonly geocodeUrl: string;

  constructor(cfg: SolarAdapterConfig) {
    if (!cfg.apiKey) throw new SolarError('NOT_CONFIGURED');
    this.key = cfg.apiKey;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
    this.solarBase = cfg.solarBaseUrl ?? 'https://solar.googleapis.com/v1';
    this.geocodeUrl = cfg.geocodeUrl ?? 'https://maps.googleapis.com/maps/api/geocode/json';
  }

  /** One-way fingerprint of the key (never the key itself). */
  get keyFingerprint(): string {
    return createHash('sha256').update(`legacy-solar:${this.key}`).digest('hex').slice(0, 16);
  }

  private async get(url: URL): Promise<{ status: number; json: unknown }> {
    url.searchParams.set('key', this.key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url.toString(), { method: 'GET', signal: ctrl.signal, headers: { Accept: 'application/json' } });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new SolarError('TIMEOUT');
      // Never include err.message: Node's fetch errors can embed the request URL (and so the key).
      void redact((err as Error).message ?? '', this.key);
      throw new SolarError('NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Maps Google's error responses onto stable codes without exposing provider text. */
  private failure(status: number, json: unknown): SolarError {
    const e = (json as { error?: { status?: string; message?: string } } | null)?.error;
    const text = `${e?.status ?? ''} ${e?.message ?? ''}`.toLowerCase();
    if (status === 404 || e?.status === 'NOT_FOUND') return new SolarError('NOT_FOUND', status);
    if (status === 429 || e?.status === 'RESOURCE_EXHAUSTED') return new SolarError('QUOTA_EXCEEDED', status);
    if (status === 400) {
      if (text.includes('api key')) return new SolarError('AUTH_FAILED', status);
      return new SolarError('INVALID_COORDINATES', status);
    }
    if (status === 401) return new SolarError('AUTH_FAILED', status);
    if (status === 403) {
      if (text.includes('referer') || text.includes('ip address') || text.includes('restriction') || text.includes('blocked')) return new SolarError('KEY_RESTRICTED', status);
      if (text.includes('billing')) return new SolarError('BILLING_DISABLED', status);
      if (text.includes('has not been used') || text.includes('disabled') || text.includes('not enabled')) return new SolarError('API_DISABLED', status);
      return new SolarError('AUTH_FAILED', status);
    }
    return new SolarError('BAD_RESPONSE', status);
  }

  /** One Building Insights request at an exact required quality. 404 means no imagery of at least that quality. */
  async findClosestBuilding(latitude: number, longitude: number, quality: ImageryQuality): Promise<GoogleBuildingInsights> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new SolarError('INVALID_COORDINATES');
    }
    const url = new URL(`${this.solarBase}/buildingInsights:findClosest`);
    url.searchParams.set('location.latitude', latitude.toFixed(6));
    url.searchParams.set('location.longitude', longitude.toFixed(6));
    url.searchParams.set('requiredQuality', quality);
    const { status, json } = await this.get(url);
    if (status !== 200) throw this.failure(status, json);
    if (!json || typeof json !== 'object') throw new SolarError('BAD_RESPONSE', status);
    return json as GoogleBuildingInsights;
  }

  /** Alias kept for the documented operation name. */
  getBuildingInsights(latitude: number, longitude: number, quality: ImageryQuality): Promise<GoogleBuildingInsights> {
    return this.findClosestBuilding(latitude, longitude, quality);
  }

  /** Data Layers (GeoTIFF links). The returned URLs expire after one hour and are never stored. */
  async getDataLayers(latitude: number, longitude: number, opts: { radiusMeters?: number; view?: string; quality?: ImageryQuality; pixelSizeMeters?: number } = {}): Promise<GoogleDataLayers> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new SolarError('INVALID_COORDINATES');
    const url = new URL(`${this.solarBase}/dataLayers:get`);
    url.searchParams.set('location.latitude', latitude.toFixed(6));
    url.searchParams.set('location.longitude', longitude.toFixed(6));
    url.searchParams.set('radiusMeters', String(opts.radiusMeters ?? 50));
    url.searchParams.set('view', opts.view ?? 'IMAGERY_LAYERS');
    url.searchParams.set('requiredQuality', opts.quality ?? 'BASE');
    if (opts.pixelSizeMeters) url.searchParams.set('pixelSizeMeters', String(opts.pixelSizeMeters));
    const { status, json } = await this.get(url);
    if (status !== 200) throw this.failure(status, json);
    if (!json || typeof json !== 'object') throw new SolarError('BAD_RESPONSE', status);
    return json as GoogleDataLayers;
  }

  /**
   * Downloads one GeoTIFF named by a Data Layers response. The URL is only ever fetched when it points at solar.googleapis.com
   * over https (the response is untrusted input). The key is added here and never leaves the server. Links expire after
   * one hour, so callers must fetch right after `getDataLayers` and must not store the URL.
   */
  async downloadGeoTiff(link: string, opts: { maxBytes?: number; retries?: number } = {}): Promise<ArrayBuffer> {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new SolarError('BAD_RESPONSE');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'solar.googleapis.com') throw new SolarError('BAD_RESPONSE');
    url.searchParams.set('key', this.key);
    const maxBytes = opts.maxBytes ?? 40_000_000;
    const attempts = (opts.retries ?? 2) + 1;
    let last: SolarError = new SolarError('NETWORK');
    for (let i = 0; i < attempts; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.max(this.timeoutMs, 30_000));
      try {
        const res = await this.fetchImpl(url.toString(), { method: 'GET', signal: ctrl.signal });
        if (res.status !== 200) {
          const body = await res.json().catch(() => null);
          const err = this.failure(res.status, body);
          if (res.status < 500 && res.status !== 429) throw err; // retrying a rejected request cannot help
          last = err;
        } else {
          const declared = Number(res.headers.get('content-length') ?? 0);
          if (declared > maxBytes) throw new SolarError('BAD_RESPONSE', 200);
          const buf = await res.arrayBuffer();
          if (buf.byteLength > maxBytes || buf.byteLength < 8) throw new SolarError('BAD_RESPONSE', 200);
          return buf;
        }
      } catch (err) {
        if (err instanceof SolarError) {
          if (err.code !== 'NETWORK' && err.code !== 'TIMEOUT' && err.code !== 'QUOTA_EXCEEDED' && err.code !== 'BAD_RESPONSE') throw err;
          if (err.code === 'BAD_RESPONSE' && err.httpStatus === 200) throw err;
          last = err;
        } else {
          last = (err as Error).name === 'AbortError' ? new SolarError('TIMEOUT') : new SolarError('NETWORK');
        }
      } finally {
        clearTimeout(timer);
      }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
    throw last;
  }

  /** What imagery exists here (date, quality) without fetching any GeoTIFF. Billed as a Data Layers request. */
  async retrieveAvailableImagery(latitude: number, longitude: number): Promise<{ imageryDate?: GoogleDate; imageryProcessedDate?: GoogleDate; imageryQuality?: ImageryQuality }> {
    const d = await this.getDataLayers(latitude, longitude, { quality: 'BASE' });
    return { imageryDate: d.imageryDate, imageryProcessedDate: d.imageryProcessedDate, imageryQuality: d.imageryQuality };
  }

  /** Geocoding API. Returns candidates; geocoding locates an address, it does not measure a roof. */
  async geocode(address: string): Promise<GeocodeCandidate[]> {
    const q = address.trim();
    if (q.length < 5) throw new SolarError('GEOCODE_NO_RESULT');
    const url = new URL(this.geocodeUrl);
    url.searchParams.set('address', q);
    url.searchParams.set('components', 'country:US');
    const { status, json } = await this.get(url);
    type GeoResult = { formatted_address?: string; place_id?: string; partial_match?: boolean; geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }; address_components?: Array<{ long_name: string; short_name: string; types: string[] }> };
    const body = json as { status?: string; results?: GeoResult[] } | null;
    if (status !== 200 || !body) throw this.failure(status, json);
    switch (body.status) {
      case 'OK': break;
      case 'ZERO_RESULTS': throw new SolarError('GEOCODE_NO_RESULT');
      case 'OVER_QUERY_LIMIT':
      case 'OVER_DAILY_LIMIT': throw new SolarError('QUOTA_EXCEEDED');
      case 'REQUEST_DENIED': throw new SolarError('AUTH_FAILED');
      case 'INVALID_REQUEST': throw new SolarError('GEOCODE_NO_RESULT');
      default: throw new SolarError('BAD_RESPONSE');
    }
    const out: GeocodeCandidate[] = [];
    for (const r of body.results ?? []) {
      const loc = r.geometry?.location;
      if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') continue;
      const comp = (type: string, short = false): string => {
        const c = r.address_components?.find((x) => x.types.includes(type));
        return c ? (short ? c.short_name : c.long_name) : '';
      };
      out.push({
        formattedAddress: String(r.formatted_address ?? ''),
        line1: [comp('street_number'), comp('route')].filter(Boolean).join(' '),
        city: comp('locality') || comp('sublocality') || comp('postal_town'),
        state: comp('administrative_area_level_1', true),
        zip: comp('postal_code'),
        country: comp('country', true),
        latitude: loc.lat,
        longitude: loc.lng,
        placeId: String(r.place_id ?? ''),
        locationType: String(r.geometry?.location_type ?? ''),
        partialMatch: Boolean(r.partial_match),
      });
    }
    if (out.length === 0) throw new SolarError('GEOCODE_NO_RESULT');
    return out.slice(0, 5);
  }
}
