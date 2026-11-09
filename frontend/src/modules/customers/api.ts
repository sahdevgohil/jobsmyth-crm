import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { Customer, Property } from './types';

export const customerKeys = {
  all: ['customers'] as const,
  list: (q: string) => ['customers', 'list', q] as const,
  detail: (id: string) => ['customers', id] as const,
  summary: (id: string) => ['customers', id, 'summary'] as const,
};

export function useCustomers(search = '') {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return useQuery({
    queryKey: customerKeys.list(search),
    queryFn: () =>
      apiFetch<{ data: Customer[]; meta: { total: number } }>(`/customers${qs}`),
  });
}

export function useCustomerSummary(id: string) {
  return useQuery({
    queryKey: customerKeys.summary(id),
    queryFn: () =>
      apiFetch<{
        data: {
          customer: Customer;
          properties: Property[];
          relatedLeadIds: string[];
          relatedLeads: Array<{ id: string; name: string; stageId: string; sourceKey: string; createdAt: string }>;
        };
      }>(`/customers/${id}/summary`),
    enabled: Boolean(id),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Customer }>('/customers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useArchiveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: Customer }>(`/customers/${id}/archive`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useCreateProperty(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Property }>(`/customers/${customerId}/properties`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: customerKeys.summary(customerId) }),
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Customer }>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export type PortalAccountStatus =
  | { exists: false }
  | { exists: true; email: string; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null };

export function usePortalAccountStatus(customerId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['portal-account', customerId],
    enabled: enabled && Boolean(customerId),
    queryFn: () => apiFetch<{ data: PortalAccountStatus }>(`/portal/accounts?customerId=${customerId}`),
  });
}

export function useCreatePortalAccount(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; temporaryPassword: string; firstName: string; lastName: string }) =>
      apiFetch('/portal/accounts', { method: 'POST', body: JSON.stringify({ customerId, ...body }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal-account', customerId] }),
  });
}

/** Resolves customer display names for ids shown in list views (scope-checked by the API). */
export function useCustomerNames(ids: string[]): (id: string) => string {
  const unique = [...new Set(ids.filter(Boolean))].sort().slice(0, 100);
  const q = useQuery({
    queryKey: ['customers', 'names', unique.join(',')],
    enabled: unique.length > 0,
    staleTime: 60_000,
    queryFn: () => apiFetch<{ data: Customer[] }>(`/customers?ids=${unique.join(',')}&pageSize=100`),
  });
  const map = new Map(
    (q.data?.data ?? []).map((c) => [c.id, c.type === 'business' ? c.companyName : `${c.firstName} ${c.lastName}`.trim()]),
  );
  return (id) => map.get(id) ?? (q.isLoading ? '…' : '—');
}
