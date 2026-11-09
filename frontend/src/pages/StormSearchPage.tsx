import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { RADII, useStormSearch, useStormStatus, type EventFilters, type SearchParams } from '@/modules/storm/api';
import { Disclaimer, EventDetailCard, EventFilterBar, EventsTable } from '@/modules/storm/components';
import { StormMap, MapLegend } from '@/modules/storm/StormMap';
import { fmtDate } from '@/modules/storm/format';
import { ApiError } from '@/types/api';

export function StormSearchPage(): React.ReactElement {
  const [sp] = useSearchParams();
  const [address, setAddress] = useState(sp.get('address') ?? '');
  const [radius, setRadius] = useState(Number(sp.get('radius')) || 5);
  const [dateOfLoss, setDateOfLoss] = useState('');
  const [sort, setSort] = useState('nearest');
  const [filters, setFilters] = useState<EventFilters>({});
  const [unknown, setUnknown] = useState(false);
  const [page, setPage] = useState(1);
  const [submitted, setSubmitted] = useState<SearchParams | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const status = useStormStatus();
  const result = useStormSearch(submitted);

  function run(nextPage = 1): void {
    if (address.trim().length < 5) return;
    setPage(nextPage);
    setSelected(null);
    setSubmitted({ ...filters, address: address.trim(), radius, dateOfLoss: dateOfLoss || undefined, sort, page: nextPage, pageSize: 15, includeUnknownSpeed: unknown ? 'true' : undefined });
  }
  const d = result.data;
  const err = result.error instanceof ApiError ? result.error : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Hail & wind search" description="Find reported hail (1.00 inch or larger) and wind (over 50 mph) near any address, from NOAA storm reports." />
      <form className="space-y-3 rounded-lg border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
          <label className="text-sm font-medium">Property address
            <Input aria-label="Property address" className="mt-1" placeholder="1532 Rebecca Lane, Lancaster, TX 75134" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          <label className="text-sm font-medium">Radius
            <select aria-label="Radius" className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2 text-sm" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{RADII.map((r) => <option key={r} value={r}>{r} mile{r === 1 ? '' : 's'}</option>)}</select></label>
          <label className="text-sm font-medium">Date of loss (optional)
            <Input aria-label="Date of loss" type="date" className="mt-1" value={dateOfLoss} onChange={(e) => setDateOfLoss(e.target.value)} /></label>
          <div className="flex items-end"><Button type="submit" className="h-10 w-full" disabled={address.trim().length < 5 || result.isFetching}>{result.isFetching ? 'Searching…' : 'Search'}</Button></div>
        </div>
        <EventFilterBar value={filters} onChange={setFilters} />
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} /> Include wind damage reports with no speed (they do not meet the 50 mph rule)</label>
          <label className="flex items-center gap-2">Sort by
            <select aria-label="Sort results" className="h-9 rounded-md border border-border bg-card px-2" value={sort} onChange={(e) => { setSort(e.target.value); if (submitted) setSubmitted({ ...submitted, sort: e.target.value, page: 1 }); }}>
              <option value="nearest">Nearest</option><option value="newest">Newest</option><option value="largest">Largest</option>
            </select></label>
        </div>
        {status.data && !status.data.geocoder.configured ? <p role="alert" className="text-sm text-danger">{status.data.geocoder.message}</p> : null}
        {status.data?.geocoder.configured ? <p className="text-xs text-muted-foreground">Address lookup: {status.data.geocoder.message}</p> : null}
      </form>

      {result.isLoading ? <LoadingState label="Searching storm reports…" /> : null}
      {err ? <ErrorState message={err.message} /> : null}
      {result.isError && !err ? <ErrorState message="The search failed. Try again." onRetry={() => void result.refetch()} /> : null}

      {d ? (
        <div className="space-y-4" data-testid="storm-results">
          <section aria-label="Search summary" className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm"><strong>{d.location.label}</strong> <span className="text-muted-foreground">· {d.location.accuracy ?? ''}{d.location.provider ? ` via ${d.location.provider}` : ''}</span></p>
            <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <p><span className="text-2xl font-semibold tabular-nums" data-testid="hail-count">{d.summary.hailReports}</span> hail reports{d.summary.maxHailInches ? <span className="text-muted-foreground"> · largest {d.summary.maxHailInches.toFixed(2)} in</span> : null}</p>
              <p><span className="text-2xl font-semibold tabular-nums" data-testid="wind-count">{d.summary.windReports}</span> wind reports{d.summary.maxWindMph ? <span className="text-muted-foreground"> · strongest {Math.round(d.summary.maxWindMph)} mph</span> : null}</p>
              <p><span className="text-2xl font-semibold tabular-nums">{d.summary.distinctDays}</span> storm day{d.summary.distinctDays === 1 ? '' : 's'} within {d.radiusMiles} mile{d.radiusMiles === 1 ? '' : 's'}</p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{d.summary.note}</p>
          </section>
          <Disclaimer text={d.disclaimer} />

          {d.dateOfLoss ? (
            <section aria-label="Date of loss" className="space-y-2">
              <h2 className="text-base font-semibold">Storm activity around {fmtDate(`${d.dateOfLoss.dateOfLoss}T00:00:00Z`)}</h2>
              <div className="grid gap-3 md:grid-cols-3">
                {d.dateOfLoss.days.map((day) => (
                  <div key={day.day} data-testid={`day-${day.isDateOfLoss ? 'loss' : 'other'}`} className={cn('rounded-lg border p-3', day.isDateOfLoss ? 'border-2 border-brand bg-brand-soft' : 'border-border bg-card')}>
                    <p className={cn('text-xs font-semibold uppercase tracking-wide', day.isDateOfLoss ? 'text-brand' : 'text-muted-foreground')}>{day.label}</p>
                    <p className="text-sm font-medium">{fmtDate(`${day.day}T00:00:00Z`)}</p>
                    <p className="mt-1 text-sm">{day.hailReports} hail · {day.windReports} wind</p>
                    <p className="text-xs text-muted-foreground">{day.maxHailInches ? `Largest hail ${day.maxHailInches.toFixed(2)} in` : 'No hail reports'}{day.maxWindMph ? ` · wind up to ${Math.round(day.maxWindMph)} mph` : ''}</p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {day.events.slice(0, 6).map((e) => <li key={e.id}>{e.localTime} · {e.magnitudeLabel} · {e.distanceMiles?.toFixed(1)} mi {e.direction}</li>)}
                      {day.events.length > 6 ? <li className="text-muted-foreground">+{day.events.length - 6} more</li> : null}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{d.dateOfLoss.timeNote} A report on these days does not mean the storm caused the claimed damage.</p>
            </section>
          ) : null}

          <section aria-label="Map of results" className="space-y-2">
            <StormMap
              tileUrl={status.data?.mapTileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'} attribution={status.data?.mapAttribution ?? ''}
              center={[d.location.latitude, d.location.longitude]} zoom={d.radiusMiles <= 1 ? 14 : d.radiusMiles <= 3 ? 12 : d.radiusMiles <= 5 ? 11 : 10} focusKey={`${d.location.latitude},${d.location.longitude},${d.radiusMiles}`}
              height="22rem" pin={{ lat: d.location.latitude, lng: d.location.longitude, label: d.location.label }} circle={{ lat: d.location.latitude, lng: d.location.longitude, radiusMiles: d.radiusMiles }}
              markers={d.data.filter((e) => e.latitude !== null).map((e) => ({ id: e.id, t: e.eventType, d: e.eventDate, h: e.hailSizeInches, w: e.windSpeedMph, lat: e.latitude as number, lng: e.longitude as number, p: e.precision, s: e.source }))}
              onMarkerClick={setSelected} ariaLabel="Map of storm reports near the property" />
            <MapLegend />
          </section>

          <section aria-label="Reports" className="space-y-2">
            <h2 className="text-base font-semibold">Reports within {d.radiusMiles} mile{d.radiusMiles === 1 ? '' : 's'} <span className="text-sm font-normal text-muted-foreground">({d.meta.total})</span></h2>
            <EventsTable events={d.data} onSelect={setSelected} selectedId={selected} highlightDay={dateOfLoss || undefined} />
            <Pagination page={page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={(p) => run(p)} />
            {selected ? <EventDetailCard id={selected} onClose={() => setSelected(null)} /> : null}
          </section>
          {d.regional && d.regional.count > 0 ? (
            <section aria-label="County-level reports" className="space-y-1">
              <h2 className="text-base font-semibold">County-level reports (regional context)</h2>
              <p className="text-xs text-muted-foreground">{d.regional.note}</p>
              <EventsTable events={d.regional.items} />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
