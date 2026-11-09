import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useImportMutations, useImportStatus, useStormStatus, type ImportRun } from '@/modules/storm/api';
import { ApiError } from '@/types/api';

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-US') : 'Never');
const STATUS_TEXT: Record<string, string> = { running: 'Running', completed: 'Completed', completed_with_errors: 'Finished with errors', failed: 'Failed' };

export function StormImportsPage(): React.ReactElement {
  const q = useImportStatus();
  const status = useStormStatus();
  const mut = useImportMutations();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [years, setYears] = useState({ from: '2009', to: String(new Date().getFullYear()) });
  const [days, setDays] = useState({ from: '', to: '' });
  const busy = Boolean(q.data?.running);
  const fail = (e: unknown): void => setErr(e instanceof ApiError ? e.message : 'The request failed.');
  const ok = (m: string) => (r: { message: string }): void => setMsg(`${m} ${r.message}`);

  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState message="Could not load import status." onRetry={() => void q.refetch()} />;
  const s = q.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Storm data imports" description="Where the hail and wind reports come from, what has been imported, and what has not." />

      <section aria-label="Sources" className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm" data-testid="source-ncei">
          <h2 className="text-base font-semibold">{s.sources.ncei.label}</h2>
          <p>Last successful sync: <strong>{when(s.sources.ncei.lastSuccessfulSync)}</strong></p>
          <p>{s.sources.ncei.events.toLocaleString('en-US')} reports stored{s.sources.ncei.earliestEvent ? `, from ${new Date(s.sources.ncei.earliestEvent).getFullYear()}` : ''}</p>
          <p data-testid="ncei-backfill-state" className={cn('font-medium', s.sources.ncei.backfillComplete ? 'text-success' : 'text-danger')}>
            {s.sources.ncei.backfillComplete ? 'Every year from 2009 is imported.' : `Backfill is NOT complete. Imported: ${s.sources.ncei.yearsImported.length ? s.sources.ncei.yearsImported.join(', ') : 'no years yet'}.`}
          </p>
          {!s.sources.ncei.backfillComplete && s.sources.ncei.yearsMissing.length > 0 ? <p className="text-xs text-muted-foreground">Missing: {s.sources.ncei.yearsMissing.join(', ')}</p> : null}
          {s.sources.ncei.failedUnits.map((u) => <p key={u.unit} className="text-xs text-danger">{u.unit}: {u.status}. {u.error}</p>)}
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm" data-testid="source-spc">
          <h2 className="text-base font-semibold">{s.sources.spc.label}</h2>
          <p>Last successful sync: <strong>{when(s.sources.spc.lastSuccessfulSync)}</strong></p>
          <p>{s.sources.spc.events.toLocaleString('en-US')} reports stored · {s.sources.spc.daysImported} report days imported{s.sources.spc.latestEvent ? ` · latest ${new Date(s.sources.spc.latestEvent).toLocaleDateString('en-US')}` : ''}</p>
          {s.sources.spc.failedUnits.map((u) => <p key={u.unit} className="text-xs text-danger">{u.unit}: {u.status}. {u.error}</p>)}
          <p className="text-xs text-muted-foreground">SPC reports are preliminary. An automatic update runs about every hour while the server is up.</p>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">{s.note} {status.data?.mrms.note}</p>

      {s.running ? <p role="status" className="rounded-md border border-info/30 bg-card p-3 text-sm">An import is running: {s.running.current || 'starting'} ({s.running.unitsDone} of {s.running.unitsTotal} units done). This page refreshes by itself.</p> : null}
      {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
      {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}

      <section aria-label="Start an import" className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">Start an import</h2>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <span className="font-medium">Historical backfill (NCEI):</span>
          <label className="text-xs text-muted-foreground">From year<Input aria-label="Backfill from year" type="number" min={2009} className="mt-1 h-9 w-24" value={years.from} onChange={(e) => setYears({ ...years, from: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground">To year<Input aria-label="Backfill to year" type="number" min={2009} className="mt-1 h-9 w-24" value={years.to} onChange={(e) => setYears({ ...years, to: e.target.value })} /></label>
          <Button type="button" disabled={busy || mut.backfill.isPending} onClick={() => { setErr(null); setMsg(null); void mut.backfill.mutateAsync({ fromYear: Number(years.from), toYear: Number(years.to) }).then(ok('Backfill started.')).catch(fail); }}>Run backfill</Button>
          <span className="text-xs text-muted-foreground">Years already imported are skipped, so this resumes where it stopped.</span>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <span className="font-medium">SPC date range:</span>
          <label className="text-xs text-muted-foreground">From<Input aria-label="SPC from" type="date" className="mt-1 h-9" value={days.from} onChange={(e) => setDays({ ...days, from: e.target.value })} /></label>
          <label className="text-xs text-muted-foreground">To<Input aria-label="SPC to" type="date" className="mt-1 h-9" value={days.to} onChange={(e) => setDays({ ...days, to: e.target.value })} /></label>
          <Button type="button" variant="outline" disabled={busy || !days.from || !days.to || mut.spc.isPending} onClick={() => { setErr(null); setMsg(null); void mut.spc.mutateAsync({ from: days.from, to: days.to }).then(ok('SPC import started.')).catch(fail); }}>Import range</Button>
          <Button type="button" variant="outline" disabled={busy || mut.daily.isPending} onClick={() => { setErr(null); setMsg(null); void mut.daily.mutateAsync().then(ok('Daily sync started.')).catch(fail); }}>Sync recent days now</Button>
        </div>
      </section>

      <section aria-label="Import history" className="space-y-2">
        <h2 className="text-base font-semibold">Recent imports</h2>
        {s.runs.length === 0 ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No imports have run yet. Start the historical backfill above to load NOAA data.</p> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[56rem] text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Started</th><th>Source</th><th>Range</th><th>Status</th><th className="text-right">Units</th><th className="text-right">Processed</th><th className="text-right">Inserted</th><th className="text-right">Updated</th><th className="text-right">Skipped</th><th>Errors</th></tr></thead>
              <tbody>{s.runs.map((r: ImportRun) => (
                <tr key={r.id} className="border-b border-border/60 align-top">
                  <td className="p-2 whitespace-nowrap">{when(r.startedAt)}</td><td className="uppercase">{r.source}</td><td>{r.rangeFrom ? `${r.rangeFrom}${r.rangeTo && r.rangeTo !== r.rangeFrom ? ` to ${r.rangeTo}` : ''}` : 'Recent days'}</td>
                  <td className={cn('font-medium', r.status === 'completed' ? 'text-success' : r.status === 'running' ? '' : 'text-danger')}>{STATUS_TEXT[r.status] ?? r.status}</td>
                  <td className="text-right tabular-nums">{r.unitsDone}/{r.unitsTotal}{r.unitsFailed ? ` (${r.unitsFailed} failed)` : ''}{r.unitsUnavailable ? ` (${r.unitsUnavailable} not published)` : ''}</td>
                  <td className="text-right tabular-nums">{r.counts.rows.toLocaleString('en-US')}</td><td className="text-right tabular-nums">{r.counts.inserted.toLocaleString('en-US')}</td>
                  <td className="text-right tabular-nums">{r.counts.updated.toLocaleString('en-US')}</td><td className="text-right tabular-nums">{r.counts.skipped.toLocaleString('en-US')}</td>
                  <td className="max-w-[20rem] text-xs text-danger">{r.errors.map((e) => `${e.unit}: ${e.message}`).join(' | ') || ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
