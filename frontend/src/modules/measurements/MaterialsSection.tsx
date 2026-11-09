import { useState } from 'react';
import { cn } from '@/lib/cn';
import { ApiError } from '@/types/api';
import { useMaterials, useWorkspaceMutations, type MaterialFamily, type WasteRow } from './workspaceApi';

const n0 = (n: number): string => Math.round(n).toLocaleString('en-US');

export const MATERIAL_DISCLAIMER = 'Material calculations are estimates and must be verified before ordering. Actual quantities may vary based on installation method, product specifications, roof complexity and field conditions.';

const STATUS_TEXT: Record<MaterialFamily['status'], string> = { ready: 'Ready', unverified: 'Needs verified edges', missing: 'Measurement not available', no_product: 'No product configured' };

function WasteTable({ title, areaLabel, rows, selected, recommended, editable, onPick }: { title: string; areaLabel: string; rows: WasteRow[]; selected: number; recommended: number; editable: boolean; onPick: (p: number) => void }): React.ReactElement {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="p-2">{title}</th>
            {rows.map((r) => <th key={r.percent} className={cn('p-2 text-right', r.percent === selected && 'bg-brand-soft')}>{r.percent}%{r.percent === recommended ? <span className="block text-[10px] font-normal text-brand">Recommended</span> : null}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/60"><td className="p-2 font-medium">{areaLabel}</td>{rows.map((r) => <td key={r.percent} className={cn('p-2 text-right', r.percent === selected && 'bg-brand-soft font-medium')}>{n0(r.finalAreaSqFt)}</td>)}</tr>
          <tr className="border-b border-border/60"><td className="p-2 font-medium">Squares</td>{rows.map((r) => <td key={r.percent} className={cn('p-2 text-right', r.percent === selected && 'bg-brand-soft font-medium')}>{r.finalSquares.toFixed(1)}</td>)}</tr>
          {editable ? (
            <tr><td className="p-2 text-xs text-muted-foreground">Use for ordering</td>{rows.map((r) => (
              <td key={r.percent} className="p-1 text-right">
                {r.percent === selected ? <span className="text-xs text-brand">Selected</span> : <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" aria-label={`Select ${r.percent}% ${title.replace(' %', '').toLowerCase()}`} onClick={() => onPick(r.percent)}>Use</button>}
              </td>
            ))}</tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** Pitched and flat waste, then product-specific material quantities. Waste is applied once, to the base area, for ordering; catalog prices already include waste. */
export function MaterialsSection({ measurementId, editable }: { measurementId: string; editable: boolean }): React.ReactElement | null {
  const q = useMaterials(measurementId);
  const mut = useWorkspaceMutations(measurementId);
  const [err, setErr] = useState<string | null>(null);
  if (!q.data) return null;
  const m = q.data;
  async function choose(body: { percent?: number; flatPercent?: number }): Promise<void> {
    setErr(null);
    try { await mut.setWaste.mutateAsync(body); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not change waste.'); }
  }
  return (
    <section aria-label="Waste and materials" className="space-y-3">
      <h2 className="text-base font-semibold">Waste and materials</h2>
      <WasteTable title="Pitched waste %" areaLabel="Pitched area (sq ft)" rows={m.wasteTables.pitched} selected={m.wastePercent} recommended={m.recommended.pitched} editable={editable} onPick={(p) => void choose({ percent: p })} />
      {m.flatAreaSqFt > 0
        ? <WasteTable title="Flat waste %" areaLabel="Flat area (sq ft)" rows={m.wasteTables.flat} selected={m.flatWastePercent} recommended={m.recommended.flat} editable={editable} onPick={(p) => void choose({ flatPercent: p })} />
        : <p className="text-sm text-muted-foreground">Flat roof area: 0 sq ft. No flat-roof waste calculation applies.</p>}
      {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}
      <p className="text-xs text-muted-foreground">Recommended percentages are the company defaults, not supplier specifications. Waste is applied once; the customer price catalog already includes waste, so estimates use the base squares.</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Material quantities by product and waste</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="p-2">Product</th><th>Unit</th>
              {m.wasteColumns.map((w) => <th key={w} className="p-2 text-right">{w}% waste</th>)}
            </tr>
          </thead>
          <tbody>
            {m.families.map((f) => (
              <FamilyRows key={f.family} f={f} columns={m.wasteColumns} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{m.productsConfigured ? '' : 'No products are configured yet: rows marked * use placeholder coverage. Add your products in Integration settings. '}{MATERIAL_DISCLAIMER}</p>
    </section>
  );
}

function FamilyRows({ f, columns }: { f: MaterialFamily; columns: number[] }): React.ReactElement {
  const basis = columns.map((w) => f.basis[String(w)]);
  return (
    <>
      <tr className="border-b border-border/60 bg-muted/40">
        <th scope="rowgroup" colSpan={2} className="p-2 text-left">{f.label} <span className="font-normal text-muted-foreground">({f.basisLabel})</span></th>
        {f.status === 'ready' && f.unit !== 'each'
          ? basis.map((b, i) => <td key={columns[i]} className="p-2 text-right text-xs">{b === null || b === undefined ? '—' : `${n0(b)} ${f.unit === 'sqft' ? 'sq ft' : 'ft'}`}</td>)
          : <td colSpan={columns.length} className="p-2 text-right text-xs text-muted-foreground">{STATUS_TEXT[f.status]}</td>}
      </tr>
      {f.status !== 'ready' && f.blocking.length > 0 ? <tr className="border-b border-border/60"><td colSpan={2 + columns.length} className="p-2 text-xs text-muted-foreground">Not calculated: {f.blocking.join('; ')}</td></tr> : null}
      {f.notes.map((n) => <tr key={n} className="border-b border-border/60"><td colSpan={2 + columns.length} className="p-2 text-xs text-muted-foreground">Note: {n}</td></tr>)}
      {f.products.map((p) => (
        <tr key={`${f.family}-${p.id ?? p.name}`} className="border-b border-border/60">
          <td className="p-2">{[p.brand, p.name].filter(Boolean).join(' · ')}{p.specConfirmed ? '' : ' *'}</td>
          <td>{p.packageUnit}</td>
          {columns.map((w) => <td key={w} className="p-2 text-right font-medium">{p.packages[String(w)] ?? '—'}</td>)}
        </tr>
      ))}
    </>
  );
}
