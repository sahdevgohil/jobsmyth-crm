import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type Project = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string;
  proposalId: string | null;
  status: string;
  priority: string;
  notes: string;
  budgetCents: number;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  leadId: string | null;
  estimateId: string | null;
  projectManagerId: string | null;
  assignedEmployeeIds: string[];
  createdAt: string;
};

export type ProjectTask = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  notes: string;
};

export const projectKeys = {
  all: ['projects'] as const,
  list: (f: string) => ['projects', 'list', f] as const,
  detail: (id: string) => ['projects', id] as const,
  tasks: (id: string) => ['projects', id, 'tasks'] as const,
};

export function useProjects(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Project[]; meta: { total: number } }>(`/projects?${filters}`),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => apiFetch<{ data: Project }>(`/projects/${id}`),
    enabled: Boolean(id),
  });
}

export function useProjectTasks(id: string) {
  return useQuery({
    queryKey: projectKeys.tasks(id),
    queryFn: () => apiFetch<{ data: ProjectTask[] }>(`/projects/${id}/tasks`),
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Project }>('/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useChangeProjectStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: string) =>
      apiFetch<{ data: Project }>(`/projects/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useCreateProjectTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; notes?: string }) =>
      apiFetch<{ data: ProjectTask }>(`/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: projectKeys.tasks(projectId) }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Project }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export type TimelineEntry = { id: string; kind: string; title: string; detail: string; at: string };

export function useProjectTimeline(id: string) {
  return useQuery({
    queryKey: ['projects', id, 'timeline'],
    enabled: Boolean(id),
    queryFn: () => apiFetch<{ data: TimelineEntry[] }>(`/projects/${id}/timeline`),
  });
}
