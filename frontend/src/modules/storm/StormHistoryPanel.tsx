import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { ApiError } from '@/types/api';
import { RADII, useStormHistory } from './api';
import { Disclaimer, EventsTable } from './components';

type Target = { propertyId?: string; customerId?: string; leadId?: string; projectId?: string };

/** Storm history for a lead, customer, property or job, measured from that record's own address. */
export function StormHistoryPanel({ target }: { target: Target }): React.ReactElement {
  const [radius, setRadius] = useState(3);
  const q = useStormHistory(target, radius);
  return (
    <section aria-label="Storm history" className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Storm history</h2>
        <label className="flex items-center gap-2 text-sm">Search radius
          <select aria-label="Storm history radius" className="h-9 rounded-md border border-border bg-card px-2" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{RADII.map((r) => <option key={r} value={r}>{r} mile{r === 1 ? '' : 's'}</option>)}</select></label>
      </div>
      {q.isLoading ? <LoadingState label="Looking up storm reports…" /> : null}
      {q.isError ? <ErrorState message={q.error instanceof ApiError ? q.error.message : 'Storm history is unavailable.'} /> : null}
      {q.data ? (
        <>
          <p className="text-xs text-muted-foreground">{q.data.note} Hail of 1.00 inch or larger and wind over 50 mph, from NOAA reports.</p>
          {q.data.locations.length === 0 ? <p className="text-sm text-muted-foreground">This record has no property address.</p> : null}
          {q.data.locations.map((l) => (
            <div key={`${l.propertyId}-${l.label}`} className="space-y-2" data-testid="storm-location">
              <p className="text-sm font-medium">{l.label} <span className="text-xs font-normal text-muted-foreground">{l.point ? `· ${l.locationSource === 'saved' ? 'saved location' : 'located from the address'}${l.accuracy ? ` (${l.accuracy})` : ''}` : ''}</span></p>
              {!l.result ? <p role="status" className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">Storm history is not available for this address: {l.unavailableReason ?? 'it could not be located.'}</p> : (
                <>
                  <p className="text-sm" data-testid="storm-summary">{l.result.summary.hailReports} hail and {l.result.summary.windReports} wind reports within {l.result.radiusMiles} mile{l.result.radiusMiles === 1 ? '' : 's'}{l.result.summary.maxHailInches ? ` · largest hail ${l.result.summary.maxHailInches.toFixed(2)} in` : ''}{l.result.summary.maxWindMph ? ` · strongest wind ${Math.round(l.result.summary.maxWindMph)} mph` : ''}</p>
                  <EventsTable events={l.result.data} />
                  {l.result.meta.total > l.result.data.length ? <p className="text-xs text-muted-foreground">Showing the newest {l.result.data.length} of {l.result.meta.total}. Use Hail &amp; wind search for the full list.</p> : null}
                </>
              )}
            </div>
          ))}
          <Disclaimer text={q.data.disclaimer} />
        </>
      ) : null}
    </section>
  );
}
