import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { IntegrationStatus, Measurement } from './types';

export const measurementKeys = {
  all: ['measurements'] as const,
  list: (filters: string) => ['measurements', 'list', filters] as const,
  detail: (id: string) => ['measurements', id] as const,
  integrations: ['measurements', 'integrations'] as const,
};

export function useMeasurements(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: measurementKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Measurement[]; meta: { total: number } }>(`/measurements?${filters}`),
  });
}

export function useMeasurement(id: string) {
  return useQuery({
    queryKey: measurementKeys.detail(id),
    queryFn: () => apiFetch<{ data: Measurement }>(`/measurements/${id}`),
    enabled: Boolean(id),
  });
}

export function useMeasurementIntegrations() {
  return useQuery({
    queryKey: measurementKeys.integrations,
    queryFn: () => apiFetch<{ data: IntegrationStatus }>('/measurements/integrations/status'),
  });
}

/** `importedFilename` present -> POST /measurements/import (manual entry from a file). */
export function useCreateMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Measurement }>(body.importedFilename ? '/measurements/import' : '/measurements', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: measurementKeys.all }),
  });
}
