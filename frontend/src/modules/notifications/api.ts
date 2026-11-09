import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type Notification = {
  id: string;
  type: string;
  title: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export function useUnreadCount(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => apiFetch<{ data: { count: number } }>('/notifications/unread-count'),
    refetchInterval: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () =>
      apiFetch<{ data: Notification[] }>('/notifications?pageSize=20'),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
