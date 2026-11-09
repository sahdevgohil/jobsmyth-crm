export const HAIL_MIN_INCHES = 1.0;
/** Wind qualifies when strictly greater than this many miles per hour. */
export const WIND_MIN_MPH = 50;
export const KNOTS_TO_MPH = 1.150779;

export const EVENT_TYPES = ['hail', 'wind'] as const;
export type StormEventType = (typeof EVENT_TYPES)[number];

export const SOURCES = ['spc', 'ncei'] as const;
export type StormSource = (typeof SOURCES)[number];

/**
 * How well the stored point locates the event.
 *  exact:       reported with 3+ decimal places (about 100 m or better)
 *  approximate: reported with 2 or fewer decimals (about 1 km), typically "2 WSW Town" converted to a point
 *  county:      no usable point, only a county or place; never given a made-up coordinate
 *  none:        no usable location
 */
export const PRECISIONS = ['exact', 'approximate', 'county', 'none'] as const;
export type CoordinatePrecision = (typeof PRECISIONS)[number];
/** Precisions that may be used for distance and radius calculations. */
export const POINT_PRECISIONS: readonly CoordinatePrecision[] = ['exact', 'approximate'];

export const QUALITY = ['ok', 'speed_unknown', 'size_unknown'] as const;
export type QualityStatus = (typeof QUALITY)[number];

export type MagnitudeUnit = 'hundredths_inch' | 'inch' | 'mph' | 'knot';

export type NormalizedEvent = {
  source: StormSource;
  sourceRecordId: string;
  eventType: StormEventType;
  eventDate: Date;
  eventEndDate: Date | null;
  hailSizeInches: number | null;
  windSpeedMph: number | null;
  sourceMagnitude: number | null;
  sourceMagnitudeUnit: MagnitudeUnit | null;
  latitude: number | null;
  longitude: number | null;
  coordinatePrecision: CoordinatePrecision;
  locationDescription: string;
  county: string;
  state: string;
  qualityStatus: QualityStatus;
  /** Meets the alert/search thresholds: hail >= 1.00 in, wind > 50 mph. */
  qualifies: boolean;
  sourceRef: string;
  meta: Record<string, string>;
};

export const US_STATES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'PUERTO RICO': 'PR',
};
export const stateCode = (s: string): string => {
  const t = s.trim().toUpperCase();
  return US_STATES[t] ?? (t.length === 2 ? t : t);
};
