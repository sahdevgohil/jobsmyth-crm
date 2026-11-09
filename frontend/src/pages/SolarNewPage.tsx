import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CustomerPropertyPicker } from '@/components/shared/EntityPickers';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { useSolarMutations, useSolarStatus, type AddressSearchResult } from '@/modules/measurements/solarApi';
import { ApiError } from '@/types/api';

type Pick =
  | { kind: 'crm'; propertyId: string; label: string }
  | { kind: 'geo'; label: string; line1: string; city: string; state: string; zip: string; latitude: number; longitude: number; precise: boolean };

const FALLBACK_CODES = new Set(['SOLAR_NOT_FOUND', 'SOLAR_NO_ROOF_DATA', 'SOLAR_NOT_CONFIGURED', 'SOLAR_LIMIT_REACHED', 'SOLAR_QUOTA_EXCEEDED', 'SOLAR_BILLING_DISABLED', 'SOLAR_AUTH_FAILED', 'SOLAR_API_DISABLED', 'SOLAR_TIMEOUT', 'SOLAR_NETWORK', 'SOLAR_BAD_RESPONSE', 'SOLAR_DISABLED']);

export function SolarNewPage(): React.ReactElement {
  const nav = useNavigate();
  const status = useSolarStatus();
  const mut = useSolarMutations();
  const canOrder = useHasPermission('measurements:order');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AddressSearchResult | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [owner, setOwner] = useState({ customerId: '', propertyId: '' });
  const [confirmApprox, setConfirmApprox] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(geocode: boolean): Promise<void> {
    setError(null);
    setSearching(true);
    try {
      setResults(await mut.search.mutateAsync({ q, geocode }));
    } catch (e) {
      setError({ code: e instanceof ApiError ? e.code : 'ERR', message: e instanceof ApiError ? e.message : 'Search failed.' });
    } finally {
      setSearching(false);
    }
  }

  async function run(): Promise<void> {
    if (!pick) return;
    setError(null);
    try {
      const body =
        pick.kind === 'crm'
          ? { propertyId: pick.propertyId }
          : { customerId: owner.customerId, address: { line1: pick.line1, city: pick.city, state: pick.state, zip: pick.zip }, latitude: pick.latitude, longitude: pick.longitude, confirmApproximate: confirmApprox || pick.precise };
      const r = await mut.run.mutateAsync(body);
      nav(`/app/measurements/${r.data.id}`);
    } catch (e) {
      setError({ code: e instanceof ApiError ? e.code : 'ERR', message: e instanceof ApiError ? e.message : 'Could not get roof data.' });
    }
  }

  if (!canOrder) return <p className="text-sm text-muted-foreground">You do not have permission to request automated measurements.</p>;
  const s = status.data;
  const ready = pick && (pick.kind === 'crm' || owner.customerId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Measure from address" description="Look up roof data from Google Solar for a property. Geocoding finds the address; the roof figures come from Google's roof segment data." />

      {s && s.state !== 'connected' && s.state !== 'configuration_required' ? (
        <p role="note" className="rounded-md border border-warning bg-warning/15 p-3 text-sm">
          {s.state === 'not_configured' ? 'Google Solar is not configured on the server yet, so automated lookups will not work. You can still ' : s.state === 'disabled' ? 'Automated measurements are turned off. You can still ' : 'The last Google connection test failed. You can try anyway, or '}
          <Link className="underline" to="/app/measurements/new">enter a measurement manually</Link>.
        </p>
      ) : null}

      <section aria-labelledby="s1" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 id="s1" className="text-base font-semibold">1. Find the property</h2>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Property address" placeholder="Street address, city, ZIP" className="h-11 min-w-64 flex-1 text-base" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim().length >= 3) void search(false); }} />
          <Button type="button" className="h-11" disabled={q.trim().length < 3 || searching} onClick={() => void search(false)}>Search CRM</Button>
          <Button type="button" variant="outline" className="h-11" disabled={q.trim().length < 5 || searching} onClick={() => void search(true)}>Look up address (Google)</Button>
        </div>
        <p className="text-xs text-muted-foreground">Searching the CRM is free. “Look up address” uses one Google Geocoding request.</p>
        {results ? (
          <div className="space-y-3">
            {results.crm.length > 0 ? (
              <div><h3 className="mb-1 text-sm font-medium">Properties in the CRM</h3>
                <ul className="divide-y divide-border rounded-md border border-border">{results.crm.map((c) => (
                  <li key={c.propertyId}><button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPick({ kind: 'crm', propertyId: c.propertyId, label: c.label })}><span>{c.label}</span><span className="text-xs text-muted-foreground">{c.latitude === null ? 'no pin yet' : 'pin saved'}</span></button></li>
                ))}</ul></div>
            ) : <p className="text-sm text-muted-foreground">No matching property in the CRM.</p>}
            {results.geocoded.length > 0 ? (
              <div><h3 className="mb-1 text-sm font-medium">Address matches</h3>
                <ul className="divide-y divide-border rounded-md border border-border">{results.geocoded.map((g, i) => (
                  <li key={i}><button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPick({ kind: 'geo', label: g.formattedAddress, line1: g.line1, city: g.city, state: g.state, zip: g.zip, latitude: g.latitude, longitude: g.longitude, precise: g.precise })}><span>{g.formattedAddress}</span><span className="text-xs text-muted-foreground">{g.precise ? 'precise' : 'approximate'}</span></button></li>
                ))}</ul></div>
            ) : null}
          </div>
        ) : null}
      </section>

      {pick ? (
        <section aria-labelledby="s2" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 id="s2" className="text-base font-semibold">2. Confirm</h2>
          <p className="text-sm"><strong>{pick.label}</strong></p>
          {pick.kind === 'geo' ? (
            <>
              <p className="text-sm text-muted-foreground">Choose the customer this property belongs to. If the address already exists for that customer, it is reused (no duplicate).</p>
              <CustomerPropertyPicker customerId={owner.customerId} propertyId={owner.propertyId} onChange={setOwner} requireProperty={false} />
              <p className="text-xs text-muted-foreground">Pin: {pick.latitude.toFixed(5)}, {pick.longitude.toFixed(5)}</p>
              {!pick.precise ? (
                <label className="flex items-start gap-2 rounded-md border border-warning bg-warning/15 p-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmApprox} onChange={(e) => setConfirmApprox(e.target.checked)} /> Google could only place this address approximately. I confirm the pin is on the correct building.</label>
              ) : null}
            </>
          ) : null}
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            <li>This sends one Google Solar request (a second only if HIGH quality imagery is unavailable and BASE quality is tried).</li>
            <li>A recent measurement for the same property is reused instead of requesting again.</li>
            <li>Roof area and pitch come from Google. Ridge, hip, valley, eave and rake lengths are <strong>not</strong> provided and must be entered manually.</li>
          </ul>
          <Button type="button" className="h-12" disabled={!ready || mut.run.isPending || (pick.kind === 'geo' && !pick.precise && !confirmApprox)} onClick={() => void run()}>
            {mut.run.isPending ? 'Getting roof data…' : 'Get roof measurements'}
          </Button>
        </section>
      ) : null}

      {error ? (
        <section role="alert" className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="font-medium text-danger">{error.message}</p>
          {FALLBACK_CODES.has(error.code) ? (
            <div>
              <p className="mb-2">No measurements were saved and nothing was estimated. You can:</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline"><Link to={`/app/measurements/new${pick?.kind === 'crm' ? `?propertyId=${pick.propertyId}` : ''}`}>Enter measurements manually</Link></Button>
                {pick?.kind === 'crm' ? <Button asChild size="sm" variant="outline"><Link to={`/app/properties/${pick.propertyId}`}>Upload an existing report on the property</Link></Button> : null}
                <Button type="button" size="sm" variant="outline" onClick={() => void run()}>Try again</Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
