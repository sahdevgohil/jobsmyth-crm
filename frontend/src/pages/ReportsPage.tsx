import { useMemo, useState } from 'react';
import { BarList, Legend, RevenueChart } from '@/components/charts/Charts';
import { SERIES } from '@/components/charts/series';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { TabPanel, Tabs } from '@/components/shared/Tabs';
import { formatCents } from '@/lib/money';
import { statusLabel } from '@/lib/status';
import { useDashboard, useFinanceAnalytics, useOperationsAnalytics, useSalesAnalytics } from '@/modules/analytics/api';
import { useLookups } from '@/modules/settings/api';
import { ApiError } from '@/types/api';

type Tab = 'sales' | 'operations' | 'finance';
const PRESETS = [
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '365', label: 'Last 12 months', days: 365 },
  { value: 'all', label: 'All time', days: 3650 },
];

const pct = (n: number): string => `${Math.round(n * 100)}%`;

function Panel({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Counts({ items, empty = 'No data in this period.' }: { items: Array<{ key: string; label: string; value: number }>; empty?: string }): React.ReactElement {
  if (items.length === 0) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return <BarList rows={items.map((i) => ({ key: i.key, label: i.label, value: i.value }))} />;
}

export function ReportsPage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('sales');
  const [preset, setPreset] = useState('90');
  const range = useMemo(() => {
    const days = PRESETS.find((p) => p.value === preset)?.days ?? 90;
    const to = new Date();
    to.setSeconds(0, 0);
    return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() };
  }, [preset]);

  const sources = useLookups('lead_source');
  const sales = useSalesAnalytics(range.from, range.to, tab === 'sales');
  const ops = useOperationsAnalytics(range.from, range.to, tab === 'operations');
  const finance = useFinanceAnalytics(range.from, range.to, tab === 'finance');
  const dash = useDashboard(range.from, range.to);
  const active = tab === 'sales' ? sales : tab === 'operations' ? ops : finance;
  const sourceLabel = (k: string): string => sources.data?.data.find((s) => s.key === k)?.label ?? statusLabel(k);

  return (
    <div>
      <PageHeader
        title="Reports & analytics"
        description="Sales, operations and finance, aggregated by the server for your records and permissions."
        actions={
          <select aria-label="Date range" value={preset} onChange={(e) => setPreset(e.target.value)} className="h-10 rounded-md border border-border bg-card px-3 text-sm shadow-sm">
            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        }
      />
      <Tabs
        tabs={[{ key: 'sales', label: 'Sales' }, { key: 'operations', label: 'Operations' }, { key: 'finance', label: 'Finance' }]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {active.isLoading ? <LoadingState /> : null}
      {active.isError ? <ErrorState message={active.error instanceof ApiError ? active.error.message : 'Failed to load report.'} onRetry={() => void active.refetch()} /> : null}

      {tab === 'sales' && sales.data ? (
        <TabPanel id="sales">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Leads" value={sales.data.data.totalLeads} />
            <StatCard label="Converted" value={sales.data.data.convertedLeads} />
            <StatCard label="Conversion rate" value={pct(sales.data.data.conversionRate)} />
            <StatCard label="Won" value={sales.data.data.won} />
            <StatCard label="Lost" value={sales.data.data.lost} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Leads by source"><Counts items={sales.data.data.leadsBySource.map((s) => ({ key: s.key, label: sourceLabel(s.key), value: s.count }))} /></Panel>
            <Panel title="Leads by stage"><Counts items={sales.data.data.leadsByStage.map((s) => ({ key: s.key, label: s.label, value: s.count }))} /></Panel>
            <Panel title="Leads by salesperson"><Counts items={sales.data.data.leadsBySalesperson.map((s) => ({ key: s.key, label: s.label, value: s.count }))} /></Panel>
            <Panel title="Follow-up performance">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">Scheduled</dt><dd className="text-lg font-semibold">{sales.data.data.followUpPerformance.total}</dd></div>
                <div><dt className="text-muted-foreground">Completed</dt><dd className="text-lg font-semibold">{sales.data.data.followUpPerformance.completed} <span className="text-sm font-normal text-muted-foreground">({pct(sales.data.data.followUpPerformance.completionRate)})</span></dd></div>
                <div><dt className="text-muted-foreground">Overdue</dt><dd className="text-lg font-semibold text-danger">{sales.data.data.followUpPerformance.overdue}</dd></div>
              </dl>
            </Panel>
          </div>
        </TabPanel>
      ) : null}

      {tab === 'operations' && ops.data ? (
        <TabPanel id="operations">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Active projects" value={ops.data.data.activeProjects} />
            <StatCard label="Delayed projects" value={ops.data.data.delayedProjects} tone={ops.data.data.delayedProjects > 0 ? 'danger' : 'default'} hint="Past planned end date" />
            <StatCard label="Completed inspections" value={ops.data.data.completedInspections} />
            <StatCard label="Subcontractors with open work" value={ops.data.data.subcontractorWorkload.length} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Appointments by status"><Counts items={ops.data.data.appointmentsByStatus.map((s) => ({ key: s.key, label: statusLabel(s.key), value: s.count }))} /></Panel>
            <Panel title="Projects by status"><Counts items={ops.data.data.projectsByStatus.map((s) => ({ key: s.key, label: statusLabel(s.key), value: s.count }))} /></Panel>
            <Panel title="Tasks by status"><Counts items={ops.data.data.tasksByStatus.map((s) => ({ key: s.key, label: statusLabel(s.key), value: s.count }))} /></Panel>
            <Panel title="Work orders by status"><Counts items={ops.data.data.workOrdersByStatus.map((s) => ({ key: s.key, label: statusLabel(s.key), value: s.count }))} /></Panel>
          </div>
        </TabPanel>
      ) : null}

      {tab === 'finance' && finance.data ? (
        <TabPanel id="finance">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Invoiced" value={formatCents(finance.data.data.invoicedCents)} />
            <StatCard label="Collected" value={formatCents(finance.data.data.collectedCents)} />
            <StatCard label="Outstanding" value={formatCents(finance.data.data.outstandingCents)} tone={finance.data.data.outstandingCents > 0 ? 'warning' : 'default'} />
            <StatCard label="Overdue invoices" value={finance.data.data.overdueCount} tone={finance.data.data.overdueCount > 0 ? 'danger' : 'default'} />
          </div>
          <Panel title="Revenue trend">
            {dash.data && dash.data.data.revenue.trend.some((p) => p.invoicedCents > 0 || p.collectedCents > 0) ? (
              <>
                <RevenueChart granularity={dash.data.data.revenue.granularity} labelA="Invoiced" labelB="Collected" points={dash.data.data.revenue.trend.map((p) => ({ period: p.period, a: p.invoicedCents, b: p.collectedCents }))} />
                <div className="mt-2"><Legend items={[{ label: 'Invoiced', color: SERIES.primary }, { label: 'Collected', color: SERIES.secondary }]} /></div>
              </>
            ) : <p className="py-4 text-sm text-muted-foreground">No invoices or payments in this period.</p>}
          </Panel>
        </TabPanel>
      ) : null}
    </div>
  );
}
