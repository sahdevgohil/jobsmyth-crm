import mongoose, { type PipelineStage, type Types } from 'mongoose';
import { AppError } from '../../utils/errors.js';
import { addDaysKey, bearingDegrees, compass, dayKeyAtOffset, distanceMiles, milesToRadians, standardOffsetHours } from './geo.js';
import { StormEventModel } from './storm.model.js';
import { HAIL_MIN_INCHES, POINT_PRECISIONS, WIND_MIN_MPH, type CoordinatePrecision, type StormEventType, type StormSource } from './storm.types.js';

export const RADII = [1, 3, 5, 10] as const;
export const MAX_PAGE = 100;
const METERS_PER_MILE = 1609.344;

export const PRECISION_LABEL: Record<CoordinatePrecision, string> = {
  exact: 'Exact reported coordinates',
  approximate: 'Approximate coordinates (about 1 km)',
  county: 'County-level location only',
  none: 'No usable location',
};
export const SOURCE_LABEL: Record<StormSource, string> = { spc: 'NOAA SPC daily storm report', ncei: 'NOAA NCEI Storm Events Database' };
export const DAMAGE_DISCLAIMER =
  'These are reported weather events from NOAA. A report near a property does not show that the property was struck or damaged, and hail and wind can vary a great deal from street to street. Confirm damage with an inspection.';

export type EventFilters = {
  from?: Date;
  to?: Date;
  types?: StormEventType[];
  minHailInches?: number;
  minWindMph?: number;
  sources?: StormSource[];
  /** Include SPC/NCEI wind reports whose speed was not published (damage-only reports). They never meet the speed threshold. */
  includeUnknownSpeed?: boolean;
};

export type EventDto = {
  id: string;
  eventType: StormEventType;
  eventDate: string;
  localDate: string;
  localTime: string;
  hailSizeInches: number | null;
  windSpeedMph: number | null;
  sourceMagnitude: number | null;
  sourceMagnitudeUnit: string | null;
  magnitudeLabel: string;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  direction: string | null;
  locationDescription: string;
  county: string;
  state: string;
  source: StormSource;
  sourceLabel: string;
  precision: CoordinatePrecision;
  precisionLabel: string;
  quality: string;
};

type Doc = {
  _id: Types.ObjectId; eventType: StormEventType; eventDate: Date; hailSizeInches?: number | null; windSpeedMph?: number | null; sourceMagnitude?: number | null; sourceMagnitudeUnit?: string | null;
  latitude?: number | null; longitude?: number | null; locationDescription?: string; county?: string; state?: string; source: StormSource; coordinatePrecision: CoordinatePrecision; qualityStatus: string;
  distM?: number;
};

export function magnitudeLabel(d: Pick<Doc, 'eventType' | 'hailSizeInches' | 'windSpeedMph' | 'sourceMagnitude' | 'sourceMagnitudeUnit'>): string {
  if (d.eventType === 'hail') return d.hailSizeInches != null ? `${d.hailSizeInches.toFixed(2)} in hail` : 'Hail (size not reported)';
  if (d.windSpeedMph == null) return 'Wind damage reported (speed not reported)';
  const orig = d.sourceMagnitudeUnit === 'knot' && d.sourceMagnitude != null ? ` (reported ${d.sourceMagnitude} kt)` : '';
  return `${Math.round(d.windSpeedMph)} mph wind${orig}`;
}

export function toEventDto(d: Doc, origin?: { lat: number; lng: number }): EventDto {
  const off = origin ? standardOffsetHours(origin.lng) : d.longitude != null ? standardOffsetHours(d.longitude) : 0;
  const local = new Date(d.eventDate.getTime() + off * 3_600_000);
  const hasPoint = d.latitude != null && d.longitude != null;
  const dist = origin && hasPoint ? (d.distM != null ? d.distM / METERS_PER_MILE : distanceMiles(origin, { lat: d.latitude as number, lng: d.longitude as number })) : null;
  return {
    id: String(d._id),
    eventType: d.eventType,
    eventDate: d.eventDate.toISOString(),
    localDate: local.toISOString().slice(0, 10),
    localTime: local.toISOString().slice(11, 16),
    hailSizeInches: d.hailSizeInches ?? null,
    windSpeedMph: d.windSpeedMph ?? null,
    sourceMagnitude: d.sourceMagnitude ?? null,
    sourceMagnitudeUnit: d.sourceMagnitudeUnit ?? null,
    magnitudeLabel: magnitudeLabel(d),
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    distanceMiles: dist === null ? null : Math.round(dist * 10) / 10,
    direction: origin && hasPoint ? compass(bearingDegrees(origin, { lat: d.latitude as number, lng: d.longitude as number })) : null,
    locationDescription: d.locationDescription ?? '',
    county: d.county ?? '',
    state: d.state ?? '',
    source: d.source,
    sourceLabel: SOURCE_LABEL[d.source],
    precision: d.coordinatePrecision,
    precisionLabel: PRECISION_LABEL[d.coordinatePrecision],
    quality: d.qualityStatus,
  };
}

/** Mongo filter for the attribute filters (not the location). */
export function eventQuery(f: EventFilters): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  const types = f.types && f.types.length > 0 ? f.types : (['hail', 'wind'] as StormEventType[]);
  const branches: Record<string, unknown>[] = [];
  if (types.includes('hail')) branches.push({ eventType: 'hail', hailSizeInches: { $gte: Math.max(HAIL_MIN_INCHES, f.minHailInches ?? 0) } });
  if (types.includes('wind')) {
    const min = Math.max(WIND_MIN_MPH, f.minWindMph ?? 0);
    const speed: Record<string, unknown> = { eventType: 'wind', windSpeedMph: min > WIND_MIN_MPH ? { $gte: min } : { $gt: WIND_MIN_MPH } };
    branches.push(speed);
    if (f.includeUnknownSpeed && !f.minWindMph) branches.push({ eventType: 'wind', qualityStatus: 'speed_unknown' });
  }
  and.push({ $or: branches });
  if (f.from || f.to) and.push({ eventDate: { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) } });
  if (f.sources && f.sources.length > 0) and.push({ source: { $in: f.sources } });
  return { $and: and };
}

export type NearInput = EventFilters & { lat: number; lng: number; radiusMiles: number; sort?: 'nearest' | 'newest' | 'largest'; page?: number; pageSize?: number };

const SORTS: Record<string, Record<string, 1 | -1>> = {
  nearest: { distM: 1, eventDate: -1 },
  newest: { eventDate: -1, distM: 1 },
  largest: { magnitudeSort: -1, eventDate: -1 },
};

/** Events with real coordinates within the radius of a point. County-level and location-less reports are never part of this. */
export async function searchNear(input: NearInput) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE, Math.max(1, input.pageSize ?? 25));
  const near = { type: 'Point' as const, coordinates: [input.lng, input.lat] as [number, number] };
  const q = { $and: [eventQuery(input), { coordinatePrecision: { $in: POINT_PRECISIONS } }] };
  const pipeline: PipelineStage[] = [
    { $geoNear: { near, distanceField: 'distM', maxDistance: input.radiusMiles * METERS_PER_MILE, spherical: true, query: q } },
    { $addFields: { magnitudeSort: { $cond: [{ $eq: ['$eventType', 'hail'] }, { $ifNull: ['$hailSizeInches', 0] }, { $divide: [{ $ifNull: ['$windSpeedMph', 0] }, 50] }] } } },
    {
      $facet: {
        rows: [{ $sort: SORTS[input.sort ?? 'nearest'] as Record<string, 1 | -1> }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        stats: [{ $group: { _id: '$eventType', n: { $sum: 1 }, maxHail: { $max: '$hailSizeInches' }, maxWind: { $max: '$windSpeedMph' }, latest: { $max: '$eventDate' } } }],
        days: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$eventDate' } } } }, { $count: 'n' }],
      },
    },
  ];
  const [res] = await StormEventModel.aggregate<{ rows: Doc[]; stats: Array<{ _id: string; n: number; maxHail: number | null; maxWind: number | null; latest: Date }>; days: Array<{ n: number }> }>(pipeline).option({ maxTimeMS: 20_000 });
  const origin = { lat: input.lat, lng: input.lng };
  const stat = (t: string) => res?.stats.find((s) => s._id === t);
  const total = (stat('hail')?.n ?? 0) + (stat('wind')?.n ?? 0);
  return {
    data: (res?.rows ?? []).map((d) => toEventDto(d, origin)),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    summary: {
      hailReports: stat('hail')?.n ?? 0,
      windReports: stat('wind')?.n ?? 0,
      maxHailInches: stat('hail')?.maxHail ?? null,
      maxWindMph: stat('wind')?.maxWind ?? null,
      distinctDays: res?.days[0]?.n ?? 0,
      note: 'Several reports on the same day often come from one storm; they are not independent damage events.',
    },
    radiusMiles: input.radiusMiles,
    disclaimer: DAMAGE_DISCLAIMER,
  };
}

/** Day before, date of loss and day after, in local standard time at the property. */
export async function dateOfLossWindow(input: Omit<NearInput, 'from' | 'to' | 'page' | 'pageSize' | 'sort'> & { dateOfLoss: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfLoss) || Number.isNaN(new Date(`${input.dateOfLoss}T00:00:00Z`).getTime())) throw new AppError({ status: 400, code: 'VALIDATION_ERROR', message: 'Date of loss must be a valid date.' });
  const off = standardOffsetHours(input.lng);
  const days = [addDaysKey(input.dateOfLoss, -1), input.dateOfLoss, addDaysKey(input.dateOfLoss, 1)];
  const start = new Date(new Date(`${days[0]}T00:00:00Z`).getTime() - off * 3_600_000);
  const end = new Date(new Date(`${days[2]}T00:00:00Z`).getTime() + 24 * 3_600_000 - 1 - off * 3_600_000);
  const near = { type: 'Point' as const, coordinates: [input.lng, input.lat] as [number, number] };
  const q = { $and: [eventQuery({ ...input, from: start, to: end }), { coordinatePrecision: { $in: POINT_PRECISIONS } }] };
  const rows = await StormEventModel.aggregate<Doc>([
    { $geoNear: { near, distanceField: 'distM', maxDistance: input.radiusMiles * METERS_PER_MILE, spherical: true, query: q } },
    { $sort: { distM: 1 } },
    { $limit: 300 },
  ]).option({ maxTimeMS: 20_000 });
  const origin = { lat: input.lat, lng: input.lng };
  const dtos = rows.map((r) => toEventDto(r, origin));
  return {
    dateOfLoss: input.dateOfLoss,
    offsetHours: off,
    timeNote: 'Days are local standard time, estimated from the property longitude. Daylight saving time is not applied.',
    days: days.map((day, i) => {
      const events = dtos.filter((e) => dayKeyAtOffset(new Date(e.eventDate), off) === day);
      return {
        day,
        label: i === 0 ? 'Day before' : i === 1 ? 'Date of loss' : 'Day after',
        isDateOfLoss: i === 1,
        events,
        hailReports: events.filter((e) => e.eventType === 'hail').length,
        windReports: events.filter((e) => e.eventType === 'wind').length,
        maxHailInches: events.reduce<number | null>((m, e) => (e.hailSizeInches != null ? Math.max(m ?? 0, e.hailSizeInches) : m), null),
        maxWindMph: events.reduce<number | null>((m, e) => (e.windSpeedMph != null ? Math.max(m ?? 0, e.windSpeedMph) : m), null),
      };
    }),
    truncated: rows.length >= 300,
    disclaimer: DAMAGE_DISCLAIMER,
  };
}

/** Reports that only have a county (no point), shown as regional context and never given a distance. */
export async function regionalContext(state: string, f: EventFilters) {
  const q = { $and: [eventQuery(f), { coordinatePrecision: { $in: ['county', 'none'] }, state: state.toUpperCase() }] };
  const [items, count] = await Promise.all([StormEventModel.find(q).sort({ eventDate: -1 }).limit(10).lean(), StormEventModel.countDocuments(q)]);
  return { count, items: (items as unknown as Doc[]).map((d) => toEventDto(d)), note: 'County-level reports have no point location, so no distance is given.' };
}

export async function getEvent(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Storm event not found.' });
  const d = await StormEventModel.findById(id).lean();
  if (!d) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Storm event not found.' });
  const meta = (d.rawSourceMetadata ?? {}) as Record<string, string>;
  return {
    ...toEventDto(d as unknown as Doc),
    endDate: d.eventEndDate ? d.eventEndDate.toISOString() : null,
    importedAt: d.importedAt.toISOString(),
    sourceRecordId: d.sourceRecordId,
    sourceRef: d.sourceRef,
    narrative: meta.narrative ?? meta.comments ?? '',
    reporter: meta.reporter ?? '',
    disclaimer: DAMAGE_DISCLAIMER,
  };
}

export type MapInput = EventFilters & { bbox?: [number, number, number, number]; center?: { lat: number; lng: number }; radiusMiles?: number; state?: string; limit?: number };

/** Compact marker data for the map: biggest events first, capped, with a flag when more exist. */
export async function mapEvents(input: MapInput) {
  const limit = Math.min(2500, Math.max(1, input.limit ?? 1500));
  const and: Record<string, unknown>[] = [eventQuery(input), { coordinatePrecision: { $in: POINT_PRECISIONS } }];
  if (input.bbox) {
    const [w, s, e, n] = input.bbox;
    and.push({ location: { $geoWithin: { $geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } } } });
  } else if (input.center && input.radiusMiles) {
    and.push({ location: { $geoWithin: { $centerSphere: [[input.center.lng, input.center.lat], milesToRadians(input.radiusMiles)] } } });
  }
  if (input.state) and.push({ state: input.state.toUpperCase() });
  const q = { $and: and };
  const [rows, total] = await Promise.all([
    StormEventModel.find(q).select('eventType eventDate hailSizeInches windSpeedMph latitude longitude coordinatePrecision source').sort({ hailSizeInches: -1, windSpeedMph: -1, eventDate: -1 }).limit(limit).maxTimeMS(20_000).lean(),
    StormEventModel.countDocuments(q).maxTimeMS(20_000),
  ]);
  return {
    data: rows.map((d) => ({ id: String(d._id), t: d.eventType, d: d.eventDate.toISOString(), h: d.hailSizeInches ?? null, w: d.windSpeedMph ?? null, lat: d.latitude as number, lng: d.longitude as number, p: d.coordinatePrecision, s: d.source })),
    total,
    truncated: total > rows.length,
    note: total > rows.length ? `Showing the ${rows.length} largest of ${total} reports in this view. Zoom in or narrow the dates to see the rest.` : null,
  };
}
