import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useEffect, useRef } from 'react';
import type { MapMarker, Zone } from './api';

export const HAIL_COLOR = '#2f6fb0';
export const WIND_COLOR = '#d99026';
const MILE = 1609.344;

const hailSize = (inches: number | null): number => Math.round(12 + Math.min(4, inches ?? 1) * 5);
const windSize = (mph: number | null): number => Math.round(12 + Math.min(40, Math.max(0, (mph ?? 50) - 50)) * 0.45);

function iconFor(m: MapMarker): L.DivIcon {
  if (m.t === 'hail') {
    const s = hailSize(m.h);
    return L.divIcon({ className: '', iconSize: [s, s], html: `<span style="display:block;width:${s}px;height:${s}px;border-radius:50%;background:${HAIL_COLOR};opacity:.85;border:2px solid #fff;box-shadow:0 0 0 1px ${HAIL_COLOR}"></span>` });
  }
  const s = windSize(m.w);
  return L.divIcon({ className: '', iconSize: [s, s], html: `<span style="display:block;width:${s}px;height:${s}px;background:${WIND_COLOR};opacity:.9;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 0 1px ${WIND_COLOR}"></span>` });
}

export type Draft = { kind: 'radius'; center: { lat: number; lng: number } | null; radiusMiles: number } | { kind: 'polygon'; points: Array<[number, number]> } | null;

export type StormMapProps = {
  tileUrl: string;
  attribution: string;
  center: [number, number];
  zoom: number;
  height?: string;
  markers?: MapMarker[];
  pin?: { lat: number; lng: number; label?: string } | null;
  circle?: { lat: number; lng: number; radiusMiles: number } | null;
  zones?: Zone[];
  draft?: Draft;
  /** Change this value to re-centre the map on `center`/`zoom`. */
  focusKey?: string | number;
  onBounds?: (bbox: string) => void;
  onMarkerClick?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  ariaLabel?: string;
};

export function StormMap(p: StormMapProps): React.ReactElement {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const cluster = useRef<L.MarkerClusterGroup | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: p.center, zoom: p.zoom, preferCanvas: true });
    L.tileLayer(p.tileUrl, { attribution: p.attribution, maxZoom: 18 }).addTo(m);
    cluster.current = L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false, chunkedLoading: true }).addTo(m);
    overlay.current = L.layerGroup().addTo(m);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = m.getBounds();
        cb.current.onBounds?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(','));
      }, 350);
    };
    m.on('moveend', report);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current.onMapClick?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    report();
    return () => { clearTimeout(timer); m.remove(); map.current = null; };
    // the map is created once; later changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.setView(p.center, p.zoom); }, [p.focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cluster.current;
    if (!c) return;
    c.clearLayers();
    const layers = (p.markers ?? []).map((m) => {
      const mk = L.marker([m.lat, m.lng], { icon: iconFor(m), keyboard: false });
      const label = m.t === 'hail' ? `${(m.h ?? 0).toFixed(2)} in hail` : m.w != null ? `${Math.round(m.w)} mph wind` : 'Wind report';
      mk.bindTooltip(`${label} · ${new Date(m.d).toLocaleDateString('en-US')}`);
      mk.on('click', () => cb.current.onMarkerClick?.(m.id));
      return mk;
    });
    c.addLayers(layers);
  }, [p.markers]);

  useEffect(() => {
    const o = overlay.current;
    if (!o) return;
    o.clearLayers();
    for (const z of p.zones ?? []) {
      const style = { color: '#c32930', weight: 2, fillOpacity: 0.07 };
      if (z.kind === 'radius' && z.center && z.radiusMiles) L.circle([z.center.lat, z.center.lng], { ...style, radius: z.radiusMiles * MILE }).bindTooltip(z.name).addTo(o);
      else if (z.kind === 'polygon' && z.polygon) L.polygon(z.polygon.map(([lng, lat]) => [lat, lng] as [number, number]), style).bindTooltip(z.name).addTo(o);
    }
    if (p.circle) L.circle([p.circle.lat, p.circle.lng], { color: '#3c3c3c', weight: 2, dashArray: '6 4', fillOpacity: 0.04, radius: p.circle.radiusMiles * MILE, interactive: false }).addTo(o);
    if (p.pin) L.marker([p.pin.lat, p.pin.lng], { icon: L.divIcon({ className: '', iconSize: [18, 18], html: '<span style="display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#c32930;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></span>' }), zIndexOffset: 1000 }).bindTooltip(p.pin.label ?? 'Property').addTo(o);
    const d = p.draft;
    if (d?.kind === 'radius' && d.center) L.circle([d.center.lat, d.center.lng], { color: '#16845b', weight: 2, dashArray: '4 4', fillOpacity: 0.1, radius: d.radiusMiles * MILE, interactive: false }).addTo(o);
    if (d?.kind === 'polygon' && d.points.length > 0) {
      const pts = d.points.map(([lng, lat]) => [lat, lng] as [number, number]);
      (d.points.length > 2 ? L.polygon(pts, { color: '#16845b', dashArray: '4 4', fillOpacity: 0.1, interactive: false }) : L.polyline(pts, { color: '#16845b', dashArray: '4 4', interactive: false })).addTo(o);
      for (const pt of pts) L.circleMarker(pt, { radius: 4, color: '#16845b', fillOpacity: 1, interactive: false }).addTo(o);
    }
  }, [p.zones, p.circle, p.pin, p.draft]);

  return <div ref={el} role="application" aria-label={p.ariaLabel ?? 'Storm map'} className="z-0 w-full overflow-hidden rounded-lg border border-border" style={{ height: p.height ?? '28rem', cursor: p.onMapClick ? 'crosshair' : undefined }} />;
}

export function MapLegend(): React.ReactElement {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs" aria-label="Map legend">
      <li className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white" style={{ background: HAIL_COLOR, boxShadow: `0 0 0 1px ${HAIL_COLOR}` }} />Hail report (larger dot = larger hail)</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rotate-45 border-2 border-white" style={{ background: WIND_COLOR, boxShadow: `0 0 0 1px ${WIND_COLOR}` }} />Wind report (larger diamond = stronger wind)</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 rounded-full bg-[#7aa6d6] text-center text-[9px] font-bold leading-[14px] text-white">5</span>Several nearby reports (zoom in to separate)</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 border-2 border-dashed border-foreground" />Search radius</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 border-2 border-brand" />Work zone</li>
    </ul>
  );
}
