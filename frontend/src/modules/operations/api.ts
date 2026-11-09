import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { ApiListMeta } from '@/types/api';

export type ListResult<T> = { data: T[]; meta: ApiListMeta };

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v));
  });
  return q.toString();
}

/** Generic paginated list hook used by the operations/finance list pages. */
export function useListQuery<T>(key: string, path: string, params: Record<string, string | number | undefined>) {
  const query = qs(params);
  return useQuery({
    queryKey: [key, 'list', query],
    queryFn: () => apiFetch<ListResult<T>>(`${path}?${query}`),
    placeholderData: keepPreviousData,
  });
}

export type PropertyRow = {
  id: string;
  customerId: string;
  customerName: string;
  address: { line1: string; line2: string; city: string; state: string; zip: string };
  propertyTypeKey: string;
  details: { stories: number | null; roofAgeYears: number | null; notes: string };
  updatedAt: string;
};

export type TaskRow = {
  id: string;
  projectId: string;
  projectNumber: string;
  title: string;
  assignedTo: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  notes: string;
};

export type WorkOrderRow = {
  id: string;
  number: string;
  projectId: string;
  subcontractorId: string | null;
  assignedEmployeeId: string | null;
  title: string;
  description: string;
  instructions: string;
  status: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  completionNotes: string;
  issues: string;
};

export type SubcontractorRow = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: { city: string; state: string };
  serviceCategories: string[];
  notes: string;
  active: boolean;
};

export type PaymentRow = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  paymentDate: string;
  method: string;
  transactionRef: string;
  status: string;
};

export type IntegrationRow = {
  key: string;
  name: string;
  purpose: string;
  status: string;
  message: string;
  fallback: string;
};

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiFetch<{ data: IntegrationRow[] }>('/integrations/status'),
  });
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { projectId: string; taskId: string; status: string }) =>
      apiFetch(`/projects/${v.projectId}/tasks/${v.taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: v.status }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/work-orders/${v.id}`, { method: 'PATCH', body: JSON.stringify(v.patch) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['work-orders'] }),
  });
}

export function useCreateWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/work-orders', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['work-orders'] }),
  });
}

export function useCreateSubcontractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/subcontractors', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['subcontractors'] }),
  });
}

export function useUpdateSubcontractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/subcontractors/${v.id}`, { method: 'PATCH', body: JSON.stringify(v.patch) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['subcontractors'] }),
  });
}
