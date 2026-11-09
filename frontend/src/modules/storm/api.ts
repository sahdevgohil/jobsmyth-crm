import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export const RADII = [1, 3, 5, 10] as const;

export type StormEvent = {
  id: string;
  eventType: 'hail' | 'wind';
  eventDate: string;
  localDate: string;
  localTime: string;
  hailSizeInches: number | null;
  windSpeedMph: number | null;
  magnitudeLabel: string;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  direction: string | null;
  locationDescription: string;
  county: string;
  state: string;
  source: 'spc' | 'ncei';
  sourceLabel: string;
  precision: 'exact' | 'approximate' | 'county' | 'none';
  precisionLabel: string;
  quality: string;
};

export type EventDetail = StormEvent & { endDate: string | null; importedAt: string; sourceRecordId: string; narrative: string; reporter: string; disclaimer: string };

export type SearchSummary = { hailReports: number; windReports: number; maxHailInches: number | null; maxWindMph: number | null; distinctDays: number; note: string };
export type DayBucket = { day: string; label: string; isDateOfLoss: boolean; events: StormEvent[]; hailReports: number; windReports: number; maxHailInches: number | null; maxWindMph: number | null };
export type SearchResult = {
  location: { source: string; label: string; accuracy: string | null; latitude: number; longitude: number; provider?: string };
  data: StormEvent[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: SearchSummary;
  radiusMiles: number;
  disclaimer: string;
  dateOfLoss?: { dateOfLoss: string; days: DayBucket[]; timeNote: string; truncated: boolean };
  regional?: { count: number; items: StormEvent[]; note: string };
};

export type EventFilters = { from?: string; to?: string; types?: string; minHail?: string; minWind?: string; sources?: string; includeUnknownSpeed?: string };
export type SearchParams = EventFilters & { address?: string; lat?: string; lng?: string; propertyId?: string; radius: number; dateOfLoss?: string; sort: string; page: number; pageSize: number; state?: string };

const qs = (o: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return p.toString();
};

export const stormKeys = { all: ['storm'] as const };

export const useStormStatus = () =>
  useQuery({
    queryKey: [...stormKeys.all, 'status'],
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch<{ data: { thresholds: { hailMinInches: number; windMinMph: number }; geocoder: { provider: string; configured: boolean; message: string }; alertChannels: { inApp: string; email: string; sms: string }; mapTileUrl: string; mapAttribution: string; sources: Array<{ key: string; name: string; note: string }>; mrms: { available: boolean; note: string }; disclaimer: string } }>('/storm/status').then((r) => r.data),
  });

export const useStormSearch = (p: SearchParams | null) =>
  useQuery({
    queryKey: [...stormKeys.all, 'search', p],
    enabled: p !== null,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => apiFetch<{ data: SearchResult }>(`/storm/search?${qs(p as unknown as Record<string, string | number>)}`).then((r) => r.data),
  });

export type MapMarker = { id: string; t: 'hail' | 'wind'; d: string; h: number | null; w: number | null; lat: number; lng: number; p: string; s: string };
export type MapResult = { data: MapMarker[]; total: number; truncated: boolean; note: string | null };
export const useMapEvents = (bbox: string | null, f: EventFilters) =>
  useQuery({
    queryKey: [...stormKeys.all, 'map', bbox, f],
    enabled: bbox !== null,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => apiFetch<{ data: MapResult }>(`/storm/events/map?${qs({ bbox, ...f })}`).then((r) => r.data),
  });

export const useEventDetail = (id: string | null) =>
  useQuery({ queryKey: [...stormKeys.all, 'event', id], enabled: Boolean(id), queryFn: () => apiFetch<{ data: EventDetail }>(`/storm/events/${id}`).then((r) => r.data) });

export type HistoryLocation = { label: string; propertyId: string | null; point: { lat: number; lng: number } | null; locationSource: 'saved' | 'geocoded' | 'unavailable'; accuracy: string | null; unavailableReason: string | null; result: SearchResult | null };
export type History = { radiusMiles: number; locations: HistoryLocation[]; disclaimer: string; note: string };
export const useStormHistory = (target: { propertyId?: string; customerId?: string; leadId?: string; projectId?: string }, radius: number, enabled = true) =>
  useQuery({ queryKey: [...stormKeys.all, 'history', target, radius], enabled, retry: false, queryFn: () => apiFetch<{ data: History }>(`/storm/history?${qs({ ...target, radius })}`).then((r) => r.data) });

// ---------------------------------------------------------------- zones

export type Zone = {
  id: string; name: string; kind: 'radius' | 'polygon' | 'county'; center: { lat: number; lng: number } | null; radiusMiles: number | null; polygon: Array<[number, number]> | null; counties: Array<{ state: string; county: string }>;
  dateFrom: string | null; dateTo: string | null; minHailInches: number; minWindMph: number; notes: string; assignedUser: { id: string; name: string } | null;
  assignmentHistory: Array<{ user: string | null; at: string; by: string; note: string }>; archived: boolean; createdAt: string;
};
export type ZoneStats = {
  hailReports: number; windReports: number; stormDays: number; maxHailInches: number | null; maxWindMph: number | null; latestEvent: string | null;
  crm: { customers: number; leads: number; pastCustomers: number; propertiesWithLocation: number; leadsNotLocated: number; note: string };
  score: { total: number; hailPoints: number; windPoints: number; recencyPoints: number; weights: { hail: number; wind: number; recency: number }; formula: string };
};
export type Ranking = { rankedBy: string; explanation: string; weights: { hail: number; wind: number; recency: number }; rows: Array<{ rank: number; zone: Zone; stats: ZoneStats }> };
export type RankParams = { sort: string; from?: string; to?: string; minHail?: string; minWind?: string; wHail?: string; wWind?: string; wRecency?: string };

export const useZones = () => useQuery({ queryKey: [...stormKeys.all, 'zones'], queryFn: () => apiFetch<{ data: Zone[] }>('/storm/zones').then((r) => r.data) });
export const useRankings = (p: RankParams) => useQuery({ queryKey: [...stormKeys.all, 'rank', p], placeholderData: keepPreviousData, queryFn: () => apiFetch<{ data: Ranking }>(`/storm/zones/rankings?${qs(p)}`).then((r) => r.data) });

export function useZoneMutations() {
  const qc = useQueryClient();
  const done = (): Promise<void> => qc.invalidateQueries({ queryKey: stormKeys.all });
  const send = (method: string, path: string, body?: unknown) => apiFetch<{ data: Zone }>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    create: useMutation({ mutationFn: (b: Record<string, unknown>) => send('POST', '/storm/zones', b), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; body: Record<string, unknown> }) => send('PATCH', `/storm/zones/${v.id}`, v.body), onSuccess: done }),
    assign: useMutation({ mutationFn: (v: { id: string; userId: string | null; note?: string }) => send('POST', `/storm/zones/${v.id}/assign`, { userId: v.userId, note: v.note }), onSuccess: done }),
    archive: useMutation({ mutationFn: (id: string) => apiFetch(`/storm/zones/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

// ---------------------------------------------------------------- alerts

export type AlertRule = { id: string; name: string; enabled: boolean; zoneId: string; zoneName: string; radiusMiles: number; hailMinInches: number; windMinMph: number; notifyAssignee: boolean; notifyAdmins: boolean; recipientUserIds: string[]; channels: { inApp: boolean; email: boolean; sms: boolean } };
export type AlertRow = { id: string; at: string; ruleName: string; zoneName: string; eventId: string; eventType: string; magnitude: number | null; distanceMiles: number | null; message: string; recipients: string[]; channelResults: unknown };
export const useAlertRules = (enabled: boolean) => useQuery({ queryKey: [...stormKeys.all, 'rules'], enabled, queryFn: () => apiFetch<{ data: AlertRule[] }>('/storm/alerts/rules').then((r) => r.data) });
export const useAlertHistory = (page: number) => useQuery({ queryKey: [...stormKeys.all, 'alert-history', page], placeholderData: keepPreviousData, queryFn: () => apiFetch<{ data: AlertRow[]; meta: { page: number; pageSize: number; total: number } }>(`/storm/alerts/history?page=${page}&pageSize=15`) });
export function useRuleMutations() {
  const qc = useQueryClient();
  const done = (): Promise<void> => qc.invalidateQueries({ queryKey: stormKeys.all });
  return {
    create: useMutation({ mutationFn: (b: Record<string, unknown>) => apiFetch('/storm/alerts/rules', { method: 'POST', body: JSON.stringify(b) }), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; body: Record<string, unknown> }) => apiFetch(`/storm/alerts/rules/${v.id}`, { method: 'PATCH', body: JSON.stringify(v.body) }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => apiFetch(`/storm/alerts/rules/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

// ---------------------------------------------------------------- follow-ups

export type Flag = { id: string; status: 'new' | 'reviewed' | 'dismissed'; message: string; customer: { id: string; name: string }; property: { id: string; address: string } | null; projectId: string; completedAt: string; event: { id: string; type: string; date: string; magnitude: number | null; label: string }; distanceMiles: number; radiusMiles: number; note: string; reviewedAt: string | null };
export const useFlags = (status: string, page: number, enabled = true) =>
  useQuery({ queryKey: [...stormKeys.all, 'flags', status, page], enabled, placeholderData: keepPreviousData, queryFn: () => apiFetch<{ data: Flag[]; meta: { page: number; pageSize: number; total: number }; disclaimer: string }>(`/storm/follow-ups?${qs({ status, page, pageSize: 10 })}`) });
export function useFlagMutations() {
  const qc = useQueryClient();
  const done = (): Promise<void> => qc.invalidateQueries({ queryKey: stormKeys.all });
  const post = (path: string, body: unknown) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    review: useMutation({ mutationFn: (v: { id: string; note?: string }) => post(`/storm/follow-ups/${v.id}/review`, { note: v.note }), onSuccess: done }),
    dismiss: useMutation({ mutationFn: (v: { id: string; note?: string }) => post(`/storm/follow-ups/${v.id}/dismiss`, { note: v.note }), onSuccess: done }),
    activity: useMutation({ mutationFn: (v: { id: string; type: 'follow_up' | 'call' | 'note'; dueAt?: string; body?: string }) => post(`/storm/follow-ups/${v.id}/activities`, { type: v.type, dueAt: v.dueAt, body: v.body }), onSuccess: done }),
    scan: useMutation({ mutationFn: (radiusMiles: number) => apiFetch<{ data: { flagsCreated: number; existingFlags: number; projectsChecked: number; projectsWithoutLocation: number; projectsWithoutCompletionDate: number } }>('/storm/follow-ups/scan', { method: 'POST', body: JSON.stringify({ radiusMiles }) }).then((r) => r.data), onSuccess: done }),
  };
}

// ---------------------------------------------------------------- imports

export type ImportRun = { id: string; source: string; kind: string; rangeFrom: string | null; rangeTo: string | null; status: string; startedAt: string; finishedAt: string | null; unitsTotal: number; unitsDone: number; unitsFailed: number; unitsUnavailable: number; unitsSkipped: number; counts: { rows: number; inserted: number; updated: number; skipped: number; belowThreshold: number; invalid: number }; errors: Array<{ unit: string; message: string; at: string }> };
export type ImportStatus = {
  running: { id: string; source: string; current: string; unitsDone: number; unitsTotal: number } | null;
  sources: {
    ncei: { label: string; lastSuccessfulSync: string | null; yearsImported: number[]; yearsMissing: number[]; backfillComplete: boolean; failedUnits: Array<{ unit: string; status: string; error: string }>; events: number; earliestEvent: string | null; latestEvent: string | null };
    spc: { label: string; lastSuccessfulSync: string | null; daysImported: number; failedUnits: Array<{ unit: string; status: string; error: string }>; events: number; earliestEvent: string | null; latestEvent: string | null };
  };
  runs: ImportRun[];
  note: string;
};
export const useImportStatus = () => useQuery({ queryKey: [...stormKeys.all, 'imports'], refetchInterval: (q) => (q.state.data?.running ? 3000 : 30_000), queryFn: () => apiFetch<{ data: ImportStatus }>('/storm/imports').then((r) => r.data) });
export function useImportMutations() {
  const qc = useQueryClient();
  const done = (): Promise<void> => qc.invalidateQueries({ queryKey: [...stormKeys.all, 'imports'] });
  const post = (path: string, body: unknown) => apiFetch<{ data: { runId: string; message: string } }>(path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data);
  return {
    backfill: useMutation({ mutationFn: (b: { fromYear?: number; toYear?: number; force?: boolean }) => post('/storm/imports/backfill', b), onSuccess: done }),
    spc: useMutation({ mutationFn: (b: { from: string; to: string; force?: boolean }) => post('/storm/imports/spc', b), onSuccess: done }),
    daily: useMutation({ mutationFn: () => post('/storm/imports/daily', {}), onSuccess: done }),
  };
}
