import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import { useAuthStore } from '@/stores/auth-store';
import { measurementKeys } from './api';
import type { Measurement } from './types';

export type SolarState = 'not_configured' | 'disabled' | 'configuration_required' | 'connected' | 'connection_failed' | 'quota_exceeded';
export type SolarStatus = { state: SolarState; keyConfigured: boolean; lastTest: { at: string; ok: boolean; code: string; httpStatus: number | null; message: string; fix: string | null } | null; stale?: boolean };
export type ConnectionResult = { ok: boolean; code: string; httpStatus: number | null; message: string; fix: string | null };

export type AddressSearchResult = {
  crm: Array<{ propertyId: string; customerId: string; label: string; latitude: number | null; longitude: number | null }>;
  geocoded: Array<{ formattedAddress: string; line1: string; city: string; state: string; zip: string; latitude: number; longitude: number; locationType: string; precise: boolean }>;
};

export type UsageRow = { kind: string; month: number; day: number; monthlyFree: number; dailyLimit: number; percentOfFree: number; overFree: number; estimatedOverageCents: number | null; warning: boolean; blocked: boolean };
export type Usage = { month: string; configured: boolean; enabled: boolean; rows: UsageRow[]; recent: Array<{ id: string; kind: string; quality: string | null; status: string; errorCode: string | null; at: string; durationMs: number | null; isDemo: boolean }>; notes: string[] };

export type SolarSettings = {
  enabled: boolean;
  preferredQuality: 'HIGH' | 'MEDIUM' | 'BASE';
  allowBaseFallback: boolean;
  dailyLimit: Record<string, number>;
  monthlyFree: Record<string, number>;
  warnPercent: number;
  allowOverage: boolean;
  pricePer1000Cents: Record<string, number | undefined>;
  cacheDays: number;
  rawRetentionDays: number;
  includeImagery: boolean;
  imageryRetentionDays: number;
  recommendedPitchedWaste: number;
  recommendedFlatWaste: number;
  integration: SolarStatus;
};

export type EstimateInputs = {
  measurementId: string;
  revision: number;
  source: string;
  isDemo: boolean;
  superseded: boolean;
  areaSqFt: number | null;
  squares: number | null;
  pitch: string | null;
  areaSource: string;
  areaVerified: boolean;
  edgeLengthsFt: Record<string, number | null>;
  counts: Record<string, number | string>;
  wasteTable: Array<{ percent: number; baseAreaSqFt: number; wasteAreaSqFt: number; finalAreaSqFt: number; baseSquares: number; finalSquares: number }>;
  wasteNote: string;
  missing: Array<{ key: string; label: string; reason: string }>;
  warnings: string[];
  selectedWastePercent?: number;
  suggestedQuantities?: Array<{ basis: string; label: string; quantity: number; status: 'verified' | 'unverified'; from: string }>;
  geometryStatus?: string;
};

export const solarKeys = { status: ['solar', 'status'] as const, usage: ['solar', 'usage'] as const, settings: ['solar', 'settings'] as const };
const j = (b: unknown): string => JSON.stringify(b);

export const useSolarStatus = () => useQuery({ queryKey: solarKeys.status, queryFn: () => apiFetch<{ data: SolarStatus }>('/measurements/solar/status').then((r) => r.data) });
export const useSolarUsage = (enabled = true) => useQuery({ queryKey: solarKeys.usage, enabled, queryFn: () => apiFetch<{ data: Usage }>('/measurements/solar/usage').then((r) => r.data) });
export const useSolarSettings = (enabled = true) => useQuery({ queryKey: solarKeys.settings, enabled, queryFn: () => apiFetch<{ data: SolarSettings }>('/measurements/solar/settings').then((r) => r.data) });
export const useEstimateInputs = (id: string | undefined) =>
  useQuery({ queryKey: ['solar', 'estimate-inputs', id], enabled: Boolean(id), queryFn: () => apiFetch<{ data: EstimateInputs }>(`/measurements/solar/${id}/estimate-inputs`).then((r) => r.data) });
export const usePropertyHistory = (propertyId: string | undefined) =>
  useQuery({ queryKey: ['solar', 'history', propertyId], enabled: Boolean(propertyId), queryFn: () => apiFetch<{ data: Measurement[] }>(`/measurements/solar/property/${propertyId}/history`).then((r) => r.data) });

export function useSolarMutations() {
  const qc = useQueryClient();
  const refresh = async (): Promise<void> => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['solar'] }), qc.invalidateQueries({ queryKey: ['integrations'] }), qc.invalidateQueries({ queryKey: ['ws'] })]);
  };
  return {
    saveSettings: useMutation({ mutationFn: (b: Record<string, unknown>) => apiFetch('/measurements/solar/settings', { method: 'PUT', body: j(b) }), onSuccess: refresh }),
    testConnection: useMutation({ mutationFn: () => apiFetch<{ data: ConnectionResult }>('/measurements/solar/test-connection', { method: 'POST' }).then((r) => r.data), onSuccess: refresh }),
    search: useMutation({ mutationFn: (v: { q: string; geocode: boolean }) => apiFetch<{ data: AddressSearchResult }>(`/measurements/solar/address-search?q=${encodeURIComponent(v.q)}&geocode=${v.geocode}`).then((r) => r.data), onSuccess: refresh }),
    run: useMutation({
      mutationFn: (b: Record<string, unknown>) => apiFetch<{ data: Measurement; meta: { cached: boolean } }>('/measurements/solar/run', { method: 'POST', body: j(b) }),
      onSuccess: async () => { await refresh(); await qc.invalidateQueries({ queryKey: measurementKeys.all }); },
    }),
    correct: useMutation({
      mutationFn: ({ id, ...b }: { id: string; changes?: Record<string, number | string | null>; verify?: Record<string, boolean>; reason: string }) =>
        apiFetch<{ data: Measurement }>(`/measurements/solar/${id}/corrections`, { method: 'PATCH', body: j(b) }).then((r) => r.data),
      onSuccess: async () => { await refresh(); await qc.invalidateQueries({ queryKey: measurementKeys.all }); },
    }),
  };
}

/** File name from a Content-Disposition header (UTF-8 `filename*` first, then the plain name). */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

/** Downloads the branded PDF under its address-based name (fetch + blob so the Authorization header can be sent). */
export async function openSolarReport(id: string, opts: { waste?: number; flatWaste?: number } = {}): Promise<string> {
  const base = import.meta.env.VITE_API_URL as string;
  const token = useAuthStore.getState().accessToken;
  const params = new URLSearchParams();
  if (opts.waste !== undefined) params.set('waste', String(opts.waste));
  if (opts.flatWaste !== undefined) params.set('flatWaste', String(opts.flatWaste));
  const q = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/measurements/solar/${id}/report${q}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
  if (!res.ok) throw new Error('Could not generate the report.');
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? 'Roof-Measurement-Report.pdf';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
}
