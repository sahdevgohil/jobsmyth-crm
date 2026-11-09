import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { dollars, useCatalogs, usePricingMutations, type Catalog } from '@/modules/pricing/api';
import { ApiError } from '@/types/api';

function CatalogView({ c }: { c: Catalog }): React.ReactElement {
  const m = usePricingMutations();
  const canApprove = useHasPermission('pricing:approve');
  const [err, setErr] = useState<string | null>(null);
  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-4" aria-label={`${c.name} version ${c.version}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{c.name} <span className="font-normal text-muted-foreground">v{c.version}</span></h2>
        <StatusBadge status={c.status} tone={c.status === 'approved' ? 'success' : 'warning'} />
        {c.status === 'draft' && canApprove ? (
          <Button type="button" size="sm" disabled={m.approveCatalog.isPending} onClick={() => m.approveCatalog.mutateAsync(c.id).catch((e: unknown) => setErr(e instanceof ApiError ? e.message : 'Could not approve.'))}>Approve prices</Button>
        ) : null}
        <Button asChild size="sm" variant="outline"><Link to={`/app/quote?catalogId=${c.id}`}>Build a quote</Link></Button>
      </div>
      {c.status !== 'approved' ? <p role="note" className="rounded-md border border-warning bg-warning/15 p-3 text-sm">Draft, unapproved prices from the client's price sheet. Quotes can be prepared, but estimates from this catalog cannot become proposals until the client approves the prices.</p> : null}
      {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}
      <p className="text-sm text-muted-foreground">{c.sourceNote || c.source} Tax: {c.taxRateBps === null ? 'not set (pending confirmation)' : `${c.taxRateBps / 100}%`}. Quotes are valid {c.validityDays} days.</p>

      <div className="grid gap-3 md:grid-cols-3">
        {c.packages.map((p) => (
          <div key={p.key} className="rounded-md border border-border p-3">
            <h3 className="font-medium">{p.name}</h3>
            <p className="text-sm">{dollars(p.perSquareLowCents)}–{dollars(p.perSquareHighCents)} per square</p>
            <p className="mt-1 text-xs text-muted-foreground">{p.warrantyYears ? `${p.warrantyYears}-year warranty${p.warrantyIsPlaceholder ? ' (placeholder, not confirmed)' : ''}` : 'Warranty not set'}{p.manufacturerEligibility ? ` · ${p.manufacturerEligibility}` : ''}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Line items per package</caption>
          <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2 pr-3">Item</th><th className="pr-3">Unit</th><th className="pr-3 text-right">Good</th><th className="pr-3 text-right">Better</th><th className="text-right">Best</th></tr></thead>
          <tbody>
            {c.items.map((i) => (
              <tr key={i.key} className="border-b border-border/60">
                <td className="py-2 pr-3">{i.name}{i.optional ? <span className="text-muted-foreground"> (optional)</span> : null}</td>
                <td className="pr-3">{i.unit}</td>
                {(['good', 'better', 'best'] as const).map((k) => <td key={k} className="pr-3 text-right last:pr-0">{i.rates[k] === null ? 'Included' : dollars(i.rates[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Conditional charges ({c.conditionalCharges.length})</summary>
        <ul className="mt-2 list-disc pl-5 text-sm">{c.conditionalCharges.map((x) => <li key={x.key}>{x.name}: {x.rateCents === null ? 'at cost' : `${dollars(x.rateCents)} / ${x.unit}`}</li>)}</ul>
      </details>
    </article>
  );
}

export function PriceCatalogPage(): React.ReactElement {
  const q = useCatalogs();
  const m = usePricingMutations();
  const canManage = useHasPermission('pricing:approve');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer price catalog"
        description="Good / Better / Best roofing prices. Customer-facing only: subcontractor costs are kept separately."
        actions={canManage ? <Button type="button" variant="outline" disabled={m.install.isPending} onClick={() => void m.install.mutateAsync()}>Install client price sheet</Button> : null}
      />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Could not load the price catalog." onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <EmptyState title="No price catalog yet" description="Install the client price sheet. It arrives as an unapproved draft." /> : null}
      {q.data?.map((c) => <CatalogView key={c.id} c={c} />)}
    </div>
  );
}
