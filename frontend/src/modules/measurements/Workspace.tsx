import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Tabs } from '@/components/shared/Tabs';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { useCustomerSummary } from '@/modules/customers/api';
import { ApiError } from '@/types/api';
import { CorrectionsPanel } from './CorrectionsPanel';
import { EdgeTable } from './EdgeTable';
import { MaterialsSection } from './MaterialsSection';
import { PhotoSection } from './PhotoSection';
import { openSolarReport } from './solarApi';
import type { Measurement } from './types';
import { fetchBlobUrl, useDiagrams, useGeometry, useSummary, useWorkspaceMutations } from './workspaceApi';
const n0 = (n: number): string => Math.round(n).toLocaleString('en-US');

function Card({ label, value, sub }: { label: string; value: string; sub?: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function AerialTab({ m, overlay, imagery, reason, onRefresh, canRefresh }: { m: Measurement; overlay: string | null; imagery: { widthPx: number; heightPx: number; date: string | null; quality: string | null; fileId: string | null; retainedUntil: string | null } | null; reason: string | null; onRefresh: () => void; canRefresh: boolean }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!imagery?.fileId) return;
    let alive = true;
    let u: string | null = null;
    void fetchBlobUrl(`/measurements/solar/${m.id}/aerial.png`).then((x) => { if (alive) { u = x; setUrl(x); } else URL.revokeObjectURL(x); }).catch((e: Error) => alive && setErr(e.message));
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [m.id, imagery?.fileId]);
  if (!imagery?.fileId || err) {
    return (
      <div className="rounded-lg border border-border bg-muted p-6 text-center text-sm" role="status">
        <p className="font-medium">Aerial imagery is not available</p>
        <p className="mx-auto mt-1 max-w-xl text-muted-foreground">{err ?? reason ?? (imagery && !imagery.fileId ? 'The image was not retained (retention is 0 days) or has expired.' : 'Imagery has not been requested for this measurement yet.')}</p>
        {canRefresh ? <Button type="button" className="mt-3" onClick={onRefresh}>Refresh imagery</Button> : null}
      </div>
    );
  }
  return (
    <figure className="m-0 space-y-2">
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-black" style={{ aspectRatio: `${imagery.widthPx} / ${imagery.heightPx}` }}>
        {url ? <img src={url} alt="Aerial view of the property" className="absolute inset-0 h-full w-full" /> : <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />}
        {overlay ? <div className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" aria-hidden dangerouslySetInnerHTML={{ __html: overlay }} /> : null}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Aerial imagery © Google. Source: Includes solar data from Google. Captured {imagery.date ?? 'date not provided'}, quality {imagery.quality ?? 'not provided'}. This is aerial imagery, not an inspection photograph. <strong>Check that the red outline is the right building</strong> before relying on the numbers: Google measures the building closest to the address pin.
        {imagery.retainedUntil ? ` Stored copy kept until ${new Date(imagery.retainedUntil).toLocaleDateString('en-US')}.` : ''}
      </figcaption>
    </figure>
  );
}

/** Professional layout for an automated or demo measurement: summary, visual tabs, review tables, photos, materials, history. */
export function Workspace({ m }: { m: Measurement }): React.ReactElement {
  const s = m.solar;
  const sum = useSummary(m.id);
  const dg = useDiagrams(m.id);
  const geo = useGeometry(m.id);
  const mut = useWorkspaceMutations(m.id);
  const customer = useCustomerSummary(m.customerId);
  const canOrder = useHasPermission('measurements:order');
  const canUpdate = useHasPermission('measurements:update') && !s?.supersededById;
  const canEstimate = useHasPermission('estimates:create');
  const [tab, setTab] = useState('aerial');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const property = customer.data?.data.properties.find((p) => p.id === m.propertyId);
  const address = property ? [property.address.line1, property.address.city, [property.address.state, property.address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : 'Property';
  const customerName = customer.data ? (customer.data.data.customer.type === 'business' ? customer.data.data.customer.companyName : `${customer.data.data.customer.firstName} ${customer.data.data.customer.lastName}`.trim()) : '';
  const g = geo.data;
  const edges = g?.edges ?? [];
  const verifiedEdges = edges.filter((e) => e.verification === 'verified' || e.source === 'manual').length;
  if (!s) return <></>;

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.' }); } finally { setBusy(false); }
  };
  const tabs = [{ key: 'aerial', label: 'Aerial' }, { key: 'outline', label: 'Roof outline' }, { key: 'facets', label: 'Facets' }, { key: 'area', label: 'Area' }, { key: 'pitch', label: 'Pitch' }, { key: 'edges', label: 'Edge measurements', count: edges.length }];
  const geoLabel = !g ? 'No outline yet' : g.status === 'ok' ? 'Outline detected' : g.status === 'partial' ? 'Outline partly detected' : 'Outline unavailable';

  return (
    <div className="space-y-6">
      {s.isDemo ? <p role="note" className="rounded-md border border-warning bg-warning/15 p-3 text-sm font-medium">Demonstration data: these values are samples, not a real measurement and not from Google.</p> : null}
      {s.supersededById ? <p role="note" className="rounded-md border border-border bg-muted p-3 text-sm">This is an older revision, kept for history and read-only. <Link className="underline" to={`/app/measurements/${s.supersededById}`}>Open the latest revision</Link>.</p> : null}

      <header className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{address}</h2>
            <p className="text-sm text-muted-foreground">{customerName}{customerName ? ' · ' : ''}<Link className="underline" to={`/app/properties/${m.propertyId}`}>Property</Link></p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge status={s.isDemo ? 'draft' : 'confirmed'} />
              <span>{s.isDemo ? 'Demonstration' : m.provider === 'google_solar' ? 'Google Solar' : 'Manual'}</span>
              <span className="text-muted-foreground">·</span><span>Imagery {s.automated?.imagery.date ?? 'n/a'} ({s.automated?.imagery.quality ?? 'n/a'})</span>
              <span className="text-muted-foreground">·</span><span>Revision {s.revision}</span>
              <span className="text-muted-foreground">·</span><span>{geoLabel}</span>
              <span className="text-muted-foreground">·</span><span>{verifiedEdges}/{edges.length} edges verified</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-11" disabled={busy} onClick={() => void run(async () => { await openSolarReport(m.id); }, 'Report downloaded.')}>Download PDF</Button>
            {canEstimate && !s.supersededById ? <Button asChild variant="outline" className="h-11"><Link to={`/app/quote?measurementId=${m.id}&customerId=${m.customerId}&propertyId=${m.propertyId}`}>Create estimate</Link></Button> : null}
            {canOrder && m.provider === 'google_solar' && !s.supersededById ? (
              <>
                <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void run(() => mut.refreshImagery.mutateAsync(), 'Imagery refreshed.')}>Refresh imagery</Button>
                <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => { if (window.confirm('Request fresh Google data? This uses your Google quota and creates a new revision. The current revision is kept.')) void run(async () => { const { apiFetch } = await import('@/services/http'); const r = await apiFetch<{ data: Measurement }>('/measurements/solar/run', { method: 'POST', body: JSON.stringify({ propertyId: m.propertyId, force: true }) }); window.location.assign(`/app/measurements/${r.data.id}`); }, 'New revision created.'); }}>New revision</Button>
              </>
            ) : null}
          </div>
        </div>
        {msg ? <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p> : null}
      </header>

      {sum.data ? (
        <section aria-label="Measurement summary" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Card label="Total roof area" value={`${n0(sum.data.totalAreaSqFt)} sq ft`} sub={s.fieldSources.totalArea === 'manual' ? 'Manually entered' : s.isDemo ? 'Demonstration' : 'Google Solar'} />
          <Card label="Roofing squares" value={`${sum.data.squares.toFixed(1)} SQ`} sub="1 SQ = 100 sq ft" />
          <Card label="Predominant pitch" value={sum.data.predominantPitch || '—'} sub={s.automated ? `${s.automated.predominantPitchDegrees}°` : undefined} />
          <Card label="Facets" value={String(sum.data.facetCount)} sub={g?.facets.length ? `${g.facets.length} outlined` : 'outlines unavailable'} />
          <Card label="Pitched area" value={`${n0(sum.data.pitchedAreaSqFt)} sq ft`} />
          <Card label="Flat area" value={`${n0(sum.data.flatAreaSqFt)} sq ft`} />
        </section>
      ) : null}

      <section aria-label="Roof visualization">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {dg.data?.approximate && tab !== 'aerial' ? <p role="note" className="mb-2 rounded-md border border-warning bg-warning/15 p-2 text-sm">Approximate: {dg.data.reason ?? 'some outlines are estimates'}. {canUpdate ? 'You can correct the numbers below.' : ''}</p> : null}
          {tab === 'aerial' ? <AerialTab m={m} overlay={dg.data?.aerialOverlay ?? null} imagery={g?.imagery ?? null} reason={g?.reason ?? null} canRefresh={canOrder && m.provider === 'google_solar' && !s.supersededById} onRefresh={() => void run(() => mut.refreshImagery.mutateAsync(), 'Imagery refreshed.')} /> : null}
          {tab !== 'aerial' && dg.data?.svgs[tab as 'outline'] ? <div className="mx-auto max-w-4xl overflow-hidden rounded-lg border border-border bg-white [&>svg]:h-auto [&>svg]:w-full" role="img" aria-label={`${tab} diagram`} dangerouslySetInnerHTML={{ __html: dg.data.svgs[tab as 'outline'] as string }} /> : null}
          {tab !== 'aerial' && dg.data && !dg.data.svgs[tab as 'outline'] ? <p className="text-sm text-muted-foreground">No diagram is available.</p> : null}
          {g?.warnings.map((w) => <p key={w} className="mt-2 text-xs text-muted-foreground">• {w}</p>)}
        </div>
      </section>

      {g && g.facets.length > 0 ? (
        <section aria-label="Facets" className="space-y-2">
          <h2 className="text-base font-semibold">Facets</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Roof facets</caption>
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Facet</th><th>Area (sq ft)</th><th>Pitch</th><th>Direction</th><th>Outline</th></tr></thead>
              <tbody>{g.facets.map((f) => (
                <tr key={f.id} className="border-b border-border/60"><td className="p-2 font-medium">{f.id}</td><td>{n0(f.areaSqFt)}</td><td>{f.flat ? 'Flat' : f.pitchLabel} ({f.pitchDegrees}°)</td><td>{Math.round(f.azimuthDegrees)}°</td><td className="text-xs">{f.confidence === 'low' ? 'Approximate' : 'Detected'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : s.automated ? (
        <section aria-label="Segments" className="space-y-2">
          <h2 className="text-base font-semibold">Roof segments (from Google)</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[30rem] text-sm"><caption className="sr-only">Segments</caption>
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">ID</th><th>Area (sq ft)</th><th>Pitch</th><th>Direction</th></tr></thead>
              <tbody>{s.automated.segments.map((x) => <tr key={x.id} className="border-b border-border/60"><td className="p-2 font-medium">{x.id}</td><td>{n0(x.areaSqFt)}</td><td>{x.pitchLabel} ({x.pitchDegrees}°)</td><td>{x.compass} ({x.azimuthDegrees}°)</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      {sum.data && sum.data.pitchBreakdown.length > 0 ? (
        <section aria-label="Pitch breakdown" className="space-y-2">
          <h2 className="text-base font-semibold">Pitch breakdown</h2>
          <ul className="space-y-1 text-sm">{sum.data.pitchBreakdown.map((p) => (
            <li key={p.pitch} className="flex items-center gap-3"><span className="w-14 font-medium">{p.pitch}</span>
              <span className="h-2 flex-1 rounded-full bg-muted" aria-hidden><span className="block h-2 rounded-full bg-brand" style={{ width: `${p.percent}%` }} /></span>
              <span className="w-48 text-right text-muted-foreground">{n0(p.areaSqFt)} sq ft · {p.percent}% · {p.segmentCount} seg.</span></li>))}</ul>
        </section>
      ) : null}

      {sum.data && sum.data.structures.length > 1 ? (
        <section aria-label="Structures" className="space-y-2">
          <h2 className="text-base font-semibold">Structures</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">{sum.data.structures.map((x) => (
            <li key={x.id} className="px-3 py-2"><strong>{x.label}</strong>: {x.roofAreaMeasured ? `${n0(x.roofAreaSqFt ?? 0)} sq ft roof` : `${n0(x.footprintAreaSqFt)} sq ft footprint (outline only, roof not measured)`}</li>))}</ul>
        </section>
      ) : null}

      <EdgeTable measurementId={m.id} edges={edges} editable={canUpdate} />
      <MaterialsSection measurementId={m.id} editable={canUpdate} />
      <PhotoSection measurementId={m.id} editable={canUpdate} />
      <CorrectionsPanel m={m} />

      <p className="text-xs text-muted-foreground">{s.isDemo ? 'Demonstration data.' : 'Includes data from Google Maps. Source: Includes solar data from Google.'} Measurements are derived from available aerial/property data and computational geometry; field verification is recommended before ordering materials or fixing a contract price.</p>
    </div>
  );
}
