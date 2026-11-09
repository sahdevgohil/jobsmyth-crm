import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Answers, FormDefinition } from '@/lib/form-engine';
import { apiFetch } from '@/services/http';
import { useAuthStore } from '@/stores/auth-store';
import type { SyncApi, SyncResponse } from '@/modules/offline/sync';

export type FormKind = 'intake' | 'roofing_job' | 'inspection' | 'other';

export type FormTemplate = {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: FormKind;
  serviceType: string;
  isActive: boolean;
  systemKey: string;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  definition: FormDefinition;
  updatedAt: string;
};

export type FormSubmission = {
  id: string;
  clientId: string;
  templateId: string;
  templateKey: string;
  templateVersion: number;
  kind: FormKind;
  status: 'draft' | 'completed';
  revision: number;
  answers: Answers;
  customerId: string | null;
  propertyId: string | null;
  leadId: string | null;
  appointmentId: string | null;
  inspectionId: string | null;
  projectId: string | null;
  assignedTo: string | null;
  completedAt: string | null;
  reportFileId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TemplateVersion = { version: number; definition: FormDefinition; changeNote: string; publishedAt: string };

export const formKeys = {
  templates: ['forms', 'templates'] as const,
  template: (id: string) => ['forms', 'templates', id] as const,
  versions: (id: string) => ['forms', 'templates', id, 'versions'] as const,
  submissions: (qs: string) => ['forms', 'submissions', qs] as const,
  submission: (id: string) => ['forms', 'submission', id] as const,
};

export function useTemplates(kind?: FormKind) {
  return useQuery({
    queryKey: [...formKeys.templates, kind ?? 'all'],
    queryFn: () => apiFetch<{ data: FormTemplate[] }>(`/forms/templates${kind ? `?kind=${kind}` : ''}`).then((r) => r.data),
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: formKeys.template(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => apiFetch<{ data: FormTemplate }>(`/forms/templates/${id}`).then((r) => r.data),
  });
}

export function useTemplateVersions(id: string | undefined) {
  return useQuery({
    queryKey: formKeys.versions(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => apiFetch<{ data: TemplateVersion[] }>(`/forms/templates/${id}/versions`).then((r) => r.data),
  });
}

export function useTemplateMutations() {
  const qc = useQueryClient();
  const done = (): Promise<void> => qc.invalidateQueries({ queryKey: ['forms'] });
  return {
    install: useMutation({ mutationFn: () => apiFetch('/forms/templates/install-defaults', { method: 'POST' }), onSuccess: done }),
    create: useMutation({
      mutationFn: (b: { key: string; name: string; description?: string; kind: FormKind; serviceType?: string; definition: FormDefinition }) =>
        apiFetch<{ data: FormTemplate }>('/forms/templates', { method: 'POST', body: JSON.stringify(b) }).then((r) => r.data),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string; isActive?: boolean; definition?: FormDefinition }) =>
        apiFetch<{ data: FormTemplate }>(`/forms/templates/${id}`, { method: 'PATCH', body: JSON.stringify(b) }).then((r) => r.data),
      onSuccess: done,
    }),
    publish: useMutation({
      mutationFn: ({ id, changeNote }: { id: string; changeNote?: string }) =>
        apiFetch<{ data: FormTemplate }>(`/forms/templates/${id}/publish`, { method: 'POST', body: JSON.stringify({ changeNote }) }).then((r) => r.data),
      onSuccess: done,
    }),
  };
}

export function useSubmissions(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as Array<[string, string]>).toString();
  return useQuery({
    queryKey: formKeys.submissions(qs),
    queryFn: () => apiFetch<{ data: FormSubmission[]; meta: { total: number } }>(`/forms/submissions?${qs}`),
  });
}

export function useSubmission(id: string | undefined) {
  return useQuery({
    queryKey: formKeys.submission(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => apiFetch<{ data: FormSubmission }>(`/forms/submissions/${id}`).then((r) => r.data),
  });
}

export type IntakeResult = { created: boolean; customerId: string; propertyId: string; leadId: string; submissionId: string };

export function submitIntake(body: { clientId: string; answers: Answers; force?: boolean }): Promise<IntakeResult> {
  return apiFetch<{ data: IntakeResult }>('/forms/intake', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data);
}

/** Network binding for the offline sync manager. Uses the normal authenticated client (with token refresh). */
export const syncApi: SyncApi = {
  sync: (body) => apiFetch<{ data: SyncResponse }>('/forms/sync', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data),
  uploadFile: (body) => apiFetch<{ data: { id: string } }>('/files', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data),
};

/** Opens the branded PDF in a new tab (token goes in the Authorization header, so fetch + blob). */
export async function openReport(submissionId: string): Promise<void> {
  const base = import.meta.env.VITE_API_URL as string;
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}/forms/submissions/${submissionId}/report`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
  if (!res.ok) throw new Error('Could not generate the report.');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
