import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { ApiError } from '@/types/api';
import { dollars, pct, useCostSheet, useRateCards, useSaveCostSheet, type CostLine } from './api';

type Row = CostLine & { key: string };
const uid = (): string => Math.random().toString(36).slice(2, 10);

/** INTERNAL: subcontractor/material cost and gross margin for one estimate. Never shown to customers or in PDFs. */
export function CostPanel({ estimateId }: { estimateId: string }): React.ReactElement | null {
  const canView = useHasPermission('costs:view');
  const canManage = useHasPermission('costs:manage');
  const canMargin = useHasPermission('margins:view');
  const sheet = useCostSheet(estimateId, canView);
  const cards = useRateCards(canView);
  const save = useSaveCostSheet(estimateId);
  const [rows, setRows] = useState<Row[]>([]);
  const [cardId, setCardId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (sheet.data) setRows(sheet.data.lines.map((l) => ({ ...l, key: l.id })));
  }, [sheet.data]);

  if (!canView) return null;
  const card = cards.data?.find((c) => c.id === cardId) ?? cards.data?.[0];
  const rate = (k: string): { unit: string; cents: number | null; name: string } | undefined => {
    const r = card?.rates.find((x) => x.key === k);
    return r ? { unit: r.unit, cents: r.rateCents, name: r.name } : undefined;
  };
  const patch = (key: string, p: Partial<CostLine>): void => setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function persist(): Promise<void> {
    setMsg(null);
    try {
      await save.mutateAsync(rows.map(({ key: _k, ...l }) => ({
        kind: l.kind, description: l.description, unit: l.unit, quantity: l.quantity, unitCostCents: l.unitCostCents,
        rateCardId: l.rateCardId, rateKey: l.rateKey, overridden: l.overridden, overrideReason: l.overrideReason,
      })));
      setMsg({ ok: true, text: 'Costs saved.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not save costs.' });
    }
  }

  const d = sheet.data;
  return (
    <section aria-labelledby="cost-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 id="cost-h" className="font-medium">Internal costs and margin</h2>
        <p className="text-xs text-muted-foreground">Internal only. Not shown to customers, proposals or PDFs.</p>
      </div>
      {cards.data && cards.data.length > 0 ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">Rate card
          <select className="h-9 rounded-md border border-border bg-card px-2" value={card?.id ?? ''} onChange={(e) => setCardId(e.target.value)}>
            {cards.data.map((c) => <option key={c.id} value={c.id}>{c.name} v{c.version} ({c.status})</option>)}
          </select>
        </label>
      ) : null}
      {card && card.status !== 'approved' ? <p className="text-xs text-muted-foreground">This rate card is a draft. Costs from it are estimates until the rates are approved.</p> : null}

      <div className="space-y-2">
        {rows.map((r) => {
          const picked = r.rateKey ? rate(r.rateKey) : undefined;
          return (
            <div key={r.key} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-12">
              <select aria-label="Cost type" className="h-9 rounded-md border border-border bg-card px-2 text-sm sm:col-span-2" disabled={!canManage} value={r.kind} onChange={(e) => patch(r.key, { kind: e.target.value as CostLine['kind'] })}>
                <option value="subcontractor">Subcontractor</option><option value="material">Material</option><option value="other">Other</option>
              </select>
              {r.kind === 'subcontractor' && card ? (
                <select aria-label="Rate" className="h-9 rounded-md border border-border bg-card px-2 text-sm sm:col-span-4" disabled={!canManage} value={r.rateKey ?? ''}
                  onChange={(e) => { const x = rate(e.target.value); patch(r.key, { rateCardId: card.id, rateKey: e.target.value || undefined, description: x?.name ?? r.description, unit: x?.unit ?? r.unit, unitCostCents: x?.cents ?? r.unitCostCents, overridden: false }); }}>
                  <option value="">Choose a rate…</option>
                  {card.rates.map((x) => <option key={x.key} value={x.key}>{x.name} ({x.unit})</option>)}
                </select>
              ) : <Input aria-label="Description" className="h-9 sm:col-span-4" disabled={!canManage} value={r.description ?? ''} onChange={(e) => patch(r.key, { description: e.target.value })} />}
              <Input aria-label="Quantity" type="number" inputMode="decimal" className="h-9 sm:col-span-1" disabled={!canManage} value={r.quantity} onChange={(e) => patch(r.key, { quantity: Number(e.target.value) })} />
              <Input aria-label="Unit cost ($)" type="number" inputMode="decimal" step="0.01" className="h-9 sm:col-span-2" disabled={!canManage}
                value={r.unitCostCents === undefined ? '' : (r.unitCostCents / 100).toFixed(2)}
                onChange={(e) => patch(r.key, { unitCostCents: Math.round(Number(e.target.value) * 100), overridden: Boolean(picked && picked.cents !== Math.round(Number(e.target.value) * 100)) || r.overridden })} />
              <span className="self-center text-right text-sm sm:col-span-2">{dollars(Math.round((r.unitCostCents ?? 0) * r.quantity))}</span>
              {canManage ? <button type="button" aria-label="Remove cost line" className="justify-self-end rounded p-1.5 text-danger hover:bg-muted sm:col-span-1" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></button> : null}
              {r.overridden ? <Input aria-label="Reason for changing the rate" placeholder="Reason for changing the rate (required)" className="h-9 sm:col-span-12" disabled={!canManage} value={r.overrideReason ?? ''} onChange={(e) => patch(r.key, { overrideReason: e.target.value })} /> : null}
            </div>
          );
        })}
      </div>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setRows([...rows, { key: uid(), kind: 'subcontractor', quantity: 0 }])}><Plus className="h-4 w-4" aria-hidden /> Add cost line</Button>
          <Button type="button" size="sm" disabled={save.isPending} onClick={() => void persist()}>Save costs</Button>
        </div>
      ) : null}
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.text}</p> : null}

      {d ? (
        <dl className="max-w-sm space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subcontractor</dt><dd>{dollars(d.subcontractorCostCents)}</dd></div>
          <div className="flex justify-between"><dt>Materials</dt><dd>{dollars(d.materialCostCents)}</dd></div>
          <div className="flex justify-between"><dt>Other</dt><dd>{dollars(d.otherCostCents)}</dd></div>
          <div className="flex justify-between border-t border-border pt-1 font-medium"><dt>Total cost</dt><dd>{dollars(d.totalCostCents)}</dd></div>
          {canMargin && d.sellingPriceCents !== undefined ? (
            <>
              <div className="flex justify-between"><dt>Selling price (after discount)</dt><dd>{dollars(d.sellingPriceCents)}</dd></div>
              <div className="flex justify-between"><dt>Gross profit</dt><dd>{dollars(d.grossProfitCents)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Gross margin</dt><dd>{pct(d.marginBps)}</dd></div>
              <p className="text-xs text-muted-foreground">Gross margin = profit ÷ selling price (not markup).</p>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
