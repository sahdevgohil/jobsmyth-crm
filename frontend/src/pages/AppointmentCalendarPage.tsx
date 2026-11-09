import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SelectFilter } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { addDays, dayKey, formatDayLabel, formatTime, startOfDayISO, weekday } from '@/lib/datetime';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';
import { useAppointments } from '@/modules/appointments/api';
import type { Appointment } from '@/modules/appointments/types';
import { useStaffDirectory } from '@/modules/users/api';
import { ApiError } from '@/types/api';

type View = 'month' | 'week' | 'day' | 'list';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
  { key: 'list', label: 'List' },
];

function startOfWeek(key: string): string {
  return addDays(key, -weekday(key));
}

function rangeFor(view: View, anchor: string): { from: string; to: string; days: string[] } {
  if (view === 'day') return { from: anchor, to: addDays(anchor, 1), days: [anchor] };
  if (view === 'week') {
    const s = startOfWeek(anchor);
    return { from: s, to: addDays(s, 7), days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) };
  }
  if (view === 'list') return { from: anchor, to: addDays(anchor, 30), days: [] };
  const first = `${anchor.slice(0, 7)}-01`;
  const gridStart = startOfWeek(first);
  const nextMonth = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const lastDay = addDays(nextMonth, -1);
  const gridEnd = addDays(startOfWeek(lastDay), 7);
  const n = Math.round((Date.parse(gridEnd) - Date.parse(gridStart)) / 86_400_000);
  return { from: gridStart, to: gridEnd, days: Array.from({ length: n }, (_, i) => addDays(gridStart, i)) };
}

function step(view: View, anchor: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  if (view === 'list') return addDays(anchor, 30 * dir);
  const d = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1 + dir, 1));
  return d.toISOString().slice(0, 10);
}

const chip: Record<string, string> = {
  scheduled: 'border-l-primary bg-muted text-foreground',
  confirmed: 'border-l-brand bg-brand-soft text-foreground',
  completed: 'border-l-success bg-success/10 text-foreground',
  cancelled: 'border-l-grey bg-muted text-muted-foreground line-through',
  no_show: 'border-l-danger bg-danger/10 text-muted-foreground',
};

function Chip({ a, who }: { a: Appointment; who: (id: string) => string }): React.ReactElement {
  return (
    <Link
      to={`/app/appointments/${a.id}`}
      title={`${a.title} · ${statusLabel(a.status)} · ${who(a.assignedTo)}`}
      className={cn('block truncate rounded border-l-4 px-1.5 py-0.5 text-xs hover:opacity-80', chip[a.status] ?? chip.scheduled)}
    >
      <span className="font-medium tabular-nums">{formatTime(a.startAt)}</span> {a.title}
    </Link>
  );
}

export function AppointmentCalendarPage(): React.ReactElement {
  const today = dayKey(new Date());
  // Phones start on the list view; the month grid needs horizontal room.
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'list' : 'month'));
  const [anchor, setAnchor] = useState(today);
  const [status, setStatus] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const canCreate = useHasPermission('appointments:create');
  const isAdmin = useHasPermission('leads:assign');
  const staff = useStaffDirectory();
  const who = (id: string): string => {
    const u = staff.data?.data.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : '—';
  };

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const q = useAppointments({
    from: startOfDayISO(range.from),
    to: startOfDayISO(range.to),
    status: status || undefined,
    assignedTo: assignedTo || undefined,
    pageSize: '100',
  });

  const byDay = new Map<string, Appointment[]>();
  for (const a of q.data?.data ?? []) {
    const k = dayKey(a.startAt);
    byDay.set(k, [...(byDay.get(k) ?? []), a].sort((x, y) => x.startAt.localeCompare(y.startAt)));
  }
  const total = q.data?.meta.total ?? 0;

  const title =
    view === 'month' ? formatDayLabel(anchor, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${formatDayLabel(range.days[0] as string, { month: 'short', day: 'numeric' })} – ${formatDayLabel(range.days[6] as string, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : view === 'day' ? formatDayLabel(anchor)
    : `Next 30 days from ${formatDayLabel(anchor, { month: 'short', day: 'numeric' })}`;

  const newLink = (day: string): string => `/app/appointments/new?date=${day}`;

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="All times are shown in company time (Central). Appointments conflict-check per assignee."
        actions={
          <>
            <Button asChild variant="outline"><Link to="/app/appointments">Table view</Link></Button>
            {canCreate ? <Button asChild><Link to={newLink(anchor)}>New appointment</Link></Button> : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" aria-label="Previous" onClick={() => setAnchor(step(view, anchor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>Today</Button>
          <Button variant="outline" size="sm" aria-label="Next" onClick={() => setAnchor(step(view, anchor, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <h2 className="mr-auto min-w-40 text-base font-semibold" aria-live="polite">{title}</h2>
        <div role="group" aria-label="Calendar view" className="flex overflow-hidden rounded-md border border-border">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}
              className={cn('px-3 py-1.5 text-sm', view === v.key ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>
              {v.label}
            </button>
          ))}
        </div>
        <SelectFilter label="Status" value={status} onChange={setStatus} options={['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'].map((s) => ({ value: s, label: statusLabel(s) }))} />
        {isAdmin ? <SelectFilter label="Employee" value={assignedTo} onChange={setAssignedTo} options={(staff.data?.data ?? []).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} /> : null}
      </div>

      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message={q.error instanceof ApiError ? q.error.message : 'Failed to load calendar.'} onRetry={() => void q.refetch()} /> : null}
      {total > 100 ? <p className="mb-2 text-xs text-warning">Showing the first 100 of {total} appointments in this range. Narrow the filters.</p> : null}

      {q.data && view === 'month' ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <div className="grid min-w-[640px] grid-cols-7 text-xs">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="border-b border-border bg-muted px-2 py-1.5 font-medium text-muted-foreground">{d}</div>
            ))}
            {range.days.map((day) => {
              const items = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === anchor.slice(0, 7);
              return (
                <div key={day} className={cn('min-h-24 space-y-1 border-b border-r border-border p-1.5', !inMonth && 'bg-muted/50')}>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => { setAnchor(day); setView('day'); }} aria-label={`Open ${formatDayLabel(day)}`}
                      className={cn('flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs', day === today ? 'bg-brand font-semibold text-primary-foreground' : inMonth ? 'text-foreground hover:bg-muted' : 'text-muted-foreground')}>
                      {Number(day.slice(8))}
                    </button>
                    {canCreate ? <Link to={newLink(day)} aria-label={`New appointment on ${formatDayLabel(day)}`} className="text-muted-foreground hover:text-brand"><Plus className="h-3.5 w-3.5" /></Link> : null}
                  </div>
                  {items.slice(0, 3).map((a) => <Chip key={a.id} a={a} who={who} />)}
                  {items.length > 3 ? (
                    <button type="button" className="text-xs text-brand hover:underline" onClick={() => { setAnchor(day); setView('day'); }}>+{items.length - 3} more</button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {q.data && view === 'week' ? (
        <div className="grid gap-2 md:grid-cols-7">
          {range.days.map((day) => {
            const items = byDay.get(day) ?? [];
            return (
              <section key={day} className={cn('min-h-32 rounded-lg border bg-card p-2 shadow-sm', day === today ? 'border-brand' : 'border-border')}>
                <button type="button" className="mb-2 block text-left text-xs font-semibold hover:text-brand" onClick={() => { setAnchor(day); setView('day'); }}>
                  {formatDayLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })}
                </button>
                <div className="space-y-1">
                  {items.map((a) => <Chip key={a.id} a={a} who={who} />)}
                  {items.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {q.data && view === 'day' ? (
        <div className="space-y-2">
          {(byDay.get(anchor) ?? []).map((a) => (
            <Link key={a.id} to={`/app/appointments/${a.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm hover:border-brand">
              <span className="w-32 shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatTime(a.startAt)} – {formatTime(a.endAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{a.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{[statusLabel(a.typeKey), who(a.assignedTo), a.location].filter(Boolean).join(' · ')}</span>
              </span>
              <StatusBadge status={a.status} />
            </Link>
          ))}
          {(byDay.get(anchor) ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Nothing scheduled for this day.{canCreate ? <> <Link to={newLink(anchor)} className="text-brand hover:underline">Add an appointment</Link>.</> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {q.data && view === 'list' ? (
        <div className="space-y-4">
          {[...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => (
            <section key={day}>
              <h3 className="mb-1 text-sm font-semibold">{formatDayLabel(day, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
              <div className="space-y-1">{items.map((a) => <Chip key={a.id} a={a} who={who} />)}</div>
            </section>
          ))}
          {byDay.size === 0 ? <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">No appointments in this period.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
