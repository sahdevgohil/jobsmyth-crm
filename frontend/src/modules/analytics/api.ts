import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type TimelineItem = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  at: string;
  href: string;
};

export type ScheduleItem = {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  at: string;
  href: string;
  overdue: boolean;
};

export type DashboardData = {
  range: { from: string; to: string };
  isEmpty: boolean;
  tiles: {
    totalLeads: number;
    newLeads: number;
    activeLeads: number;
    convertedLeads: number;
    totalCustomers: number;
    overdueFollowUps: number;
    upcomingAppointments: number;
    activeProjects: number;
    outstandingInvoicesCents: number;
    outstandingInvoicesCount: number;
    overdueInvoicesCount: number;
  };
  pipeline: Array<{ stageId: string; name: string; category: string; order: number; count: number }>;
  salesPerformance: Array<{
    userId: string;
    name: string;
    leadsAssigned: number;
    leadsConverted: number;
    won: number;
    lost: number;
    conversionRate: number;
  }>;
  revenue: {
    invoicedCents: number;
    collectedCents: number;
    outstandingCents: number;
    granularity: 'day' | 'week' | 'month';
    trend: Array<{ period: string; invoicedCents: number; collectedCents: number }>;
  };
  recentActivities: TimelineItem[];
  schedule: { today: ScheduleItem[]; upcoming: ScheduleItem[]; followUps: ScheduleItem[] };
};

export type SalesAnalytics = {
  range: { from: string; to: string };
  totalLeads: number;
  leadsBySource: Array<{ key: string; count: number }>;
  leadsByStage: Array<{ key: string; label: string; count: number }>;
  leadsBySalesperson: Array<{ key: string; label: string; count: number }>;
  convertedLeads: number;
  conversionRate: number;
  won: number;
  lost: number;
  followUpPerformance: {
    total: number;
    completed: number;
    overdue: number;
    completionRate: number;
  };
};

export type OperationsAnalytics = {
  range: { from: string; to: string };
  appointmentsByStatus: Array<{ key: string; count: number }>;
  completedInspections: number;
  projectsByStatus: Array<{ key: string; count: number }>;
  activeProjects: number;
  delayedProjects: number;
  tasksByStatus: Array<{ key: string; count: number }>;
  workOrdersByStatus: Array<{ key: string; count: number }>;
  subcontractorWorkload: Array<{ subcontractorId: string | null; openWorkOrders: number }>;
};

export type FinanceAnalytics = {
  range: { from: string; to: string };
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
  overdueCount: number;
  revenueByDay: Array<{ date: string; revenueCents: number }>;
};

function rangeQs(from?: string, to?: string): string {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const q = qs.toString();
  return q ? `?${q}` : '';
}

export function useDashboard(from?: string, to?: string) {
  return useQuery({
    queryKey: ['analytics', 'dashboard', from, to],
    queryFn: () =>
      apiFetch<{ data: DashboardData }>(`/analytics/dashboard${rangeQs(from, to)}`),
  });
}

export function useSalesAnalytics(from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: ['analytics', 'sales', from, to],
    enabled,
    queryFn: () =>
      apiFetch<{ data: SalesAnalytics }>(`/analytics/sales${rangeQs(from, to)}`),
  });
}

export function useOperationsAnalytics(from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: ['analytics', 'operations', from, to],
    enabled,
    queryFn: () =>
      apiFetch<{ data: OperationsAnalytics }>(`/analytics/operations${rangeQs(from, to)}`),
  });
}

export function useFinanceAnalytics(from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: ['analytics', 'finance', from, to],
    enabled,
    queryFn: () =>
      apiFetch<{ data: FinanceAnalytics }>(`/analytics/finance${rangeQs(from, to)}`),
  });
}
