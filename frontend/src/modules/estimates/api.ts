import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { Estimate, EstimateCatalog, PricingConfig } from './types';

export const estimateKeys = {
  all: ['estimates'] as const,
  list: (filters: string) => ['estimates', 'list', filters] as const,
  detail: (id: string) => ['estimates', id] as const,
  catalog: ['estimates', 'catalog'] as const,
  pricing: ['settings', 'pricing'] as const,
};

export function useEstimates(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: estimateKeys.list(filters),
    queryFn: () => apiFetch<{ data: Estimate[]; meta: { total: number } }>(`/estimates?${filters}`),
  });
}

export function useEstimate(id: string) {
  return useQuery({
    queryKey: estimateKeys.detail(id),
    queryFn: () => apiFetch<{ data: Estimate }>(`/estimates/${id}`),
    enabled: Boolean(id),
  });
}

export function useEstimateCatalog() {
  return useQuery({
    queryKey: estimateKeys.catalog,
    queryFn: () => apiFetch<{ data: EstimateCatalog }>('/estimates/catalog'),
  });
}

export function useCreateEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Estimate }>('/estimates', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: estimateKeys.all }),
  });
}

export function useUpdateEstimate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Estimate }>(`/estimates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: estimateKeys.all }),
  });
}

export function useDuplicateEstimate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: 'copy' | 'version') =>
      apiFetch<{ data: Estimate }>(`/estimates/${id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: estimateKeys.all }),
  });
}

export function useVoidEstimate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ data: Estimate }>(`/estimates/${id}/void`, { method: 'POST', body: '{}' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: estimateKeys.all }),
  });
}

export function usePricingConfig() {
  return useQuery({
    queryKey: estimateKeys.pricing,
    queryFn: () => apiFetch<{ data: PricingConfig }>('/settings/pricing'),
  });
}

export function useUpdatePricingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<PricingConfig, 'taxRateBps' | 'standardLineItems'>>) =>
      apiFetch<{ data: PricingConfig }>('/settings/pricing', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: estimateKeys.pricing });
      void qc.invalidateQueries({ queryKey: estimateKeys.catalog });
    },
  });
}

/** Opens the printable HTML estimate in a new tab using the access token. */
export async function openEstimatePreview(id: string, accessToken: string | null): Promise<void> {
  const API_URL = import.meta.env.VITE_API_URL as string;
  const res = await fetch(`${API_URL}/estimates/${id}/preview`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Could not load estimate preview.');
  }
  const html = await res.text();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Customer decision on a sent estimate. Each call moves the job in the pipeline and is recorded in the estimate history. */
export function useEstimateDecision(id: string) {
  const qc = useQueryClient();
  const done = (): void => {
    void qc.invalidateQueries({ queryKey: estimateKeys.all });
    void qc.invalidateQueries({ queryKey: ['pipeline'] });
  };
  const post = (path: string, body: unknown) => apiFetch<{ data: Estimate }>(`/estimates/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) });
  return {
    accept: useMutation({ mutationFn: () => post('accept', {}), onSuccess: done }),
    deny: useMutation({ mutationFn: (v: { reason: string; note?: string }) => post('deny', v), onSuccess: done }),
    reopen: useMutation({ mutationFn: (reason?: string) => post('reopen', { reason }), onSuccess: done }),
  };
}
