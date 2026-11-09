import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { dollars, useRateCards, usePricingMutations, type Rate, type RateCard } from '@/modules/pricing/api';
import { ApiError } from '@/types/api';

function Card({ c }: { c: RateCard }): React.ReactElement {
  const m = usePricingMutations();
  const canManage = useHasPermission('costs:manage');
  const canApprove = useHasPermission('pricing:approve');
  const [rates, setRates] = useState<Rate[]>(c.rates);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setRates(c.rates), [c.rates]);
  const dirty = JSON.stringify(rates) !== JSON.stringify(c.rates);
  const groups = [...new Set(rates.map((r) => r.category))];

  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Request failed.' });
    }
  }

  return (
    <article className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label={`${c.name} version ${c.version}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{c.name} <span className="font-normal text-muted-foreground">v{c.version}</span></h2>
        <StatusBadge status={c.status} tone={c.status === 'approved' ? 'success' : 'warning'} />
        {canManage && dirty ? <Button size="sm" type="button" onClick={() => void run(() => m.updateRateCard.mutateAsync({ id: c.id, rates }), c.status === 'approved' ? 'Saved as a new draft version.' : 'Saved.')}>Save rate changes</Button> : null}
        {canApprove && c.status === 'draft' && !dirty ? <Button size="sm" variant="outline" type="button" onClick={() => void run(() => m.approveRateCard.mutateAsync(c.id), 'Approved.')}>Approve rates</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">Internal cost document. Not customer pricing. {c.inclusionsNote}</p>
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.text}</p> : null}
      {groups.map((g) => (
        <details key={g} open={groups.length <= 3}>
          <summary className="cursor-pointer text-sm font-medium">{g}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <tbody>
                {rates.filter((r) => r.category === g).map((r) => (
                  <tr key={r.key} className="border-b border-border/60">
                    <td className="py-1.5 pr-3">{r.name}{r.notes ? <span className="block text-xs text-muted-foreground">{r.notes}</span> : null}</td>
                    <td className="pr-3">{r.unit}</td>
                    <td className="w-32 text-right">
                      {r.rateCents === null ? <span>{dollars(r.minCents)}–{dollars(r.maxCents)}</span> : canManage ? (
                        <Input aria-label={`${r.name} rate`} type="number" step="0.01" inputMode="decimal" className="h-8 text-right" value={(r.rateCents / 100).toFixed(2)} onChange={(e) => setRates(rates.map((x) => (x.key === r.key ? { ...x, rateCents: Math.round(Number(e.target.value) * 100) } : x)))} />
                      ) : dollars(r.rateCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </article>
  );
}

export function RateCardsPage(): React.ReactElement {
  const q = useRateCards();
  return (
    <div className="space-y-4">
      <PageHeader title="Subcontractor rate cards" description="What we pay subcontractors. Internal only: never shown to customers." />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Could not load rate cards." onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <EmptyState title="No rate cards yet" description="Install the client price sheet on the Customer price catalog page; it includes the subcontractor price list as a draft." /> : null}
      {q.data?.map((c) => <Card key={c.id} c={c} />)}
    </div>
  );
}
