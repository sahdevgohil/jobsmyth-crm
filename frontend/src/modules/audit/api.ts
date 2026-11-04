import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type AuditLog = {
  id: string;
  actorType: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: unknown;
  requestId?: string;
  ip?: string;
  createdAt: string;
};

export const auditKeys = {
  list: (page: number) => ['audit-logs', page] as const,
};

export function useAuditLogs(page = 1) {
  return useQuery({
    queryKey: auditKeys.list(page),
    queryFn: () =>
      apiFetch<{
        data: AuditLog[];
        meta: { page: number; pageSize: number; total: number };
      }>(`/audit-logs?page=${page}&pageSize=25`),
  });
}
