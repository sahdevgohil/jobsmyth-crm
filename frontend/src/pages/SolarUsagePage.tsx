import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MaterialCatalog } from '@/modules/measurements/MaterialCatalog';
import { useSolarMutations, useSolarSettings, useSolarUsage, type SolarSettings } from '@/modules/measurements/solarApi';
import { ApiError } from '@/types/api';

const KIND_LABEL: Record<string, string> = { building_insights: 'Building Insights (roof data)', data_layers: 'Data Layers (imagery)', geocode: 'Geocoding (address lookup)' };
const STATE_LABEL: Record<string, string> = {
  not_configured: 'Not configured', disabled: 'Turned off', configuration_required: 'Configuration required', connected: 'Connected', connection_failed: 'Connection failed', quota_exceeded: 'Quota exceeded',
};

export function SolarUsagePage(): React.ReactElement {
  const usage = useSolarUsage();
  const settings = useSolarSettings();
  const mut = useSolarMutations();
  const [form, setForm] = useState<SolarSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; fix?: string | null; http?: number | null } | null>(null);
  useEffect(() => { if (settings.data) setForm({ ...settings.data, pricePer1000Cents: settings.data.pricePer1000Cents ?? {} }); }, [settings.data]);

  if (usage.isLoading || settings.isLoading || !form) return settings.isError || usage.isError ? <ErrorState message="Could not load measurement settings." /> : <LoadingState />;
  const u = usage.data!;
  const state = form.integration.state;

  async function save(): Promise<void> {
    setMsg(null);
    try {
      await mut.saveSettings.mutateAsync({
        enabled: form!.enabled, preferredQuality: form!.preferredQuality, allowBaseFallback: form!.allowBaseFallback,
        dailyLimit: form!.dailyLimit, monthlyFree: form!.monthlyFree, warnPercent: form!.warnPercent, allowOverage: form!.allowOverage, includeImagery: form!.includeImagery, imageryRetentionDays: form!.imageryRetentionDays, recommendedPitchedWaste: form!.recommendedPitchedWaste, recommendedFlatWaste: form!.recommendedFlatWaste,
        pricePer1000Cents: Object.fromEntries(Object.entries(form!.pricePer1000Cents).filter(([, v]) => typeof v === 'number')), cacheDays: form!.cacheDays, rawRetentionDays: form!.rawRetentionDays,
      });
      setMsg({ ok: true, text: 'Settings saved.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not save.' });
    }
  }
  async function test(): Promise<void> {
    setMsg(null);
    try {
      const r = await mut.testConnection.mutateAsync();
      setMsg({ ok: r.ok, text: r.message, fix: r.fix, http: r.httpStatus });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Test failed.' });
    }
  }
  const num = (obj: Record<string, number | undefined>, k: string, set: (v: Record<string, number>) => void) => (
    <Input type="number" min={0} className="h-9 w-28" value={obj[k] ?? ''} onChange={(e) => set({ ...(obj as Record<string, number>), [k]: Number(e.target.value) })} />
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Measurement integration" description="Google Solar API connection, usage and limits. Administrators only." />

      <section aria-label="Connection" className="space-y-2 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Google Solar API</h2>
          <StatusBadge status={state === 'connected' ? 'confirmed' : state === 'connection_failed' || state === 'quota_exceeded' ? 'failed' : 'pending'} />
          <span className="text-sm" data-testid="solar-state">{mut.testConnection.isPending ? 'Testing…' : STATE_LABEL[state]}</span>
          <Button type="button" variant="outline" size="sm" disabled={!form.integration.keyConfigured || mut.testConnection.isPending} onClick={() => void test()}>{mut.testConnection.isPending ? 'Testing…' : 'Test connection'}</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {form.integration.keyConfigured ? 'An API key is configured on the server (it is never shown here).' : 'No API key is configured. Set GOOGLE_SOLAR_API_KEY in the backend environment, restart the server, then test the connection. See docs/GOOGLE_SOLAR_SETUP.md.'}
        </p>
        {form.integration.stale ? <p className="text-xs text-warning">The API key changed since the last test, so the earlier result no longer applies. Press Test connection.</p> : null}
        {form.integration.lastTest ? <p className="text-xs text-muted-foreground">Last test {new Date(form.integration.lastTest.at).toLocaleString('en-US')}{form.integration.lastTest.httpStatus ? ` (HTTP ${form.integration.lastTest.httpStatus})` : ''}: {form.integration.lastTest.message}{form.integration.lastTest.fix ? ` To fix: ${form.integration.lastTest.fix}` : ''}</p> : null}
        <p className="text-xs text-muted-foreground">“Connected” is only shown after Google answered a real request. A test sends one Building Insights request for Google's sample location and saves no measurement.</p>
        {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.text}{msg.http ? ` (HTTP ${msg.http})` : ''}{msg.fix ? ` To fix: ${msg.fix}` : ''}</p> : null}
      </section>

      <section aria-label="Usage this month" className="space-y-2">
        <h2 className="text-base font-semibold">Usage in {u.month}</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Request type</th><th>This month</th><th>Free allowance</th><th>Today / daily limit</th><th>Over allowance</th><th>Est. overage</th></tr></thead>
            <tbody>{u.rows.map((r) => (
              <tr key={r.kind} className="border-b border-border/60">
                <td className="p-2">{KIND_LABEL[r.kind]}</td>
                <td>{r.month.toLocaleString('en-US')} <span className="text-xs text-muted-foreground">({r.percentOfFree}%)</span>{r.warning ? <span className="ml-1 rounded bg-warning/20 px-1 text-xs">warning</span> : null}</td>
                <td>{r.monthlyFree.toLocaleString('en-US')}</td>
                <td>{r.day} / {r.dailyLimit}{r.blocked ? <span className="ml-1 rounded bg-danger/15 px-1 text-xs text-danger">blocked</span> : null}</td>
                <td>{r.overFree}</td>
                <td>{r.estimatedOverageCents === null ? 'set a price below' : `$${(r.estimatedOverageCents / 100).toFixed(2)}`}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {u.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      </section>

      <section aria-label="Settings" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">Limits and behavior</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Automated measurements enabled</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowBaseFallback} onChange={(e) => setForm({ ...form, allowBaseFallback: e.target.checked })} /> Fall back to BASE imagery when HIGH is unavailable</label>
          <label className="flex items-center gap-2 text-sm">Preferred imagery quality
            <select className="h-9 rounded-md border border-border bg-card px-2" value={form.preferredQuality} onChange={(e) => setForm({ ...form, preferredQuality: e.target.value as SolarSettings['preferredQuality'] })}><option>HIGH</option><option>MEDIUM</option><option>BASE</option></select></label>
          <label className="flex items-center gap-2 text-sm">Warn at <Input type="number" min={1} max={100} className="h-9 w-20" value={form.warnPercent} onChange={(e) => setForm({ ...form, warnPercent: Number(e.target.value) })} /> % of allowance</label>
          <label className="flex items-center gap-2 text-sm">Reuse a measurement for <Input type="number" min={0} className="h-9 w-20" value={form.cacheDays} onChange={(e) => setForm({ ...form, cacheDays: Number(e.target.value) })} /> days</label>
          <label className="flex items-center gap-2 text-sm">Keep raw Google responses <Input type="number" min={0} className="h-9 w-20" value={form.rawRetentionDays} onChange={(e) => setForm({ ...form, rawRetentionDays: Number(e.target.value) })} /> days</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.includeImagery} onChange={(e) => setForm({ ...form, includeImagery: e.target.checked })} /> Fetch aerial imagery and roof outlines (uses a Data Layers request per measurement)</label>
          <label className="flex items-center gap-2 text-sm">Keep the stored aerial image <Input type="number" min={0} className="h-9 w-20" value={form.imageryRetentionDays} onChange={(e) => setForm({ ...form, imageryRetentionDays: Number(e.target.value) })} /> days (0 = do not store)</label>
          <label className="flex items-center gap-2 text-sm">Recommended pitched waste <Input type="number" min={0} max={30} className="h-9 w-20" value={form.recommendedPitchedWaste} onChange={(e) => setForm({ ...form, recommendedPitchedWaste: Number(e.target.value) })} /> %</label>
          <label className="flex items-center gap-2 text-sm">Recommended flat waste <Input type="number" min={0} max={30} className="h-9 w-20" value={form.recommendedFlatWaste} onChange={(e) => setForm({ ...form, recommendedFlatWaste: Number(e.target.value) })} /> %</label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.allowOverage} onChange={(e) => setForm({ ...form, allowOverage: e.target.checked })} /> Keep allowing requests after the monthly free allowance is used (Google will bill them)</label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">Request type</th><th>Daily limit</th><th>Monthly free allowance</th><th>Price per 1,000 beyond it (cents)</th></tr></thead>
            <tbody>{['building_insights', 'data_layers', 'geocode'].map((k) => (
              <tr key={k}><td className="py-1">{KIND_LABEL[k]}</td>
                <td>{num(form.dailyLimit, k, (v) => setForm({ ...form, dailyLimit: v }))}</td>
                <td>{num(form.monthlyFree, k, (v) => setForm({ ...form, monthlyFree: v }))}</td>
                <td>{num(form.pricePer1000Cents, k, (v) => setForm({ ...form, pricePer1000Cents: v }))}</td></tr>))}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Allowances come from the project brief (10,000 Building Insights and 1,000 Data Layers calls a month). Confirm the current allowance and prices on your Google Cloud billing page; prices are left blank until you enter them.</p>
        <Button type="button" disabled={mut.saveSettings.isPending} onClick={() => void save()}>Save settings</Button>
      </section>

      <MaterialCatalog />

      <section aria-label="Recent requests" className="space-y-2">
        <h2 className="text-base font-semibold">Recent requests</h2>
        {u.recent.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">{u.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="w-44">{new Date(r.at).toLocaleString('en-US')}</span><span className="w-40">{KIND_LABEL[r.kind]?.split(' (')[0]}</span><span className="w-16">{r.quality ?? ''}</span>
              <StatusBadge status={r.status === 'ok' ? 'confirmed' : r.status === 'not_found' ? 'pending' : 'failed'} /><span className="text-xs text-muted-foreground">{r.errorCode ?? ''}{r.isDemo ? ' · demo row' : ''}</span>
            </li>))}</ul>
        )}
      </section>
    </div>
  );
}
