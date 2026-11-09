import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHasPermission } from '@/lib/permissions';
import {
  bpsToPercent,
  centsToDollars,
  dollarsToCents,
  formatCents,
  percentToBps,
} from '@/lib/money';
import {
  openEstimatePreview,
  useDuplicateEstimate,
  useEstimate,
  useEstimateCatalog,
  useUpdateEstimate,
  useVoidEstimate,
} from '@/modules/estimates/api';
import { useCreateProposal } from '@/modules/proposals/api';
import {
  draftsFromEstimate,
  draftsToPayload,
  type LineDraft,
} from '@/modules/estimates/lineDrafts';
import { LineItemEditor } from '@/modules/estimates/LineItemEditor';
import { CostPanel } from '@/modules/pricing/CostPanel';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function EstimateDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.accessToken);
  const canUpdate = useHasPermission('estimates:update');
  const canCreate = useHasPermission('estimates:create');
  const canCreateProposal = useHasPermission('proposals:create');
  const estimate = useEstimate(id);
  const catalog = useEstimateCatalog();
  const update = useUpdateEstimate(id);
  const duplicate = useDuplicateEstimate(id);
  const voidEstimate = useVoidEstimate(id);
  const createProposal = useCreateProposal();
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [form, setForm] = useState({ discountDollars: '0.00', taxPercent: '0.00', notes: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const row = estimate.data?.data;
    if (!row) return;
    setLines(draftsFromEstimate(row.lineItems));
    setForm({
      discountDollars: centsToDollars(row.discountCents),
      taxPercent: bpsToPercent(row.taxRateBps),
      notes: row.notes,
    });
  }, [estimate.data?.data]);

  if (estimate.isLoading) return <LoadingState />;
  if (estimate.isError || !estimate.data) {
    return (
      <ErrorState
        message={estimate.error instanceof ApiError ? estimate.error.message : 'Not found.'}
        onRetry={() => void estimate.refetch()}
      />
    );
  }

  const row = estimate.data.data;
  const editable = row.status === 'draft' && canUpdate;

  function fail(err: unknown, fallback: string): void {
    setMsg(null);
    setError(err instanceof ApiError ? err.message : fallback);
  }

  function save(extra: Record<string, unknown> = {}): Promise<unknown> {
    setError(null);
    setMsg(null);
    return update.mutateAsync({
      lineItems: draftsToPayload(lines),
      discountCents: dollarsToCents(form.discountDollars),
      taxRateBps: percentToBps(form.taxPercent),
      notes: form.notes,
      ...extra,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Estimate ${row.number}`}
        description={`Version ${row.version} · ${row.status}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/app/estimates">Back</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void openEstimatePreview(id, token).catch((err) =>
                  setError(err instanceof Error ? err.message : 'Preview failed'),
                )
              }
            >
              Printable preview
            </Button>
          </div>
        }
      />

      <p className="text-sm">
        <Link className="text-brand underline" to={`/app/customers/${row.customerId}`}>
          Customer
        </Link>
        {' · '}
        <Link className="text-brand underline" to={`/app/properties/${row.propertyId}`}>
          Property
        </Link>
        {row.inspectionId ? (
          <>
            {' · '}
            <Link className="text-brand underline" to={`/app/inspections/${row.inspectionId}`}>
              Inspection
            </Link>
          </>
        ) : null}
        {row.measurementId ? (
          <>
            {' · '}
            <Link className="text-brand underline" to={`/app/measurements/${row.measurementId}`}>
              Measurement
            </Link>
          </>
        ) : null}
      </p>

      {row.status !== 'draft' ? (
        <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          Only draft estimates can be edited. Duplicate this estimate to make changes.
        </p>
      ) : null}

      <form
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!editable) return;
          void save()
            .then(() => setMsg('Saved. Totals recalculated by the server.'))
            .catch((err) => fail(err, 'Save failed.'));
        }}
      >
        <h2 className="font-medium">Line items</h2>
        <LineItemEditor
          lines={lines}
          onChange={setLines}
          disabled={!editable}
          catalog={catalog.data?.data.standardLineItems}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="discount">Discount ($)</Label>
            <Input
              id="discount"
              inputMode="decimal"
              disabled={!editable}
              value={form.discountDollars}
              onChange={(e) => setForm((f) => ({ ...f, discountDollars: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax">Tax rate (%)</Label>
            <Input
              id="tax"
              inputMode="decimal"
              disabled={!editable}
              value={form.taxPercent}
              onChange={(e) => setForm((f) => ({ ...f, taxPercent: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            disabled={!editable}
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={update.isPending}
              onClick={() =>
                void save({ status: 'sent' })
                  .then(() => setMsg('Marked as sent. The estimate is now locked.'))
                  .catch((err) => fail(err, 'Could not mark as sent.'))
              }
            >
              Save &amp; mark sent
            </Button>
          </div>
        ) : null}
      </form>

      <section className="max-w-sm space-y-1 rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="mb-2 font-medium">Totals (calculated by the server)</h2>
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatCents(row.subtotalCents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Discount</span>
          <span>-{formatCents(row.discountCents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax ({bpsToPercent(row.taxRateBps)}%)</span>
          <span>{formatCents(row.taxCents)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 font-semibold">
          <span>Total</span>
          <span>{formatCents(row.totalCents)}</span>
        </div>
        <ul className="pt-2 text-xs text-muted-foreground">
          {row.lineItems.map((l) => (
            <li key={l.id} className="flex justify-between">
              <span className="truncate pr-2">{l.description}</span>
              <span>{formatCents(l.amountCents)}</span>
            </li>
          ))}
        </ul>
      </section>

      <CostPanel estimateId={id} />

      <div className="flex flex-wrap gap-2">
        {canCreateProposal && row.status !== 'void' ? (
          <Button
            type="button"
            disabled={createProposal.isPending}
            onClick={() =>
              void createProposal
                .mutateAsync({ estimateId: id })
                .then((res) => navigate(`/app/proposals/${res.data.id}`))
                .catch((err) => fail(err, 'Could not create proposal.'))
            }
          >
            Create proposal
          </Button>
        ) : null}
        {canCreate ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={duplicate.isPending}
              onClick={() =>
                void duplicate
                  .mutateAsync('version')
                  .then((res) => navigate(`/app/estimates/${res.data.id}`))
                  .catch((err) => fail(err, 'Duplicate failed.'))
              }
            >
              New version
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={duplicate.isPending}
              onClick={() =>
                void duplicate
                  .mutateAsync('copy')
                  .then((res) => navigate(`/app/estimates/${res.data.id}`))
                  .catch((err) => fail(err, 'Duplicate failed.'))
              }
            >
              Duplicate as copy
            </Button>
          </>
        ) : null}
        {canUpdate && row.status !== 'void' ? (
          <Button
            type="button"
            variant="outline"
            disabled={voidEstimate.isPending}
            onClick={() => {
              if (!window.confirm('Void this estimate? This cannot be undone.')) return;
              setError(null);
              void voidEstimate
                .mutateAsync()
                .then(() => setMsg('Estimate voided.'))
                .catch((err) => fail(err, 'Void failed.'));
            }}
          >
            Void
          </Button>
        ) : null}
      </div>

      {msg ? <p className="text-sm text-brand">{msg}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
