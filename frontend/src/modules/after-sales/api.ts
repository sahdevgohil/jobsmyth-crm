import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type AfterSalesRecord = {
  id: string;
  projectId: string;
  customerId: string;
  propertyId: string | null;
  completionConfirmedAt: string | null;
  completionConfirmedBy: string | null;
  feedbackRating: number | null;
  feedbackComment: string;
  warrantyLookupKey: string | null;
  warrantyNotes: string;
  followUpDueAt: string | null;
  followUpCompletedAt: string | null;
  serviceHistoryNotes: string;
  customerNotesVisible: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export function useAfterSalesList(filters: { customerId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.customerId) params.set('customerId', filters.customerId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  const q = params.toString();
  return useQuery({
    queryKey: ['after-sales', filters],
    queryFn: () =>
      apiFetch<{ data: AfterSalesRecord[] }>(`/after-sales${q ? `?${q}` : ''}`),
  });
}

export function useCreateAfterSales() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      projectId: string;
      customerId: string;
      propertyId?: string;
      completionConfirmedAt?: string;
      feedbackRating?: number;
      feedbackComment?: string;
      warrantyLookupKey?: string;
      warrantyNotes?: string;
      followUpDueAt?: string;
      serviceHistoryNotes?: string;
      customerNotesVisible?: string;
    }) =>
      apiFetch<{ data: AfterSalesRecord }>('/after-sales', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['after-sales'] });
    },
  });
}
