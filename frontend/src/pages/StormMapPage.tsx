import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RADII, useMapEvents, useStormStatus, useZones, type EventFilters } from '@/modules/storm/api';
import { Disclaimer, EventDetailCard, EventFilterBar } from '@/modules/storm/components';
import { MapLegend, StormMap } from '@/modules/storm/StormMap';
import { apiFetch } from '@/services/http';

export function StormMapPage(): React.ReactElement {
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState<EventFilters>({});
  const [bbox, setBbox] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(sp.get('event'));
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState(5);
  const [focus, setFocus] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [view, setView] = useState<{ center: [number, number]; zoom: number; key: number }>({ center: [32.78, -96.8], zoom: 9, key: 0 });
  const [error, setError] = useState<string | null>(null);
  const [showZones, setShowZones] = useState(true);
  const status = useStormStatus();
  const zones = useZones();
  const markers = useMapEvents(bbox, filters);

  async function locate(): Promise<void> {
    setError(null);
    try {
      const r = await apiFetch<{ data: { latitude: number; longitude: number; formattedAddress: string; precise: boolean } }>(`/storm/geocode?address=${encodeURIComponent(address.trim())}`);
      setFocus({ lat: r.data.latitude, lng: r.data.longitude, label: r.data.formattedAddress || address });
      setView({ center: [r.data.latitude, r.data.longitude], zoom: radius <= 3 ? 12 : 11, key: view.key + 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Address lookup failed.');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Storm map" description="Hail and wind reports on a map. Pan and zoom to load reports for the area you are looking at." />
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-2 lg:grid-cols-[1fr_auto_auto]">
          <label className="text-xs text-muted-foreground">Go to an address<Input aria-label="Go to address" className="mt-1 h-9" placeholder="Street, city, state" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Radius shown<select aria-label="Map radius" className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{RADII.map((r) => <option key={r} value={r}>{r} mile{r === 1 ? '' : 's'}</option>)}</select></label>
          <div className="flex items-end"><Button type="button" variant="outline" className="h-9" disabled={address.trim().length < 5} onClick={() => void locate()}>Go</Button></div>
        </div>
        <EventFilterBar value={filters} onChange={setFilters} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} /> Show work zones</label>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
      <StormMap
        tileUrl={status.data?.mapTileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'} attribution={status.data?.mapAttribution ?? ''}
        center={view.center} zoom={view.zoom} focusKey={view.key} height="34rem" markers={markers.data?.data ?? []} onBounds={setBbox} onMarkerClick={setSelected}
        pin={focus} circle={focus ? { lat: focus.lat, lng: focus.lng, radiusMiles: radius } : null} zones={showZones ? zones.data ?? [] : []} ariaLabel="Map of hail and wind reports" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MapLegend />
        <p className="text-xs text-muted-foreground" data-testid="map-count">{markers.isFetching ? 'Loading reports…' : markers.isError ? 'Could not load reports for this view. Zoom in and try again.' : markers.data ? `${markers.data.data.length} of ${markers.data.total} reports in view` : ''}</p>
      </div>
      {markers.data?.note ? <p role="status" className="text-xs text-muted-foreground">{markers.data.note}</p> : null}
      {selected ? <EventDetailCard id={selected} onClose={() => setSelected(null)} /> : <Disclaimer />}
    </div>
  );
}
