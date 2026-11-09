import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerPropertyPicker } from '@/components/shared/EntityPickers';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useEstimateInputs } from '@/modules/measurements/solarApi';
import { dollars, useCatalogs, usePricingMutations, type PackageKey, type Quote, type QuoteInput } from '@/modules/pricing/api';
import { ApiError } from '@/types/api';

const num = (s: string): number | undefined => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s));

export function QuoteBuilderPage(): React.ReactElement {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const catalogs = useCatalogs();
  const m = usePricingMutations();
  const [catalogId, setCatalogId] = useState(sp.get('catalogId') ?? '');
  const [target, setTarget] = useState({ customerId: sp.get('customerId') ?? '', propertyId: sp.get('propertyId') ?? '' });
  const [pkg, setPkg] = useState<PackageKey>('better');
  const [f, setF] = useState({ squares: sp.get('squares') ?? '', pitch: '', stories: '1', extraLayers: '0', osb: '', plywood: '', reDeck: '', permit: '', discount: '', tax: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const measurementId = sp.get('measurementId') ?? undefined;
  const mInputs = useEstimateInputs(measurementId);
  const [prefilled, setPrefilled] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  if (mInputs.data && !prefilled) {
    setPrefilled(true);
    // Only verified measurements are filled in automatically; unverified ones are offered below.
    setQty(Object.fromEntries((mInputs.data.suggestedQuantities ?? []).filter((q) => q.status === 'verified').map((q) => [q.basis, String(q.quantity)])));
    setF((cur) => ({ ...cur, squares: mInputs.data.squares ? String(mInputs.data.squares) : cur.squares, pitch: mInputs.data.pitch ?? cur.pitch }));
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>): void => setF({ ...f, [k]: e.target.value });

  if (catalogs.isLoading) return <LoadingState />;
  if (catalogs.isError || !catalogs.data) return <ErrorState message="Could not load price catalogs." />;
  const catalog = catalogs.data.find((c) => c.id === catalogId) ?? catalogs.data.find((c) => c.status === 'approved') ?? catalogs.data[0];
  if (!catalog) return <ErrorState message="No price catalog exists yet. An administrator can install the client price sheet under Customer price catalog." />;

  const input = (): QuoteInput | null => {
    const squares = num(f.squares);
    if (!squares || squares <= 0) return null;
    return {
      package: pkg, squares, pitch: f.pitch || undefined, stories: num(f.stories), extraLayers: num(f.extraLayers),
      osbSheets: num(f.osb), plywoodSheets: num(f.plywood), reDeckSquares: num(f.reDeck),
      permitCents: num(f.permit) === undefined ? undefined : Math.round((num(f.permit) as number) * 100),
      discountCents: num(f.discount) === undefined ? undefined : Math.round((num(f.discount) as number) * 100),
      taxRateBps: num(f.tax) === undefined ? undefined : Math.round((num(f.tax) as number) * 100),
      quantities: Object.fromEntries(Object.entries(qty).filter(([, v]) => num(v) !== undefined && (num(v) as number) >= 0).map(([k, v]) => [k, num(v) as number])),
    };
  };

  async function run(): Promise<void> {
    setErr(null);
    const i = input();
    if (!i) return setErr('Enter the roof size in squares (1 square = 100 sq ft).');
    try {
      setQuote(await m.quote.mutateAsync({ catalogId: catalog!.id, input: i }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not calculate the quote.');
    }
  }

  async function createEstimate(): Promise<void> {
    const i = input();
    if (!i || !target.customerId || !target.propertyId) return setErr('Choose a customer and property first.');
    try {
      const r = await m.createEstimate.mutateAsync({ catalogId: catalog!.id, customerId: target.customerId, propertyId: target.propertyId, measurementId, quote: i });
      nav(`/app/estimates/${r.estimate.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not create the estimate.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Good / Better / Best quote" description="Price a roof from the customer catalog. Totals are an estimate; the final price is confirmed after inspection." />
      {catalog.status !== 'approved' ? <p role="note" className="rounded-md border border-warning bg-warning/15 p-3 text-sm">This catalog is a draft and not approved. You can price it, but the estimate cannot be sent as a proposal until prices are approved.</p> : null}
      {catalogs.data.length > 1 ? (
        <select aria-label="Catalog" className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={catalog.id} onChange={(e) => { setCatalogId(e.target.value); setQuote(null); }}>
          {catalogs.data.map((c) => <option key={c.id} value={c.id}>{c.name} v{c.version} ({c.status})</option>)}
        </select>
      ) : null}

      {mInputs.data ? (
        <section aria-label="Measurement used" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
          <p><strong>Using measurement revision {mInputs.data.revision}</strong> ({mInputs.data.source === 'google_solar' ? 'Google Solar' : mInputs.data.isDemo ? 'demonstration data' : 'manual'}): {mInputs.data.squares} base squares{mInputs.data.pitch ? `, pitch ${mInputs.data.pitch}` : ''}. {mInputs.data.wasteNote}</p>
          {mInputs.data.warnings.map((w) => <p key={w} className="text-warning">{w}</p>)}
          <details><summary className="cursor-pointer font-medium">Enter these yourself ({mInputs.data.missing.length})</summary>
            <ul className="mt-1 list-disc pl-5">{mInputs.data.missing.map((x) => <li key={x.key}><strong>{x.label}</strong>: {x.reason}</li>)}</ul></details>
        </section>
      ) : null}
      <div role="radiogroup" aria-label="Package" className="grid gap-3 md:grid-cols-3">
        {catalog.packages.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={pkg === p.key} onClick={() => { setPkg(p.key); setQuote(null); }}
            className={cn('rounded-lg border p-4 text-left', pkg === p.key ? 'border-brand bg-brand-soft ring-2 ring-brand' : 'border-border bg-card')}>
            <span className="block font-semibold">{p.name}</span>
            <span className="block text-sm">{dollars(p.perSquareLowCents)}–{dollars(p.perSquareHighCents)} / square</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {([['squares', 'Roof squares', 'decimal'], ['pitch', 'Pitch (e.g. 8/12)', 'text'], ['stories', 'Stories', 'numeric'], ['extraLayers', 'Extra tear-off layers', 'numeric'], ['osb', 'OSB sheets', 'decimal'], ['plywood', 'Plywood sheets', 'decimal'], ['reDeck', 'Re-deck squares', 'decimal'], ['permit', 'Permit / city fees ($, at cost)', 'decimal'], ['discount', 'Discount ($)', 'decimal'], ['tax', 'Tax rate (%) — leave blank if unknown', 'decimal']] as const).map(([k, label, mode]) => (
          <label key={k} className="space-y-1 text-sm font-medium">{label}<Input inputMode={mode} value={f[k]} onChange={set(k)} className="h-11 text-base" /></label>
        ))}
      </div>
      <section aria-label="Measured quantities" className="space-y-2 rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-semibold">Measured quantities (optional)</h2>
        <p className="text-xs text-muted-foreground">Used for per-unit catalog lines. Leave blank to leave a line out. Values from verified measurements are filled in for you.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {([['drip_edge_lf', 'Drip edge (ft)'], ['starter_lf', 'Starter strip (ft)'], ['ridge_lf', 'Hip and ridge cap (ft)'], ['ridge_vent_lf', 'Ridge vent (ft)'], ['step_flashing_lf', 'Step flashing (ft)'], ['headwall_lf', 'Headwall flashing (ft)'], ['leak_barrier_sq', 'Leak barrier (SQ)'], ['pipe_boots', 'Pipe boots'], ['box_vents', 'Box vents'], ['exhaust_caps', 'Exhaust caps'], ['chimney_kits', 'Chimney kits']] as const).map(([k, label]) => (
            <label key={k} className="space-y-1 text-sm font-medium">{label}<Input inputMode="decimal" className="h-10" value={qty[k] ?? ''} onChange={(e) => setQty({ ...qty, [k]: e.target.value })} /></label>
          ))}
        </div>
        {(mInputs.data?.suggestedQuantities ?? []).filter((q) => q.status === 'unverified' && qty[q.basis] === undefined).length > 0 ? (
          <div className="rounded-md bg-warning/15 p-2 text-sm">
            <p className="font-medium">Suggested from unverified edges (confirm on site before using):</p>
            <ul className="mt-1 space-y-1">{(mInputs.data?.suggestedQuantities ?? []).filter((q) => q.status === 'unverified' && qty[q.basis] === undefined).map((q) => (
              <li key={q.basis} className="flex flex-wrap items-center gap-2">{q.label}: {q.quantity} ({q.from})<Button type="button" size="sm" variant="outline" onClick={() => setQty({ ...qty, [q.basis]: String(q.quantity) })}>Use this value</Button></li>))}</ul>
          </div>
        ) : null}
      </section>
      <Button type="button" className="h-12" disabled={m.quote.isPending} onClick={() => void run()}>Calculate</Button>
      {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}

      {quote ? (
        <section aria-label="Quote result" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Estimated range for this package: <strong>{dollars(quote.rangeLowCents)}–{dollars(quote.rangeHighCents)}</strong>. Calculated total below.</p>
          {quote.warnings.map((w) => <p key={w} role="note" className="rounded bg-warning/15 p-2 text-sm">{w}</p>)}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2">Item</th><th>Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{quote.lines.map((l) => (
                <tr key={l.key} className="border-b border-border/60"><td className="py-1.5">{l.description}{l.conditional ? <span className="text-muted-foreground"> (added charge)</span> : null}</td><td>{l.included ? 'Included' : `${l.quantity} ${l.unit}`}</td><td className="text-right">{l.included ? '' : dollars(l.unitCostCents)}</td><td className="text-right">{l.included ? '' : dollars(l.amountCents)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <dl className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{dollars(quote.subtotalCents)}</dd></div>
            {quote.discountCents > 0 ? <div className="flex justify-between"><dt>Discount</dt><dd>−{dollars(quote.discountCents)}</dd></div> : null}
            <div className="flex justify-between"><dt>Tax</dt><dd>{quote.taxRateBps === null ? 'Not calculated' : dollars(quote.taxCents)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd>{dollars(quote.totalCents)}</dd></div>
          </dl>
          {quote.draftWarning ? <p className="text-sm text-muted-foreground">{quote.draftWarning}</p> : null}
          <div className="border-t border-border pt-4">
            <h2 className="mb-2 text-base font-semibold">Create an estimate from this quote</h2>
            <CustomerPropertyPicker customerId={target.customerId} propertyId={target.propertyId} onChange={setTarget} />
            <Button type="button" className="mt-3 h-12" disabled={!target.customerId || !target.propertyId || m.createEstimate.isPending} onClick={() => void createEstimate()}>Create estimate</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
