import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { Activity, Lead, PipelineStage } from './types';

export const leadKeys = {
  all: ['leads'] as const,
  list: (filters: string) => ['leads', 'list', filters] as const,
  detail: (id: string) => ['leads', id] as const,
  stages: ['pipeline-stages'] as const,
  activities: (entityId: string) => ['activities', 'lead', entityId] as const,
};

export function useLeads(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: leadKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Lead[]; meta: { total: number } }>(`/leads?${filters}`),
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: leadKeys.detail(id),
    queryFn: () => apiFetch<{ data: Lead }>(`/leads/${id}`),
    enabled: Boolean(id),
  });
}

export function usePipelineStages() {
  return useQuery({
    queryKey: leadKeys.stages,
    queryFn: () => apiFetch<{ data: PipelineStage[] }>('/settings/pipeline-stages'),
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Lead }>('/leads', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: leadKeys.all }),
  });
}

export function useChangeLeadStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { stageId: string; lostReasonKey?: string }) =>
      apiFetch<{ data: Lead }>(`/leads/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leadKeys.all });
      void qc.invalidateQueries({ queryKey: leadKeys.detail(id) });
    },
  });
}

export function useConvertLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { existingCustomerId?: string } = {}) =>
      apiFetch<{ data: { lead: Lead; customerId: string } }>(`/leads/${id}/convert`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leadKeys.all });
      void qc.invalidateQueries({ queryKey: leadKeys.detail(id) });
    },
  });
}

export function useLeadActivities(leadId: string) {
  return useQuery({
    queryKey: leadKeys.activities(leadId),
    queryFn: () =>
      apiFetch<{ data: Activity[] }>(
        `/activities?entityType=lead&entityId=${encodeURIComponent(leadId)}`,
      ),
    enabled: Boolean(leadId),
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Activity }>('/activities', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      const entityId = String(vars.entityId);
      void qc.invalidateQueries({ queryKey: leadKeys.activities(entityId) });
      void qc.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: Activity }>(`/activities/${id}/complete`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['activities'] }),
  });
}

export function useDuplicateCheck() {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Array<{ entityType: string; id: string; label: string }> }>(
        '/leads/duplicate-check',
        { method: 'POST', body: JSON.stringify(body) },
      ),
  });
}

export function useCreatePipelineStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; category: string; order?: number }) =>
      apiFetch<{ data: PipelineStage }>('/settings/pipeline-stages', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: leadKeys.stages }),
  });
}

export function useUpdatePipelineStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      category?: string;
      order?: number;
      isActive?: boolean;
    }) =>
      apiFetch<{ data: PipelineStage }>(`/settings/pipeline-stages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: leadKeys.stages }),
  });
}
