import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import { useAuthStore } from '@/stores/auth-store';

export type Proposal = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string;
  estimateId: string;
  version: number;
  status: string;
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  termsAndConditions: string;
  notes: string;
  signature: {
    status: string;
    provider: string;
    signedAt: string | null;
    errorMessage: string;
  };
  lastEmailDelivery: { status: string; message: string; at: string | null };
  paymentSchedule: Array<{ label: string; percentBps: number | null; amountCents: number | null }>;
};

export const proposalKeys = {
  all: ['proposals'] as const,
  list: (filters: string) => ['proposals', 'list', filters] as const,
  detail: (id: string) => ['proposals', id] as const,
};

export function useProposals(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: proposalKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Proposal[]; meta: { total: number } }>(`/proposals?${filters}`),
  });
}

export function useProposal(id: string) {
  return useQuery({
    queryKey: proposalKeys.detail(id),
    queryFn: () => apiFetch<{ data: Proposal }>(`/proposals/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Proposal }>('/proposals', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: proposalKeys.all }),
  });
}

export function useSendProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ data: Proposal; meta: { emailDelivery: string } }>(`/proposals/${id}/send`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: proposalKeys.all });
      void qc.invalidateQueries({ queryKey: proposalKeys.detail(id) });
    },
  });
}

export function useAcceptProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ data: Proposal }>(`/proposals/${id}/accept`, { method: 'POST', body: '{}' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: proposalKeys.detail(id) }),
  });
}

export function useRejectProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ data: Proposal }>(`/proposals/${id}/reject`, { method: 'POST', body: '{}' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: proposalKeys.detail(id) }),
  });
}

export function useSignatureRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { recipientEmail: string; recipientName?: string }) =>
      apiFetch<{ data: Proposal }>(`/proposals/${id}/signature-request`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: proposalKeys.detail(id) }),
  });
}

export async function openProposalPreview(id: string, accessToken: string | null): Promise<void> {
  const API_URL = import.meta.env.VITE_API_URL as string;
  const res = await fetch(`${API_URL}/proposals/${id}/preview`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Could not load proposal preview.');
  const html = await res.text();
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener,noreferrer');
  useAuthStore.getState(); // keep import used for consistency with other modules
}
