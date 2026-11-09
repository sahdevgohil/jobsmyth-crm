import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type Material = {
  id: string;
  name: string;
  sku: string;
  description: string;
  unit: string;
  costCents: number;
  supplier: string;
  active: boolean;
  notes: string;
};

export const materialKeys = {
  all: ['materials'] as const,
  list: (filters: string) => ['materials', 'list', filters] as const,
};

export function useMaterials(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: materialKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Material[]; meta: { total: number } }>(`/materials?${filters}`),
  });
}

export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Material }>('/materials', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: materialKeys.all }),
  });
}

export function useUpdateMaterial(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Material }>(`/materials/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: materialKeys.all }),
  });
}
