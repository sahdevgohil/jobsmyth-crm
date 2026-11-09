import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Pagination } from '@/components/shared/Pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import { useHasPermission } from '@/lib/permissions';
import {
  STAGES, useFilterOptions, useJobHistory, usePipelineJobs, usePipelineMutations, usePipelineSummary,
  type Filters, type JobView, type Stage,
} from '@/modules/pipeline/api';
import { ApiError } from '@/types/api';

const STAGE_STYLE: Record<Stage, { color: string; blurb: string; dateLabel: string }> = {
  estimates_out: { color: '#2f6fb0', blurb: 'Sent to the customer, not yet accepted or denied', dateLabel: 'Sent' },
  estimates_accepted: { color: '#16845b', blurb: 'Signed or approved, work not started', dateLabel: 'Accepted' },
  jobs_started: { color: '#d99026', blurb: 'Work in progress', dateLabel: 'Started' },
  jobs_completed: { color: '#7a4fb3', blurb: 'Work finished, not yet invoiced', dateLabel: 'Completed' },
  invoiced: { color: '#c32930', blurb: 'Outstanding balance on issued invoices', dateLabel: 'Invoiced' },
  invoices_completed: { color: '#6b7280', blurb: 'Paid in full, left the active pipeline', dateLabel: 'Paid' },
};
const DENIED_COLOR = '#3c3c3c';

const day = (iso: string | null): string => (iso ? formatDateTime(iso).split(',').slice(0, 2).join(',') : '—');
const label = (s: string): string => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function jobLink(j: JobView): string {
  return j.projectId ? `/app/projects/${j.projectId}` : j.estimateId ? `/app/estimates/${j.estimateId}` : `/app/customers/${j.customer.id}`;
}

export function PipelineDashboardPage(): React.ReactElement {
  const [filters, setFilters] = useState<Filters>({});
  const [selected, setSelected] = useState<Stage | 'denied'>('estimates_out');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'stageDate', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const summary = usePipelineSummary(filters);
  const jobs = usePipelineJobs({ ...filters, stage: selected, search, sort: sort.key, dir: sort.dir, page, pageSize: 10 }, true);
  const options = useFilterOptions();
  const canManage = useHasPermission('pipeline:manage');
  const mut = usePipelineMutations();
  const [note, setNote] = useState<string | null>(null);

  if (summary.isLoading) return <LoadingState />;
  if (summary.isError || !summary.data) return <ErrorState message="Could not load the pipeline." onRetry={() => void summary.refetch()} />;
  const s = summary.data;
  const set = (patch: Partial<Filters>): void => { setFilters({ ...filters, ...patch }); setPage(1); };
  const pick = (st: Stage | 'denied'): void => { setSelected(st); setPage(1); setOpen(null); };
  const activeStages = s.stages.filter((x) => x.active);
  const sortBy = (key: string): void => { setSort((cur) => ({ key, dir: cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc' })); setPage(1); };
  const arrow = (key: string): string => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const stageInfo = selected === 'denied' ? null : STAGE_STYLE[selected];
  const heading = selected === 'denied' ? 'Denied estimates' : s.stages.find((x) => x.stage === selected)?.label ?? '';
  const invoicedStage = selected === 'invoiced';
  const completedStage = selected === 'invoices_completed';

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Legacy Construction Group — Pipeline Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every job sits in exactly one stage. When a job moves forward, its dollar amount moves with it.</p>
      </header>

      <section aria-label="Filters" className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <label className="text-xs text-muted-foreground">Stage entered from<Input type="date" className="mt-1 h-9" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></label>
        <label className="text-xs text-muted-foreground">Stage entered to<Input type="date" className="mt-1 h-9" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></label>
        <label className="text-xs text-muted-foreground">Salesperson
          <select className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={filters.salespersonId ?? ''} onChange={(e) => set({ salespersonId: e.target.value || undefined })}>
            <option value="">All</option>{options.data?.salespeople.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></label>
        <label className="text-xs text-muted-foreground">Project manager
          <select className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={filters.projectManagerId ?? ''} onChange={(e) => set({ projectManagerId: e.target.value || undefined })}>
            <option value="">All</option>{options.data?.projectManagers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></label>
        <label className="text-xs text-muted-foreground">Job type
          <select className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={filters.jobType ?? ''} onChange={(e) => set({ jobType: e.target.value || undefined })}>
            <option value="">All</option>{options.data?.jobTypes.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select></label>
        <label className="text-xs text-muted-foreground">Payment status
          <select className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={filters.paymentStatus ?? ''} onChange={(e) => set({ paymentStatus: e.target.value || undefined })}>
            <option value="">All</option>{['none', 'unpaid', 'partial', 'overdue', 'paid'].map((p) => <option key={p} value={p}>{p === 'none' ? 'Not invoiced' : label(p)}</option>)}
          </select></label>
        <label className="text-xs text-muted-foreground">View as of
          <Input type="date" className="mt-1 h-9" value={filters.asOf ?? ''} onChange={(e) => set({ asOf: e.target.value || undefined })} /></label>
      </section>
      {s.asOf ? <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Showing the pipeline as it stood on {new Date(s.asOf).toLocaleDateString('en-US')}. {s.limitations.join(' ')}</p> : null}
      {!s.asOf && s.limitations.length > 0 ? <p className="text-xs text-muted-foreground">{s.limitations.join(' ')}</p> : null}

      <section aria-label="Total pipeline" className="rounded-xl bg-primary p-5 text-primary-foreground">
        <p className="text-xs uppercase tracking-wide opacity-70">Total active pipeline</p>
        <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-1">
          <p data-testid="total-pipeline" className="text-3xl font-semibold tabular-nums">{formatCents(s.totalActiveCents)}</p>
          <p className="pb-1 text-sm opacity-80" data-testid="active-jobs">{s.activeJobCount} active job{s.activeJobCount === 1 ? '' : 's'}</p>
        </div>
        <p className="mt-2 max-w-4xl text-xs opacity-70">{s.calculation}</p>
      </section>

      <section aria-label="Pipeline stages" className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="grid min-w-[62rem] grid-cols-6 gap-3">
          {s.stages.map((st, i) => {
            const style = STAGE_STYLE[st.stage];
            const on = selected === st.stage;
            return (
              <button
                key={st.stage}
                type="button"
                data-testid={`stage-${st.stage}`}
                aria-pressed={on}
                aria-label={`${st.label}: ${formatCents(st.valueCents)}, ${st.jobCount} job${st.jobCount === 1 ? '' : 's'}`}
                onClick={() => pick(st.stage)}
                className={cn('rounded-xl border bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', on ? 'ring-2 ring-offset-1' : '')}
                style={{ borderTop: `4px solid ${style.color}`, ...(on ? { ['--tw-ring-color' as string]: style.color } : {}) }}
              >
                <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: style.color }}>Stage {i + 1}</p>
                <p className="mt-0.5 text-sm font-semibold leading-tight">{st.label}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums">{formatCents(st.valueCents)}</p>
                <p className="text-xs font-medium">{st.jobCount} job{st.jobCount === 1 ? '' : 's'}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{style.blurb}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Where the active pipeline sits" className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Active pipeline by stage</h2>
          <p className="text-xs text-muted-foreground">Share of the total active pipeline value (stages 1 to 5). Paid-in-full jobs are not included.</p>
        </div>
        {s.totalActiveCents === 0 ? <p className="mt-3 text-sm text-muted-foreground">No active pipeline value for these filters.</p> : (
          <>
            <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-muted" role="img" aria-label={activeStages.map((x) => `${x.label} ${x.percentOfActive ?? 0}%`).join(', ')}>
              {activeStages.map((x) => <div key={x.stage} style={{ width: `${x.percentOfActive ?? 0}%`, background: STAGE_STYLE[x.stage].color }} title={`${x.label}: ${x.percentOfActive ?? 0}%`} />)}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {activeStages.map((x) => <li key={x.stage} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STAGE_STYLE[x.stage].color }} />{x.label} <span className="tabular-nums text-muted-foreground">{x.percentOfActive ?? 0}%</span></li>)}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Denied estimates" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div>
          <p className="text-sm font-semibold">Denied estimates</p>
          <p className="text-xs text-muted-foreground">Kept for history. Not part of any active total.</p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-sm" data-testid="denied-summary"><span className="font-semibold tabular-nums">{s.denied.jobCount}</span> denied · <span className="font-semibold tabular-nums">{formatCents(s.denied.valueCents)}</span></p>
          <Button type="button" size="sm" variant={selected === 'denied' ? 'default' : 'outline'} data-testid="stage-denied" onClick={() => pick('denied')}>View denied</Button>
        </div>
      </section>

      <section aria-label={`${heading} jobs`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold" style={{ color: selected === 'denied' ? DENIED_COLOR : stageInfo?.color }}>{heading}</h2>
          <Input aria-label="Search jobs" placeholder="Search customer, address or job" className="h-9 w-full sm:w-72" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {jobs.isLoading ? <LoadingState /> : jobs.isError ? <ErrorState message="Could not load these jobs." onRetry={() => void jobs.refetch()} /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="p-2"><button type="button" onClick={() => sortBy('customer')}>Customer{arrow('customer')}</button></th>
                  <th>Property</th><th>Job type</th>
                  <th><button type="button" onClick={() => sortBy('stageDate')}>{selected === 'denied' ? 'Denied' : stageInfo?.dateLabel}{arrow('stageDate')}</button></th>
                  {selected === 'denied' ? <th>Reason</th> : null}
                  <th className="text-right"><button type="button" onClick={() => sortBy('value')}>{invoicedStage ? 'Contract' : 'Amount'}{arrow('value')}</button></th>
                  {invoicedStage || completedStage ? <><th className="text-right">Invoiced</th><th className="text-right"><button type="button" onClick={() => sortBy('paid')}>Paid{arrow('paid')}</button></th></> : null}
                  {invoicedStage ? <><th className="text-right"><button type="button" onClick={() => sortBy('outstanding')}>Balance due{arrow('outstanding')}</button></th><th>Due</th></> : null}
                  <th>Salesperson</th><th>Project manager</th><th />
                </tr>
              </thead>
              <tbody>
                {jobs.data?.data.length === 0 ? <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">No jobs in this view.</td></tr> : null}
                {jobs.data?.data.map((j) => (
                  <JobRows key={j.id} j={j} stage={selected} invoiced={invoicedStage} completed={completedStage} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} canManage={canManage} mut={mut} setNote={setNote} />
                ))}
              </tbody>
              {jobs.data && jobs.data.data.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/50 font-semibold" data-testid="stage-total">
                    <td className="p-2" colSpan={selected === 'denied' ? 5 : 4}>{heading} total · {jobs.data.totals.jobCount} job{jobs.data.totals.jobCount === 1 ? '' : 's'}</td>
                    <td className="text-right tabular-nums">{formatCents(jobs.data.totals.valueCents)}</td>
                    {invoicedStage || completedStage ? <><td className="text-right tabular-nums">{formatCents(jobs.data.totals.invoicedCents)}</td><td className="text-right tabular-nums">{formatCents(jobs.data.totals.paidCents)}</td></> : null}
                    {invoicedStage ? <><td className="text-right tabular-nums">{formatCents(jobs.data.totals.outstandingCents)}</td><td /></> : null}
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
        {jobs.data ? <Pagination page={page} pageSize={10} total={jobs.data.meta.total} onPage={setPage} /> : null}
        {note ? <p role="status" className="text-sm text-success">{note}</p> : null}
        {canManage ? <BackfillControl mut={mut} /> : null}
      </section>
    </div>
  );
}

function JobRows({ j, stage, invoiced, completed, open, onToggle, canManage, mut, setNote }: { j: JobView; stage: Stage | 'denied'; invoiced: boolean; completed: boolean; open: boolean; onToggle: () => void; canManage: boolean; mut: ReturnType<typeof usePipelineMutations>; setNote: (s: string | null) => void }): React.ReactElement {
  const date = stage === 'denied' ? j.denial?.at ?? j.stageDate : j.stageDate;
  return (
    <>
      <tr className="border-b border-border/60 align-top">
        <td className="p-2"><Link className="font-medium text-brand hover:underline" to={jobLink(j)}>{j.customer.name}</Link><span className="block text-xs text-muted-foreground">{j.number}</span></td>
        <td className="max-w-[16rem]">{j.property ? j.property.address : '—'}</td>
        <td>{j.jobType ? label(j.jobType) : '—'}</td>
        <td>{day(date)}{j.approximateHistory ? <span className="block text-[10px] text-muted-foreground">approximate</span> : null}</td>
        {stage === 'denied' ? <td className="max-w-[14rem] text-xs">{j.denial?.reason}{j.denial?.note ? <span className="block text-muted-foreground">{j.denial.note}</span> : null}</td> : null}
        <td className="text-right tabular-nums">{formatCents(invoiced || completed ? j.contractCents : stage === 'estimates_out' || stage === 'denied' ? j.estimateCents : j.contractCents)}</td>
        {invoiced || completed ? <><td className="text-right tabular-nums">{formatCents(j.invoicedCents)}</td><td className="text-right tabular-nums">{formatCents(j.paidCents)}</td></> : null}
        {invoiced ? <>
          <td className="text-right font-medium tabular-nums">{formatCents(j.outstandingCents)}</td>
          <td>{j.dueDate ? day(j.dueDate) : '—'}{j.overdue ? <span className="ml-1 rounded bg-danger/15 px-1 text-xs font-medium text-danger">Overdue {formatCents(j.overdueCents)}</span> : null}</td>
        </> : null}
        <td>{j.salesperson?.name ?? '—'}</td>
        <td>{j.projectManager?.name ?? '—'}</td>
        <td className="pr-2 text-right"><Button type="button" variant="ghost" size="sm" aria-expanded={open} onClick={onToggle}>{open ? 'Hide' : 'History'}</Button></td>
      </tr>
      {open ? <tr className="border-b border-border/60 bg-muted/30"><td colSpan={12} className="p-3"><History id={j.id} stage={j.stage} canManage={canManage} mut={mut} setNote={setNote} /></td></tr> : null}
    </>
  );
}

function History({ id, stage, canManage, mut, setNote }: { id: string; stage: Stage | null; canManage: boolean; mut: ReturnType<typeof usePipelineMutations>; setNote: (s: string | null) => void }): React.ReactElement {
  const q = useJobHistory(id);
  const [to, setTo] = useState<Stage>(stage ?? 'estimates_out');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [co, setCo] = useState({ description: '', amount: '' });
  if (q.isLoading) return <LoadingState />;
  if (!q.data) return <ErrorState message="Could not load the history." />;
  async function move(): Promise<void> {
    setErr(null);
    try { await mut.move.mutateAsync({ id, toStage: to, reason }); setNote('Stage changed. The change is recorded in the history.'); setReason(''); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not move the job.'); }
  }
  async function addCo(): Promise<void> {
    setErr(null);
    const cents = Math.round(Number(co.amount.replace(/[$,\s]/g, '')) * 100);
    if (!co.description.trim() || !Number.isFinite(cents) || cents === 0) { setErr('Enter a description and a non-zero amount (use a minus sign for a credit).'); return; }
    try { await mut.changeOrder.mutateAsync({ id, description: co.description.trim(), amountCents: cents }); setNote('Change order added to the contract.'); setCo({ description: '', amount: '' }); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not add the change order.'); }
  }
  return (
    <div className="space-y-3 text-sm">
      <ol className="space-y-1">
        {q.data.history.map((h, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="tabular-nums text-muted-foreground">{formatDateTime(h.at)}</span>
            <span>{h.from === 'none' ? 'Entered' : label(h.from)} → <strong>{label(h.to)}</strong></span>
            <span className="text-muted-foreground">by {h.by}{h.auto ? ' (automatic)' : ''}{h.reason ? ` — ${h.reason}` : ''}</span>
            {h.exception ? <span className="rounded bg-warning/20 px-1 text-xs">exception</span> : null}
            {h.approximate ? <span className="rounded bg-muted px-1 text-xs">approximate date</span> : null}
          </li>
        ))}
      </ol>
      {q.data.changeOrders.length > 0 ? <p className="text-xs text-muted-foreground">Change orders: {q.data.changeOrders.map((c) => `${c.description} (${formatCents(c.amountCents)})`).join('; ')}</p> : null}
      {canManage && stage ? (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">Move to
              <select aria-label="Move to stage" className="mt-1 block h-9 rounded-md border border-border bg-card px-2 text-sm" value={to} onChange={(e) => setTo(e.target.value as Stage)}>{STAGES.map((st) => <option key={st} value={st}>{label(st)}</option>)}</select></label>
            <label className="grow text-xs text-muted-foreground">Reason (required for jumps, moves back and unsupported stages)
              <Input aria-label="Reason for the move" className="mt-1 h-9" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <Button type="button" size="sm" disabled={mut.move.isPending} onClick={() => void move()}>Move job</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grow text-xs text-muted-foreground">Change order<Input aria-label="Change order description" className="mt-1 h-9" placeholder="Description" value={co.description} onChange={(e) => setCo({ ...co, description: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Amount ($)<Input aria-label="Change order amount" className="mt-1 h-9 w-32" value={co.amount} onChange={(e) => setCo({ ...co, amount: e.target.value })} /></label>
            <Button type="button" size="sm" variant="outline" disabled={mut.changeOrder.isPending} onClick={() => void addCo()}>Add change order</Button>
          </div>
          {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function BackfillControl({ mut }: { mut: ReturnType<typeof usePipelineMutations> }): React.ReactElement {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm">
      <span className="text-muted-foreground">Jobs that existed before the pipeline was introduced are added by a one-time import. Their stage dates are approximate.</span>
      <Button type="button" size="sm" variant="outline" disabled={mut.backfill.isPending} onClick={() => void mut.backfill.mutateAsync().then((r) => setMsg(`Imported: ${r.jobs} jobs in total.`)).catch(() => setMsg('The import failed. Try again.'))}>Import existing jobs</Button>
      {msg ? <span role="status">{msg}</span> : null}
    </div>
  );
}
