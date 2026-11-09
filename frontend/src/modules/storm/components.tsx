import { Link } from 'react-router-dom';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { ApiError } from '@/types/api';
import { DISCLAIMER, fmtDate } from './format';
import { HAIL_COLOR, WIND_COLOR } from './StormMap';
import { useEventDetail, type EventFilters, type StormEvent } from './api';

export function Disclaimer({ text = DISCLAIMER }: { text?: string }): React.ReactElement {
  return <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">{text}</p>;
}

export function TypeBadge({ type }: { type: 'hail' | 'wind' }): React.ReactElement {
  const c = type === 'hail' ? HAIL_COLOR : WIND_COLOR;
  return <span className="inline-flex items-center gap-1.5 text-xs font-medium"><span className={cn('inline-block h-2.5 w-2.5 border border-white', type === 'hail' ? 'rounded-full' : 'rotate-45')} style={{ background: c, boxShadow: `0 0 0 1px ${c}` }} />{type === 'hail' ? 'Hail' : 'Wind'}</span>;
}

export function PrecisionTag({ e }: { e: Pick<StormEvent, 'precision' | 'precisionLabel'> }): React.ReactElement {
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px]', e.precision === 'exact' ? 'bg-success/15 text-success' : e.precision === 'approximate' ? 'bg-warning/20' : 'bg-muted text-muted-foreground')} title={e.precisionLabel}>{e.precision === 'exact' ? 'Exact' : e.precision === 'approximate' ? 'Approx. ±1 km' : e.precision === 'county' ? 'County only' : 'No location'}</span>;
}

export function EventsTable({ events, onSelect, selectedId, highlightDay }: { events: StormEvent[]; onSelect?: (id: string) => void; selectedId?: string | null; highlightDay?: string }): React.ReactElement {
  if (events.length === 0) return <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No qualifying reports.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[56rem] text-sm">
        <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Date</th><th>Time</th><th>Type</th><th>Size / speed</th><th className="text-right">Distance</th><th>Direction</th><th>Location</th><th>County</th><th>Source</th><th>Precision</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className={cn('border-b border-border/60', selectedId === e.id && 'bg-brand-soft', highlightDay === e.localDate && 'font-medium', onSelect && 'cursor-pointer hover:bg-muted/50')} onClick={() => onSelect?.(e.id)}>
              <td className="p-2">{fmtDate(`${e.localDate}T00:00:00Z`)}</td>
              <td className="tabular-nums">{e.localTime}</td>
              <td><TypeBadge type={e.eventType} /></td>
              <td>{e.magnitudeLabel}</td>
              <td className="text-right tabular-nums">{e.distanceMiles === null ? '—' : `${e.distanceMiles.toFixed(1)} mi`}</td>
              <td>{e.direction ?? '—'}</td>
              <td className="max-w-[14rem] truncate" title={e.locationDescription}>{e.locationDescription || '—'}</td>
              <td>{[e.county, e.state].filter(Boolean).join(', ')}</td>
              <td title={e.sourceLabel}>{e.source === 'spc' ? 'NOAA SPC' : 'NOAA NCEI'}</td>
              <td><PrecisionTag e={e} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EventDetailCard({ id, onClose }: { id: string; onClose?: () => void }): React.ReactElement {
  const q = useEventDetail(id);
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState message={q.error instanceof ApiError ? q.error.message : 'Could not load this report.'} />;
  const e = q.data;
  return (
    <section aria-label="Event details" className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div><TypeBadge type={e.eventType} /><p className="mt-1 text-base font-semibold">{e.magnitudeLabel}</p></div>
        {onClose ? <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onClose}>Close</button> : null}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
        <dt className="text-muted-foreground">Date</dt><dd>{fmtDate(`${e.localDate}T00:00:00Z`)} {e.localTime} (local standard time)</dd>
        <dt className="text-muted-foreground">Location</dt><dd>{e.locationDescription || '—'}{e.county ? `, ${e.county} County` : ''}{e.state ? `, ${e.state}` : ''}</dd>
        <dt className="text-muted-foreground">Coordinates</dt><dd>{e.latitude !== null ? `${e.latitude.toFixed(4)}, ${e.longitude?.toFixed(4)}` : 'None reported'} <PrecisionTag e={e} /></dd>
        <dt className="text-muted-foreground">Source</dt><dd>{e.sourceLabel} <span className="text-xs text-muted-foreground">(record {e.sourceRecordId}, imported {fmtDate(e.importedAt)})</span></dd>
        {e.reporter ? <><dt className="text-muted-foreground">Reported by</dt><dd>{e.reporter}</dd></> : null}
        {e.narrative ? <><dt className="text-muted-foreground">Narrative</dt><dd className="whitespace-pre-wrap">{e.narrative}</dd></> : null}
      </dl>
      <Disclaimer text={e.disclaimer} />
    </section>
  );
}

/** Shared date, type, size and speed filters. Thresholds cannot be lowered: hail 1.00 in and wind above 50 mph are the floor. */
export function EventFilterBar({ value, onChange }: { value: EventFilters; onChange: (v: EventFilters) => void }): React.ReactElement {
  const set = (patch: Partial<EventFilters>): void => onChange({ ...value, ...patch });
  const types = value.types ?? 'hail,wind';
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
      <label className="text-xs text-muted-foreground">From<Input type="date" className="mt-1 h-9" value={value.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></label>
      <label className="text-xs text-muted-foreground">To<Input type="date" className="mt-1 h-9" value={value.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></label>
      <label className="text-xs text-muted-foreground">Event type
        <select className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={types} onChange={(e) => set({ types: e.target.value === 'hail,wind' ? undefined : e.target.value })}>
          <option value="hail,wind">Hail and wind</option><option value="hail">Hail only</option><option value="wind">Wind only</option>
        </select></label>
      <label className="text-xs text-muted-foreground">Minimum hail (in)
        <Input type="number" min={1} step={0.25} placeholder="1.00" className="mt-1 h-9" value={value.minHail ?? ''} onChange={(e) => set({ minHail: e.target.value || undefined })} /></label>
      <label className="text-xs text-muted-foreground">Minimum wind (mph)
        <Input type="number" min={51} step={1} placeholder=">50" className="mt-1 h-9" value={value.minWind ?? ''} onChange={(e) => set({ minWind: e.target.value || undefined })} /></label>
      <label className="text-xs text-muted-foreground">Data source
        <select className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={value.sources ?? ''} onChange={(e) => set({ sources: e.target.value || undefined })}>
          <option value="">Both</option><option value="spc">NOAA SPC (recent)</option><option value="ncei">NOAA NCEI (historical)</option>
        </select></label>
    </div>
  );
}

export const EventLink = ({ id, children }: { id: string; children: React.ReactNode }): React.ReactElement => <Link className="text-brand hover:underline" to={`/app/storm/map?event=${id}`}>{children}</Link>;
