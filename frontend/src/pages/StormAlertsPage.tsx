import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { useAlertHistory, useAlertRules, useFlagMutations, useFlags, useRuleMutations, useStormStatus, useZones, type AlertRule, type Flag } from '@/modules/storm/api';
import { Disclaimer, EventLink } from '@/modules/storm/components';
import { fmtDate } from '@/modules/storm/format';
import { ApiError } from '@/types/api';

export function StormAlertsPage(): React.ReactElement {
  const canManage = useHasPermission('stormAlerts:manage');
  const canScan = useHasPermission('stormZones:manage');
  const status = useStormStatus();
  const rules = useAlertRules(canManage);
  const zones = useZones();
  const [page, setPage] = useState(1);
  const history = useAlertHistory(page);
  const mut = useRuleMutations();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', zoneId: '', radiusMiles: '0', hail: '1', wind: '50', notifyAssignee: true, notifyAdmins: false, email: false, sms: false });

  async function create(): Promise<void> {
    setErr(null); setMsg(null);
    try {
      await mut.create.mutateAsync({ name: form.name.trim(), zoneId: form.zoneId, radiusMiles: Number(form.radiusMiles), hailMinInches: Number(form.hail), windMinMph: Number(form.wind), notifyAssignee: form.notifyAssignee, notifyAdmins: form.notifyAdmins, channels: { inApp: true, email: form.email, sms: form.sms } });
      setMsg('Alert rule created.');
      setForm({ ...form, name: '' });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not create the rule.'); }
  }
  const toggle = (r: AlertRule, patch: Record<string, unknown>): void => { setErr(null); void mut.update.mutateAsync({ id: r.id, body: patch }).catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not update the rule.')); };

  return (
    <div className="space-y-6">
      <PageHeader title="Storm alerts" description="Be told when a qualifying hail (1.00 inch or larger) or wind (over 50 mph) report lands in a territory." />

      <section aria-label="Delivery channels" className="rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="text-base font-semibold">How alerts are delivered</h2>
        <ul className="mt-2 space-y-1">
          <li><strong>In the app:</strong> {status.data?.alertChannels.inApp ?? '…'}</li>
          <li><strong>Email:</strong> {status.data?.alertChannels.email ?? '…'}</li>
          <li><strong>Text message:</strong> {status.data?.alertChannels.sms ?? '…'}</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Ticking Email or Text on a rule records the attempt, and the history below shows the real result for each person. Nothing is reported as sent unless it was.</p>
      </section>

      {canManage ? (
        <section aria-label="Alert rules" className="space-y-3">
          <h2 className="text-base font-semibold">Alert rules</h2>
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-muted-foreground">Rule name<Input aria-label="Rule name" className="mt-1 h-9" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. North Dallas hail" /></label>
              <label className="text-xs text-muted-foreground">Territory (zone)
                <select aria-label="Territory" className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={form.zoneId} onChange={(e) => setForm({ ...form, zoneId: e.target.value })}>
                  <option value="">Choose a zone</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
              <label className="text-xs text-muted-foreground">Also alert within (miles of the zone)<Input aria-label="Event radius" type="number" min={0} max={50} className="mt-1 h-9" value={form.radiusMiles} onChange={(e) => setForm({ ...form, radiusMiles: e.target.value })} /></label>
              <div className="flex gap-2">
                <label className="text-xs text-muted-foreground">Hail ≥ (in)<Input aria-label="Hail threshold" type="number" min={1} step={0.25} className="mt-1 h-9" value={form.hail} onChange={(e) => setForm({ ...form, hail: e.target.value })} /></label>
                <label className="text-xs text-muted-foreground">Wind &gt; (mph)<Input aria-label="Wind threshold" type="number" min={50} className="mt-1 h-9" value={form.wind} onChange={(e) => setForm({ ...form, wind: e.target.value })} /></label>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.notifyAssignee} onChange={(e) => setForm({ ...form, notifyAssignee: e.target.checked })} /> Zone representative</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.notifyAdmins} onChange={(e) => setForm({ ...form, notifyAdmins: e.target.checked })} /> Administrators</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked disabled /> In app</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} /> Email</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.sms} onChange={(e) => setForm({ ...form, sms: e.target.checked })} /> Text</label>
              <Button type="button" disabled={form.name.trim().length < 2 || !form.zoneId || mut.create.isPending} onClick={() => void create()}>Add rule</Button>
            </div>
            {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
            {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}
          </div>
          {rules.isLoading ? <LoadingState /> : (rules.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No rules yet. Create a zone first, then add a rule for it.</p> : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[44rem] text-sm">
                <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Rule</th><th>Zone</th><th>Hail ≥</th><th>Wind &gt;</th><th>Extra radius</th><th>Notifies</th><th>Channels</th><th>On</th><th /></tr></thead>
                <tbody>{rules.data?.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="p-2 font-medium">{r.name}</td><td>{r.zoneName}</td><td>{r.hailMinInches.toFixed(2)} in</td><td>{r.windMinMph} mph</td><td>{r.radiusMiles} mi</td>
                    <td>{[r.notifyAssignee ? 'Representative' : '', r.notifyAdmins ? 'Admins' : ''].filter(Boolean).join(', ') || '—'}</td>
                    <td>{['In app', r.channels.email ? 'Email' : '', r.channels.sms ? 'Text' : ''].filter(Boolean).join(', ')}</td>
                    <td><input type="checkbox" aria-label={`Rule ${r.name} enabled`} checked={r.enabled} onChange={(e) => toggle(r, { enabled: e.target.checked })} /></td>
                    <td className="pr-2 text-right"><Button type="button" size="sm" variant="outline" onClick={() => { if (window.confirm(`Delete rule "${r.name}"?`)) void mut.remove.mutateAsync(r.id); }}>Delete</Button></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section aria-label="Alert history" className="space-y-2">
        <h2 className="text-base font-semibold">Alert history</h2>
        {history.isLoading ? <LoadingState /> : history.isError ? <ErrorState message="Could not load the alert history." /> : (history.data?.data.length ?? 0) === 0 ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No alerts yet.</p> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[48rem] text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">When</th><th>Rule / zone</th><th>Report</th><th>Sent to</th><th>Delivery</th></tr></thead>
              <tbody>{history.data?.data.map((a) => (
                <tr key={a.id} className="border-b border-border/60 align-top">
                  <td className="p-2 whitespace-nowrap">{new Date(a.at).toLocaleString('en-US')}</td>
                  <td>{a.ruleName}<span className="block text-xs text-muted-foreground">{a.zoneName}</span></td>
                  <td className="max-w-[22rem]"><EventLink id={a.eventId}>{a.message}</EventLink></td>
                  <td>{a.recipients.join(', ') || '—'}</td>
                  <td className="text-xs">{deliverySummary(a.channelResults)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        {history.data ? <Pagination page={page} pageSize={15} total={history.data.meta.total} onPage={setPage} /> : null}
      </section>

      <FollowUps canScan={canScan} />
    </div>
  );
}

function deliverySummary(cr: unknown): string {
  if (!cr || typeof cr !== 'object') return '—';
  const out: string[] = [];
  for (const [ch, v] of Object.entries(cr as Record<string, unknown>)) {
    if (v === 'off') continue;
    if (v && typeof v === 'object') {
      const counts = new Map<string, number>();
      for (const s of Object.values(v as Record<string, string>)) counts.set(s, (counts.get(s) ?? 0) + 1);
      out.push(`${ch === 'inApp' ? 'In app' : ch === 'sms' ? 'Text' : 'Email'}: ${[...counts].map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`).join(', ')}`);
    }
  }
  return out.join(' · ') || '—';
}

function FollowUps({ canScan }: { canScan: boolean }): React.ReactElement {
  const [status, setStatus] = useState('new');
  const [page, setPage] = useState(1);
  const flags = useFlags(status, page);
  const mut = useFlagMutations();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fail = (e: unknown): void => setErr(e instanceof ApiError ? e.message : 'That did not work.');
  async function act(f: Flag, kind: 'task' | 'call' | 'note' | 'review' | 'dismiss'): Promise<void> {
    setErr(null); setMsg(null);
    const inDays = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();
    try {
      if (kind === 'review') await mut.review.mutateAsync({ id: f.id });
      else if (kind === 'dismiss') { if (!window.confirm('Dismiss this flag? It will not come back for this storm.')) return; await mut.dismiss.mutateAsync({ id: f.id }); }
      else if (kind === 'task') await mut.activity.mutateAsync({ id: f.id, type: 'follow_up', dueAt: inDays(2) });
      else if (kind === 'call') await mut.activity.mutateAsync({ id: f.id, type: 'call', dueAt: inDays(1) });
      else { const body = window.prompt('Note for the customer record'); if (!body) return; await mut.activity.mutateAsync({ id: f.id, type: 'note', body }); }
      setMsg(kind === 'task' ? 'Follow-up task created (due in 2 days).' : kind === 'call' ? 'Call reminder created (due tomorrow).' : kind === 'note' ? 'Note added to the customer.' : kind === 'review' ? 'Marked reviewed.' : 'Dismissed.');
    } catch (e) { fail(e); }
  }
  return (
    <section aria-label="Past customer follow-ups" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Past customers near recent storms</h2>
        <div className="flex items-center gap-2">
          <select aria-label="Flag status" className="h-9 rounded-md border border-border bg-card px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="new">To review</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option><option value="">All</option></select>
          {canScan ? <Button type="button" size="sm" variant="outline" disabled={mut.scan.isPending} onClick={() => { setErr(null); void mut.scan.mutateAsync(3).then((r) => setMsg(`Scan done: ${r.flagsCreated} new flag(s), ${r.existingFlags} already known. ${r.projectsWithoutLocation} completed job(s) have no saved location and ${r.projectsWithoutCompletionDate} have no completion date, so they were skipped.`)).catch(fail); }}>Scan completed jobs</Button> : null}
        </div>
      </div>
      <Disclaimer text="Nearby storm activity detected after completed roof work: follow-up may be appropriate. A report near a job is a reason to check in, not proof of damage." />
      {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
      {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}
      {flags.isLoading ? <LoadingState /> : (flags.data?.data.length ?? 0) === 0 ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing to follow up on.</p> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[52rem] text-sm">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Customer</th><th>Property</th><th>Job completed</th><th>Storm report</th><th className="text-right">Distance</th><th>Status</th><th /></tr></thead>
            <tbody>{flags.data?.data.map((f) => (
              <tr key={f.id} className="border-b border-border/60 align-top">
                <td className="p-2"><Link className="font-medium text-brand hover:underline" to={`/app/customers/${f.customer.id}`}>{f.customer.name}</Link></td>
                <td>{f.property?.address ?? '—'}</td><td>{fmtDate(f.completedAt)}</td>
                <td><EventLink id={f.event.id}>{f.event.label}</EventLink><span className="block text-xs text-muted-foreground">{fmtDate(f.event.date)}</span></td>
                <td className="text-right tabular-nums">{f.distanceMiles.toFixed(1)} mi</td>
                <td className="capitalize">{f.status}</td>
                <td className="space-x-1 whitespace-nowrap pr-2 text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => void act(f, 'task')}>Task</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void act(f, 'call')}>Call reminder</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void act(f, 'note')}>Note</Button>
                  {f.status === 'new' ? <Button type="button" size="sm" variant="outline" onClick={() => void act(f, 'review')}>Reviewed</Button> : null}
                  {f.status !== 'dismissed' ? <Button type="button" size="sm" variant="ghost" onClick={() => void act(f, 'dismiss')}>Dismiss</Button> : null}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {flags.data ? <Pagination page={page} pageSize={10} total={flags.data.meta.total} onPage={setPage} /> : null}
    </section>
  );
}
