import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type Communication = {
  id: string;
  customerId: string;
  leadId: string | null;
  projectId: string | null;
  channel: 'email' | 'sms' | 'internal_note';
  direction: 'inbound' | 'outbound' | 'internal';
  subject: string;
  body: string;
  deliveryStatus: string;
  provider: string;
  providerMessageId: string | null;
  sender: string;
  recipient: string;
  customerVisible: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunicationFilters = {
  customerId?: string;
  leadId?: string;
  projectId?: string;
  channel?: string;
};

function qs(filters: CommunicationFilters): string {
  const params = new URLSearchParams();
  if (filters.customerId) params.set('customerId', filters.customerId);
  if (filters.leadId) params.set('leadId', filters.leadId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.channel) params.set('channel', filters.channel);
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useCommunications(filters: CommunicationFilters, enabled = true) {
  return useQuery({
    queryKey: ['communications', filters],
    enabled: enabled && Boolean(filters.customerId || filters.leadId || filters.projectId),
    queryFn: () => apiFetch<{ data: Communication[] }>(`/communications${qs(filters)}`),
  });
}

export function useCreateInternalNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      customerId: string;
      leadId?: string;
      projectId?: string;
      subject?: string;
      body: string;
    }) =>
      apiFetch<{ data: Communication }>('/communications/notes', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}

export function useCreateEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      customerId: string;
      leadId?: string;
      projectId?: string;
      recipient: string;
      subject: string;
      body: string;
    }) =>
      apiFetch<{ data: Communication }>('/communications/email', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}

export function useCreateSms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      customerId: string;
      leadId?: string;
      projectId?: string;
      recipient: string;
      body: string;
    }) =>
      apiFetch<{ data: Communication }>('/communications/sms', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}
