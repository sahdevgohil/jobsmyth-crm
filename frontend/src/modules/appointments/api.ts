import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { Appointment } from './types';

export const appointmentKeys = {
  all: ['appointments'] as const,
  list: (filters: string) => ['appointments', 'list', filters] as const,
  detail: (id: string) => ['appointments', id] as const,
};

export function useAppointments(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const filters = qs.toString();
  return useQuery({
    queryKey: appointmentKeys.list(filters),
    queryFn: () =>
      apiFetch<{ data: Appointment[]; meta: { total: number } }>(`/appointments?${filters}`),
  });
}

export function useAppointment(id: string) {
  return useQuery({
    queryKey: appointmentKeys.detail(id),
    queryFn: () => apiFetch<{ data: Appointment }>(`/appointments/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ data: Appointment }>('/appointments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: appointmentKeys.all }),
  });
}

export function useCancelAppointment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason?: string } = {}) =>
      apiFetch<{ data: Appointment }>(`/appointments/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: appointmentKeys.all });
      void qc.invalidateQueries({ queryKey: appointmentKeys.detail(id) });
    },
  });
}

export function useRescheduleAppointment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { startAt: string; endAt: string; force?: boolean }) =>
      apiFetch<{ data: Appointment }>(`/appointments/${id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: appointmentKeys.all });
      void qc.invalidateQueries({ queryKey: appointmentKeys.detail(id) });
    },
  });
}

export function useAppointmentReminders(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email?: boolean; sms?: boolean }) =>
      apiFetch<{ data: Appointment }>(`/appointments/${id}/reminders`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: appointmentKeys.detail(id) }),
  });
}
