import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';
import type { CreateUserValues } from './schemas';
import type { User, UsersListResponse } from './types';

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
};

export function useUsers(options?: { enabled?: boolean }) {
  return useQuery({
    enabled: options?.enabled ?? true,
    queryKey: userKeys.list(),
    queryFn: () => apiFetch<UsersListResponse>('/users?page=1&pageSize=100'),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateUserValues) =>
      apiFetch<{
        data: { user: User; inviteToken: string; emailDeliveryEnabled: boolean };
      }>('/users', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ data: User }>(`/users/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export type StaffMember = { id: string; firstName: string; lastName: string; role: 'admin' | 'salesperson' };

/** Active staff names for labels and assignee pickers (available to every signed-in staff user). */
export function useStaffDirectory() {
  return useQuery({
    queryKey: ['users', 'directory'],
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch<{ data: StaffMember[] }>('/users/directory'),
  });
}
