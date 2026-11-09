/** Geodesy helpers for storm search. Pure functions, no database. Distances are great-circle (haversine) on a spherical Earth. */

export const EARTH_RADIUS_MILES = 3958.7613;
export const KM_PER_MILE = 1.609344;

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export type LatLng = { lat: number; lng: number };

export function validLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Great-circle distance in miles. */
export function distanceMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees clockwise from north (0-360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const;
export const compass = (bearing: number): string => COMPASS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16] as string;

/** Bounding box that contains the circle, for a cheap first filter. */
export function boundingBox(c: LatLng, radiusMiles: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = deg(radiusMiles / EARTH_RADIUS_MILES);
  const dLng = deg(radiusMiles / (EARTH_RADIUS_MILES * Math.max(0.01, Math.cos(rad(c.lat)))));
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLng: c.lng - dLng, maxLng: c.lng + dLng };
}

/** Radius in radians for MongoDB $centerSphere. */
export const milesToRadians = (miles: number): number => miles / EARTH_RADIUS_MILES;

/** Ray casting point-in-polygon on a lng/lat ring (no wrap-around handling: zones are local). */
export function pointInRing(p: LatLng, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Fixed offset of local standard time from UTC, in hours, estimated from longitude (documented approximation). */
export const standardOffsetHours = (lng: number): number => Math.round(lng / 15);

/** YYYY-MM-DD of an instant as seen at a fixed UTC offset. */
export function dayKeyAtOffset(instant: Date, offsetHours: number): string {
  return new Date(instant.getTime() + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

export function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
