import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  CalendarPlus,
  FileText,
  HardHat,
  Handshake,
  UserPlus,
  Users,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList, Legend, RevenueChart } from '@/components/charts/Charts';
import { SERIES } from '@/components/charts/series';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { formatCents } from '@/lib/money';
import { useDashboard, type ScheduleItem } from '@/modules/analytics/api';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

const PRESETS = [
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '365', label: 'Last 12 months', days: 365 },
  { value: 'all', label: 'All time', days: 3650 },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function time(iso: string, withDate = false): string {
  const d = new Date(iso);
  const timeZone = 'America/Chicago'; // company default time zone
  return withDate
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
}

function ScheduleList({ items, withDate, empty }: { items: ScheduleItem[]; withDate?: boolean; empty: string }): React.ReactElement {
  if (items.length === 0) return <p className="py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => (
        <li key={i.id}>
          <Link to={i.href} className="flex items-start justify-between gap-3 py-2 hover:bg-muted/40">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{i.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{i.subtitle}</span>
            </span>
            <span className={`shrink-0 text-xs tabular-nums ${i.overdue ? 'font-medium text-danger' : 'text-muted-foreground'}`}>
              {i.overdue ? 'Overdue · ' : ''}
              {time(i.at, withDate || i.overdue)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HomePage(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const [preset, setPreset] = useState('90');
  const range = useMemo(() => {
    const days = PRESETS.find((p) => p.value === preset)?.days ?? 90;
    const to = new Date();
    to.setSeconds(0, 0);
    return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() };
  }, [preset]);
  const dash = useDashboard(range.from, range.to);

  const canLead = useHasPermission('leads:create');
  const canCustomer = useHasPermission('customers:create');
  const canAppt = useHasPermission('appointments:create');
  const canEstimate = useHasPermission('estimates:create');
  const canProject = useHasPermission('projects:create');
  const isAdmin = useHasPermission('leads:assign');

  const actions: Array<{ to: string; label: string; icon: LucideIcon; show: boolean }> = [
    { to: '/app/leads/new', label: 'Add lead', icon: Handshake, show: canLead },
    { to: '/app/customers/new', label: 'Add customer', icon: UserPlus, show: canCustomer },
    { to: '/app/appointments/new', label: 'Schedule appointment', icon: CalendarPlus, show: canAppt },
    { to: '/app/estimates/new', label: 'Create estimate', icon: FileText, show: canEstimate },
    { to: '/app/projects/new', label: 'Create project', icon: HardHat, show: canProject },
  ];
  const visibleActions = actions.filter((a) => a.show);

  const header = (
    <PageHeader
      title="Dashboard"
      description={`${greeting()}, ${user?.firstName ?? ''} · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`}
      actions={
        <select
          aria-label="Date range"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="h-10 rounded-md border border-border bg-card px-3 text-sm shadow-sm"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      }
    />
  );

  if (dash.isLoading) return <div>{header}<LoadingState label="Loading dashboard…" /></div>;
  if (dash.isError || !dash.data) {
    return (
      <div>
        {header}
        <ErrorState
          message={dash.error instanceof ApiError ? dash.error.message : 'Failed to load dashboard.'}
          onRetry={() => void dash.refetch()}
        />
      </div>
    );
  }

  const d = dash.data.data;

  if (d.isEmpty) {
    return (
      <div>
        {header}
        <EmptyState
          title="Welcome to the Legacy Construction Group CRM"
          description="Nothing has been recorded yet. Start by adding your first lead or customer — KPIs, pipeline, revenue and your schedule will appear here as records are created. For a populated demo environment, run the development demo seed (see README)."
          action={
            <>
              {canLead ? <Button asChild><Link to="/app/leads/new">Add lead</Link></Button> : null}
              {canCustomer ? <Button asChild variant="outline"><Link to="/app/customers/new">Add customer</Link></Button> : null}
            </>
          }
        />
      </div>
    );
  }

  const t = d.tiles;
  const hasRevenue = d.revenue.invoicedCents > 0 || d.revenue.collectedCents > 0;
  const pipeline = d.pipeline.filter((p) => p.count > 0 || p.category === 'open');

  return (
    <div className="space-y-6">
      {header}

      {visibleActions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {visibleActions.map((a) => (
            <Button key={a.to} asChild variant="outline" size="sm">
              <Link to={a.to}>
                <a.icon className="h-4 w-4" aria-hidden /> {a.label}
              </Link>
            </Button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total leads" value={t.totalLeads} icon={Handshake} to="/app/leads" hint="Created in period" />
        <StatCard label="New leads" value={t.newLeads} icon={UserPlus} to="/app/leads" hint="Still in first stage" />
        <StatCard label="Active leads" value={t.activeLeads} icon={Handshake} to="/app/leads/pipeline" hint="Open pipeline" />
        <StatCard label="Converted" value={t.convertedLeads} icon={CheckCircle2} to="/app/customers" hint="Became customers" />
        <StatCard label="Customers" value={t.totalCustomers} icon={Users} to="/app/customers" />
        <StatCard label="Upcoming appointments" value={t.upcomingAppointments} icon={CalendarClock} to="/app/appointments" />
        <StatCard label="Active projects" value={t.activeProjects} icon={HardHat} to="/app/projects" />
        <StatCard
          label="Outstanding invoices"
          value={formatCents(t.outstandingInvoicesCents)}
          icon={CircleDollarSign}
          to="/app/invoices"
          hint={`${t.outstandingInvoicesCount} open · ${t.overdueInvoicesCount} overdue`}
          tone={t.overdueInvoicesCount > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Overdue follow-ups"
          value={t.overdueFollowUps}
          icon={AlertTriangle}
          to="/app/leads?hasOverdueFollowUp=true"
          tone={t.overdueFollowUps > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title="Revenue overview">
            <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Invoiced</p><p className="text-lg font-semibold tabular-nums">{formatCents(d.revenue.invoicedCents)}</p></div>
              <div><p className="text-xs text-muted-foreground">Collected</p><p className="text-lg font-semibold tabular-nums">{formatCents(d.revenue.collectedCents)}</p></div>
              <div><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-lg font-semibold tabular-nums">{formatCents(d.revenue.outstandingCents)}</p></div>
            </div>
            {hasRevenue ? (
              <>
                <RevenueChart
                  granularity={d.revenue.granularity}
                  labelA="Invoiced"
                  labelB="Collected"
                  points={d.revenue.trend.map((p) => ({ period: p.period, a: p.invoicedCents, b: p.collectedCents }))}
                />
                <div className="mt-2">
                  <Legend items={[{ label: 'Invoiced', color: SERIES.primary }, { label: 'Collected', color: SERIES.secondary }]} />
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No invoices issued in this period yet.</p>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="Lead pipeline" action={<Link className="text-xs hover:underline" to="/app/leads/pipeline">Open board</Link>}>
            {pipeline.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No leads created in this period.</p>
            ) : (
              <BarList rows={pipeline.map((p) => ({ key: p.stageId, label: p.name, value: p.count }))} />
            )}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={isAdmin ? 'Sales performance' : 'My performance'}>
          {d.salesPerformance.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No salespeople found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Salesperson</th>
                    <th className="px-2 text-right font-medium">Leads</th>
                    <th className="px-2 text-right font-medium">Converted</th>
                    <th className="px-2 text-right font-medium">Won</th>
                    <th className="px-2 text-right font-medium">Lost</th>
                    <th className="pl-2 text-right font-medium">Conv.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {d.salesPerformance.map((r) => (
                    <tr key={r.userId}>
                      <td className="py-2 pr-2 font-medium">{r.name}</td>
                      <td className="px-2 text-right">{r.leadsAssigned}</td>
                      <td className="px-2 text-right">{r.leadsConverted}</td>
                      <td className="px-2 text-right">{r.won}</td>
                      <td className="px-2 text-right">{r.lost}</td>
                      <td className="pl-2 text-right">{Math.round(r.conversionRate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Today's schedule" action={<Link className="text-xs hover:underline" to="/app/appointments/calendar">Calendar</Link>}>
          <ScheduleList items={d.schedule.today} empty="No appointments today." />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Upcoming (next 14 days)">
          <ScheduleList items={d.schedule.upcoming} withDate empty="Nothing scheduled in the next two weeks." />
        </Panel>
        <Panel title="Follow-ups">
          <ScheduleList items={d.schedule.followUps} withDate empty="No follow-ups due this week." />
        </Panel>
        <Panel title="Recent activity">
          {d.recentActivities.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No recent activity.</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.recentActivities.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <Link to={a.href} className="block py-2 hover:bg-muted/40">
                    <span className="block truncate text-sm font-medium text-foreground">{a.title}</span>
                    <span className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{a.detail}</span>
                      <span className="shrink-0">{time(a.at, true)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
