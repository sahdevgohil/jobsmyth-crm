import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { Inspection } from './types';

export const inspectionKeys = {
  all: ['inspections'] as const,
  list: (filters: string) => ['inspections', 'list', filters] as const,
  detail: (id: string) => ['inspections', id] as const,
};

export function useInspections(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: inspectionKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Inspection[]; meta: { total: number } }>(`/inspections?${filters}`),
  });
}

export function useInspection(id: string) {
  return useQuery({
    queryKey: inspectionKeys.detail(id),
    queryFn: () => apiFetch<{ data: Inspection }>(`/inspections/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Inspection }>('/inspections', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useUpdateInspection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Inspection }>(`/inspections/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inspectionKeys.all });
      void qc.invalidateQueries({ queryKey: inspectionKeys.detail(id) });
    },
  });
}

export function useCompleteInspection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ data: Inspection }>(`/inspections/${id}/complete`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inspectionKeys.all });
      void qc.invalidateQueries({ queryKey: inspectionKeys.detail(id) });
    },
  });
}

/** Opens printable HTML report in a new tab using the access token. */
export async function openInspectionReport(id: string, accessToken: string | null): Promise<void> {
  const API_URL = import.meta.env.VITE_API_URL as string;
  const res = await fetch(`${API_URL}/inspections/${id}/report`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Could not load inspection report.');
  }
  const html = await res.text();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
}
