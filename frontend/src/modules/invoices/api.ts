import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type Invoice = {
  id: string;
  number: string;
  customerId: string;
  propertyId: string | null;
  projectId: string | null;
  status: string;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  dueDate?: string | null;
  invoiceDate?: string;
  lineItems?: Array<{ description: string; quantity: number; unit: string; unitCostCents: number; amountCents: number }>;
};

export type InvoicePayment = {
  id: string;
  amountCents: number;
  paymentDate: string;
  method: string;
  transactionRef: string;
};

export function useInvoicePayments(id: string) {
  return useQuery({
    queryKey: ['invoices', id, 'payments'],
    queryFn: () => apiFetch<{ data: InvoicePayment[] }>(`/invoices/${id}/payments`),
    enabled: Boolean(id),
  });
}

/** Opens the printable, branded invoice in a new tab using the access token. */
export async function openInvoicePreview(id: string, accessToken: string | null): Promise<void> {
  const API_URL = import.meta.env.VITE_API_URL as string;
  const res = await fetch(`${API_URL}/invoices/${id}/preview`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Could not load invoice.');
  const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const invoiceKeys = {
  all: ['invoices'] as const,
  list: (f: string) => ['invoices', 'list', f] as const,
  detail: (id: string) => ['invoices', id] as const,
  summary: ['invoices', 'summary'] as const,
};

export function useInvoices(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: invoiceKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Invoice[]; meta: { total: number } }>(`/invoices?${filters}`),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => apiFetch<{ data: Invoice }>(`/invoices/${id}`),
    enabled: Boolean(id),
  });
}

export function useInvoiceSummary() {
  return useQuery({
    queryKey: invoiceKeys.summary,
    queryFn: () =>
      apiFetch<{
        data: {
          invoicedCents: number;
          collectedCents: number;
          outstandingCents: number;
          overdueCount: number;
          qbo: { status: string; message: string };
        };
      }>('/invoices/summary'),
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Invoice }>('/invoices', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: invoiceKeys.all }),
  });
}

export function useSendInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ data: Invoice; meta: { emailDelivery: string; qbo: string } }>(
        `/invoices/${id}/send`,
        { method: 'POST', body: '{}' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) }),
  });
}

export function useRecordPayment(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: { payment: unknown; invoice: Invoice } }>(
        `/invoices/${invoiceId}/payments`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
      void qc.invalidateQueries({ queryKey: invoiceKeys.summary });
    },
  });
}
