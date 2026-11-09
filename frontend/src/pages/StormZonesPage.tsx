import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { useRankings, useStormStatus, useZoneMutations, useZones, type RankParams, type Zone } from '@/modules/storm/api';
import { Disclaimer } from '@/modules/storm/components';
import { MapLegend, StormMap, type Draft } from '@/modules/storm/StormMap';
import { useStaffDirectory } from '@/modules/users/api';
import { fmtDate } from '@/modules/storm/format';
import { ApiError } from '@/types/api';

const SORTS: Array<[string, string]> = [['score', 'Combined activity score'], ['hail', 'Largest hail'], ['wind', 'Highest wind'], ['reports', 'Most reports'], ['recent', 'Most recent storm']];

export function StormZonesPage(): React.ReactElement {
  const canManage = useHasPermission('stormZones:manage');
  const [rank, setRank] = useState<RankParams>({ sort: 'score' });
  const [open, setOpen] = useState<string | null>(null);
  const status = useStormStatus();
  const zones = useZones();
  const ranking = useRankings(rank);
  const staff = useStaffDirectory();
  const mut = useZoneMutations();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // creation
  const [kind, setKind] = useState<'radius' | 'polygon'>('radius');
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(5);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [points, setPoints] = useState<Array<[number, number]>>([]);
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');
  const [dates, setDates] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [thresholds, setThresholds] = useState<{ hail: string; wind: string }>({ hail: '', wind: '' });

  const draft: Draft = kind === 'radius' ? { kind: 'radius', center, radiusMiles: radius } : { kind: 'polygon', points };
  const ready = name.trim().length >= 2 && (kind === 'radius' ? center !== null : points.length >= 3);

  async function save(): Promise<void> {
    setErr(null); setMsg(null);
    const body: Record<string, unknown> = { name: name.trim(), kind, notes: notes || undefined, assignedUserId: assignee || undefined, dateFrom: dates.from || undefined, dateTo: dates.to || undefined, minHailInches: thresholds.hail ? Number(thresholds.hail) : undefined, minWindMph: thresholds.wind ? Number(thresholds.wind) : undefined };
    if (kind === 'radius') { body.center = center; body.radiusMiles = radius; } else body.polygon = [...points, points[0]];
    try {
      await mut.create.mutateAsync(body);
      setMsg(`Zone "${name.trim()}" created.`);
      setName(''); setCenter(null); setPoints([]); setNotes(''); setAssignee('');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not create the zone.'); }
  }
  async function assign(z: Zone, userId: string): Promise<void> {
    setErr(null); setMsg(null);
    try { await mut.assign.mutateAsync({ id: z.id, userId: userId || null, note: userId ? 'Reassigned from the zones page' : 'Unassigned' }); setMsg(`${z.name} assignment updated.`); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not assign.'); }
  }
  const rows = ranking.data?.rows ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Storm work zones" description="Pick the areas with the most reported hail and wind, rank them, and assign each to a sales representative." />
      <Disclaimer text="Zone figures count NOAA storm reports. Several reports can come from one storm, and a report is not confirmed damage at any particular property." />

      {canManage ? (
        <section aria-label="Create a zone" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">New zone</h2>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="font-medium">Zone type
              <select aria-label="Zone type" className="mt-1 block h-9 rounded-md border border-border bg-card px-2" value={kind} onChange={(e) => { setKind(e.target.value as 'radius' | 'polygon'); setCenter(null); setPoints([]); }}>
                <option value="radius">Radius around a point</option><option value="polygon">Drawn area</option></select></label>
            {kind === 'radius' ? <label className="font-medium">Radius (miles)<Input aria-label="Zone radius" type="number" min={0.5} max={100} step={0.5} className="mt-1 h-9 w-28" value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></label> : null}
            {kind === 'polygon' ? <Button type="button" variant="outline" size="sm" onClick={() => setPoints([])}>Clear corners</Button> : null}
            <p className="text-muted-foreground">{kind === 'radius' ? (center ? `Centre set (${center.lat.toFixed(3)}, ${center.lng.toFixed(3)}). Click the map to move it.` : 'Click the map to set the centre.') : `${points.length} corner${points.length === 1 ? '' : 's'} placed. Click the map to add corners (at least 3).`}</p>
          </div>
          <StormMap
            tileUrl={status.data?.mapTileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'} attribution={status.data?.mapAttribution ?? ''} center={[32.78, -96.8]} zoom={8} height="22rem"
            zones={zones.data ?? []} draft={draft} ariaLabel="Map for drawing a zone"
            onMapClick={(lat, lng) => (kind === 'radius' ? setCenter({ lat, lng }) : setPoints((p) => [...p, [lng, lat]]))} />
          <MapLegend />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-muted-foreground">Name<Input aria-label="Zone name" className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lancaster north" /></label>
            <label className="text-xs text-muted-foreground">Representative
              <select aria-label="Assign to" className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>{staff.data?.data.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select></label>
            <label className="text-xs text-muted-foreground">Storm dates from<Input type="date" className="mt-1 h-9" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">to<Input type="date" className="mt-1 h-9" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Minimum hail (in)<Input type="number" min={1} step={0.25} placeholder="1.00" className="mt-1 h-9" value={thresholds.hail} onChange={(e) => setThresholds({ ...thresholds, hail: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Minimum wind (mph)<Input type="number" min={51} placeholder=">50" className="mt-1 h-9" value={thresholds.wind} onChange={(e) => setThresholds({ ...thresholds, wind: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground sm:col-span-2">Notes<Input className="mt-1 h-9" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <Button type="button" disabled={!ready || mut.create.isPending} onClick={() => void save()}>Create zone</Button>
        </section>
      ) : null}
      {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
      {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}

      <section aria-label="Zone ranking" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold">Zone ranking</h2>
          <div className="flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
            <label>Rank by<select aria-label="Rank by" className="mt-1 block h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground" value={rank.sort} onChange={(e) => setRank({ ...rank, sort: e.target.value })}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>From<Input type="date" className="mt-1 h-9" value={rank.from ?? ''} onChange={(e) => setRank({ ...rank, from: e.target.value || undefined })} /></label>
            <label>To<Input type="date" className="mt-1 h-9" value={rank.to ?? ''} onChange={(e) => setRank({ ...rank, to: e.target.value || undefined })} /></label>
            <label>Min hail<Input type="number" min={1} step={0.25} className="mt-1 h-9 w-20" value={rank.minHail ?? ''} onChange={(e) => setRank({ ...rank, minHail: e.target.value || undefined })} /></label>
            <label>Min wind<Input type="number" min={51} className="mt-1 h-9 w-20" value={rank.minWind ?? ''} onChange={(e) => setRank({ ...rank, minWind: e.target.value || undefined })} /></label>
          </div>
        </div>
        {rank.sort === 'score' ? (
          <div className="flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
            <span>Score weights:</span>
            <label>Hail<Input type="number" min={0} step={0.25} className="mt-1 h-9 w-20" value={rank.wHail ?? '1'} onChange={(e) => setRank({ ...rank, wHail: e.target.value })} /></label>
            <label>Wind<Input type="number" min={0} step={0.25} className="mt-1 h-9 w-20" value={rank.wWind ?? '0.5'} onChange={(e) => setRank({ ...rank, wWind: e.target.value })} /></label>
            <label>Recency<Input type="number" min={0} step={0.25} className="mt-1 h-9 w-20" value={rank.wRecency ?? '1'} onChange={(e) => setRank({ ...rank, wRecency: e.target.value })} /></label>
          </div>
        ) : null}
        {ranking.data ? <p className="text-xs text-muted-foreground" data-testid="rank-explanation">{ranking.data.explanation}</p> : null}
        {ranking.isLoading || zones.isLoading ? <LoadingState /> : ranking.isError ? <ErrorState message="Could not rank the zones." onRetry={() => void ranking.refetch()} /> : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{canManage ? 'No zones yet. Create one above.' : 'No territory has been assigned to you yet.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[60rem] text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">#</th><th>Zone</th><th className="text-right">Hail</th><th className="text-right">Wind</th><th className="text-right">Max hail</th><th className="text-right">Max wind</th><th className="text-right">Storm days</th><th>Latest</th><th className="text-right">Customers</th><th className="text-right">Leads</th><th className="text-right">Past cust.</th><th className="text-right">Score</th><th>Representative</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <ZoneRow key={r.zone.id} r={r} open={open === r.zone.id} onToggle={() => setOpen(open === r.zone.id ? null : r.zone.id)} canManage={canManage} staff={staff.data?.data ?? []} onAssign={assign} onArchive={(z) => { if (window.confirm(`Archive zone "${z.name}"?`)) void mut.archive.mutateAsync(z.id); }} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ZoneRow({ r, open, onToggle, canManage, staff, onAssign, onArchive }: { r: NonNullable<ReturnType<typeof useRankings>['data']>['rows'][number]; open: boolean; onToggle: () => void; canManage: boolean; staff: Array<{ id: string; firstName: string; lastName: string }>; onAssign: (z: Zone, userId: string) => Promise<void>; onArchive: (z: Zone) => void }): React.ReactElement {
  const { zone: z, stats: s } = r;
  return (
    <>
      <tr className="border-b border-border/60 align-top" data-testid="zone-row">
        <td className="p-2 tabular-nums">{r.rank}</td>
        <td><button type="button" className="font-medium text-brand hover:underline" aria-expanded={open} onClick={onToggle}>{z.name}</button><span className="block text-xs text-muted-foreground">{z.kind === 'radius' ? `${z.radiusMiles} mi radius` : z.kind === 'polygon' ? 'Drawn area' : 'Counties'}</span></td>
        <td className="text-right tabular-nums">{s.hailReports}</td><td className="text-right tabular-nums">{s.windReports}</td>
        <td className="text-right tabular-nums">{s.maxHailInches ? `${s.maxHailInches.toFixed(2)} in` : '—'}</td><td className="text-right tabular-nums">{s.maxWindMph ? `${Math.round(s.maxWindMph)} mph` : '—'}</td>
        <td className="text-right tabular-nums">{s.stormDays}</td><td>{s.latestEvent ? fmtDate(s.latestEvent) : '—'}</td>
        <td className="text-right tabular-nums">{s.crm.customers}</td><td className="text-right tabular-nums">{s.crm.leads}</td><td className="text-right tabular-nums">{s.crm.pastCustomers}</td>
        <td className="text-right font-medium tabular-nums">{s.score.total.toFixed(1)}</td>
        <td>
          {canManage ? (
            <select aria-label={`Representative for ${z.name}`} className="h-8 rounded-md border border-border bg-card px-1 text-xs" value={z.assignedUser?.id ?? ''} onChange={(e) => void onAssign(z, e.target.value)}>
              <option value="">Unassigned</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          ) : (z.assignedUser?.name ?? '—')}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-border/60 bg-muted/30"><td colSpan={13} className="space-y-2 p-3 text-xs">
          <p><strong>How the score is calculated.</strong> Hail {s.score.weights.hail} × {(s.score.hailPoints / (s.score.weights.hail || 1)).toFixed(2)} = {s.score.hailPoints.toFixed(2)} · Wind {s.score.weights.wind} × {(s.score.windPoints / (s.score.weights.wind || 1)).toFixed(2)} = {s.score.windPoints.toFixed(2)} · Recency {s.score.weights.recency} × {(s.score.recencyPoints / (s.score.weights.recency || 1)).toFixed(2)} = {s.score.recencyPoints.toFixed(2)} → <strong>{s.score.total.toFixed(2)}</strong></p>
          <p className="text-muted-foreground">{s.score.formula}</p>
          <p className="text-muted-foreground">{s.crm.note}{s.crm.leadsNotLocated > 0 ? ` ${s.crm.leadsNotLocated} lead(s) have no located address yet and are not counted.` : ''}</p>
          {z.notes ? <p>Notes: {z.notes}</p> : null}
          <div><strong>Assignment history</strong>
            <ul className="mt-1 list-disc pl-5">{z.assignmentHistory.map((h, i) => <li key={i}>{fmtDate(h.at)}: {h.user ?? 'Unassigned'} (by {h.by}{h.note ? `, ${h.note}` : ''})</li>)}{z.assignmentHistory.length === 0 ? <li>Never assigned</li> : null}</ul></div>
          {canManage ? <Button type="button" size="sm" variant="outline" onClick={() => onArchive(z)}>Archive zone</Button> : null}
        </td></tr>
      ) : null}
    </>
  );
}
