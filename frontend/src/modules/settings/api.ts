import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { CompanySettings, LookupValue } from './types';

export const settingsKeys = {
  company: ['settings', 'company'] as const,
  lookups: (type: string) => ['settings', 'lookups', type] as const,
};

export function useCompanySettings() {
  return useQuery({
    queryKey: settingsKeys.company,
    queryFn: () => apiFetch<{ data: CompanySettings }>('/settings/company'),
  });
}

export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CompanySettings>) =>
      apiFetch<{ data: CompanySettings }>('/settings/company', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.company });
    },
  });
}

export function useLookups(type: string) {
  return useQuery({
    queryKey: settingsKeys.lookups(type),
    queryFn: () => apiFetch<{ data: LookupValue[] }>(`/settings/lookups/${type}`),
  });
}

export function useCreateLookup(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { key: string; label: string; order?: number }) =>
      apiFetch<{ data: LookupValue }>(`/settings/lookups/${type}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.lookups(type) });
    },
  });
}

export function useUpdateLookup(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; order?: number; isActive?: boolean }) =>
      apiFetch<{ data: LookupValue }>(`/settings/lookups/${type}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.lookups(type) });
    },
  });
}
