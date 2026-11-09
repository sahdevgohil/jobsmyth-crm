/** Unit conversions for roof measurement. Pure functions; every value carries an explicit unit in its name. */

export const SQFT_PER_M2 = 10.763910416709722;
export const FEET_PER_METER = 3.280839895013123;
export const SQFT_PER_ROOFING_SQUARE = 100;

export const m2ToSqFt = (m2: number): number => m2 * SQFT_PER_M2;
export const sqFtToM2 = (sqft: number): number => sqft / SQFT_PER_M2;
/** One roofing square = 100 square feet. */
export const sqFtToSquares = (sqft: number): number => sqft / SQFT_PER_ROOFING_SQUARE;
export const metersToFeet = (m: number): number => m * FEET_PER_METER;

export const round = (n: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Roofing pitch ratio (rise per 12 of run) from a slope angle in degrees: 12 x tan(angle). */
export function pitchRatioFromDegrees(degrees: number): number {
  return 12 * Math.tan((degrees * Math.PI) / 180);
}

/** Conventional rounded pitch label, e.g. 26.57 degrees -> "6/12". Angles under half a unit are labelled flat. */
export function pitchLabelFromDegrees(degrees: number): string {
  const rise = Math.round(pitchRatioFromDegrees(degrees));
  return rise <= 0 ? '0/12' : `${rise}/12`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** Compass direction a roof plane faces (azimuth measured clockwise from north). */
export function compassFromAzimuth(azimuthDegrees: number): (typeof COMPASS)[number] {
  const a = ((azimuthDegrees % 360) + 360) % 360;
  return COMPASS[Math.round(a / 45) % 8] as (typeof COMPASS)[number];
}

/** Parses "7/12" into 7; null when not a conventional pitch. */
export function parsePitchRise(pitch: string | undefined | null): number | null {
  const m = /^\s*(\d{1,2}(?:\.\d+)?)\s*\/\s*12\s*$/.exec(pitch ?? '');
  return m ? Number(m[1]) : null;
}
