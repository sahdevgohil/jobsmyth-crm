import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export const STAGES = ['estimates_out', 'estimates_accepted', 'jobs_started', 'jobs_completed', 'invoiced', 'invoices_completed'] as const;
export type Stage = (typeof STAGES)[number];

export type StageSummary = { stage: Stage; label: string; jobCount: number; valueCents: number; percentOfActive: number | null; active: boolean };
export type PipelineSummary = {
  stages: StageSummary[];
  totalActiveCents: number;
  activeJobCount: number;
  denied: { jobCount: number; valueCents: number };
  calculation: string;
  asOf: string | null;
  limitations: string[];
};

export type JobView = {
  id: string;
  number: string;
  state: string;
  stage: Stage | null;
  stageLabel: string;
  stageDate: string | null;
  customer: { id: string; name: string };
  property: { id: string; address: string } | null;
  jobType: string;
  estimateId: string | null;
  projectId: string | null;
  projectStatus: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  paidAt: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  estimateCents: number;
  contractCents: number;
  invoicedCents: number;
  paidCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdue: boolean;
  paymentStatus: 'none' | 'unpaid' | 'partial' | 'overdue' | 'paid';
  valueCents: number;
  salesperson: { id: string; name: string } | null;
  projectManager: { id: string; name: string } | null;
  denial: { reason: string; note: string; at: string | null } | null;
  approximateHistory: boolean;
};

export type Filters = { from?: string; to?: string; salespersonId?: string; projectManagerId?: string; jobType?: string; paymentStatus?: string; asOf?: string };
export type JobQuery = Filters & { stage?: Stage | 'denied'; search?: string; sort?: string; dir?: 'asc' | 'desc'; page: number; pageSize: number };

const qs = (o: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};

export const pipelineKeys = { all: ['pipeline'] as const };

export const usePipelineSummary = (f: Filters) =>
  useQuery({ queryKey: [...pipelineKeys.all, 'summary', f], queryFn: () => apiFetch<{ data: PipelineSummary }>(`/pipeline/summary?${qs(f)}`).then((r) => r.data), placeholderData: keepPreviousData });

export const usePipelineJobs = (q: JobQuery, enabled: boolean) =>
  useQuery({
    queryKey: [...pipelineKeys.all, 'jobs', q],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => apiFetch<{ data: JobView[]; meta: { page: number; pageSize: number; total: number }; totals: { jobCount: number; valueCents: number; invoicedCents: number; paidCents: number; outstandingCents: number } }>(`/pipeline/jobs?${qs(q)}`),
  });

export const useFilterOptions = () =>
  useQuery({ queryKey: [...pipelineKeys.all, 'options'], queryFn: () => apiFetch<{ data: { salespeople: Array<{ id: string; name: string }>; projectManagers: Array<{ id: string; name: string }>; jobTypes: string[] } }>('/pipeline/filter-options').then((r) => r.data) });

export type JobHistory = {
  job: JobView;
  history: Array<{ from: string; to: string; at: string; by: string; auto: boolean; trigger: string; reason: string; exception: boolean; approximate: boolean; valueCents: number | null }>;
  changeOrders: Array<{ id: string; description: string; amountCents: number; approvedAt: string }>;
};
export const useJobHistory = (id: string | null) =>
  useQuery({ queryKey: [...pipelineKeys.all, 'history', id], enabled: Boolean(id), queryFn: () => apiFetch<{ data: JobHistory }>(`/pipeline/jobs/${id}`).then((r) => r.data) });

export function usePipelineMutations() {
  const qc = useQueryClient();
  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: pipelineKeys.all });
  const post = (path: string, body?: unknown) => apiFetch(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    move: useMutation({ mutationFn: (v: { id: string; toStage: Stage; reason: string }) => post(`/pipeline/jobs/${v.id}/move`, { toStage: v.toStage, reason: v.reason }), onSuccess: refresh }),
    changeOrder: useMutation({ mutationFn: (v: { id: string; description: string; amountCents: number }) => post(`/pipeline/jobs/${v.id}/change-orders`, { description: v.description, amountCents: v.amountCents }), onSuccess: refresh }),
    backfill: useMutation({ mutationFn: () => apiFetch<{ data: { estimates: number; projects: number; jobs: number } }>('/pipeline/backfill', { method: 'POST' }).then((r) => r.data), onSuccess: refresh }),
  };
}
