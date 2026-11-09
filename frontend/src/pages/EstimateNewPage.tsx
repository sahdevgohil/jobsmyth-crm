import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerPropertyPicker, LinkedRecordSelect } from '@/components/shared/EntityPickers';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bpsToPercent, dollarsToCents, percentToBps } from '@/lib/money';
import { useCreateEstimate, useEstimateCatalog } from '@/modules/estimates/api';
import { draftsToPayload, type LineDraft } from '@/modules/estimates/lineDrafts';
import { LineItemEditor } from '@/modules/estimates/LineItemEditor';
import { ApiError } from '@/types/api';

export function EstimateNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateEstimate();
  const catalog = useEstimateCatalog();
  const [form, setForm] = useState({
    customerId: params.get('customerId') ?? '',
    propertyId: params.get('propertyId') ?? '',
    inspectionId: params.get('inspectionId') ?? '',
    measurementId: params.get('measurementId') ?? '',
    discountDollars: '0.00',
    taxPercent: '',
    notes: '',
  });
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const defaultTax = catalog.data ? bpsToPercent(catalog.data.data.taxRateBps) : '0.00';

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const res = await create.mutateAsync({
        customerId: form.customerId.trim(),
        propertyId: form.propertyId.trim(),
        inspectionId: form.inspectionId.trim() || undefined,
        measurementId: form.measurementId.trim() || undefined,
        lineItems: draftsToPayload(lines),
        discountCents: dollarsToCents(form.discountDollars),
        // Blank = let the server copy the company default rate.
        taxRateBps: form.taxPercent.trim() ? percentToBps(form.taxPercent) : undefined,
        notes: form.notes || undefined,
      });
      void navigate(`/app/estimates/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create estimate.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New estimate"
        description="Totals and tax are calculated by the server when you save."
      />
      <form
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => void onSubmit(e)}
      >
        <CustomerPropertyPicker
          customerId={form.customerId}
          propertyId={form.propertyId}
          onChange={(v) => setForm((f) => ({ ...f, ...v, inspectionId: v.propertyId === f.propertyId ? f.inspectionId : '', measurementId: v.propertyId === f.propertyId ? f.measurementId : '' }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <LinkedRecordSelect<{ id: string; inspectionDate: string; status: string }>
            id="est-inspection"
            label="Inspection (optional)"
            value={form.inspectionId}
            onChange={(v) => setForm((f) => ({ ...f, inspectionId: v }))}
            path="/inspections"
            params={{ customerId: form.customerId, propertyId: form.propertyId }}
            enabled={Boolean(form.propertyId)}
            describe={(i) => `${new Date(i.inspectionDate).toLocaleDateString('en-US')} (${i.status.replace(/_/g, ' ')})`}
          />
          <LinkedRecordSelect<{ id: string; measurementDate: string; totalArea: number | null; units: string }>
            id="est-measurement"
            label="Measurement (optional)"
            value={form.measurementId}
            onChange={(v) => setForm((f) => ({ ...f, measurementId: v }))}
            path="/measurements"
            params={{ customerId: form.customerId, propertyId: form.propertyId }}
            enabled={Boolean(form.propertyId)}
            describe={(m) => `${new Date(m.measurementDate).toLocaleDateString('en-US')} · ${m.totalArea ?? '—'} ${m.units.replace('_', ' ')}`}
          />
        </div>

        <div className="space-y-2">
          <h2 className="font-medium">Line items</h2>
          <LineItemEditor
            lines={lines}
            onChange={setLines}
            catalog={catalog.data?.data.standardLineItems}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="discount">Discount ($)</Label>
            <Input
              id="discount"
              inputMode="decimal"
              value={form.discountDollars}
              onChange={(e) => setForm((f) => ({ ...f, discountDollars: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax">Tax rate (%)</Label>
            <Input
              id="tax"
              inputMode="decimal"
              placeholder={`Company default: ${defaultTax}`}
              value={form.taxPercent}
              onChange={(e) => setForm((f) => ({ ...f, taxPercent: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={create.isPending}>
          Create estimate
        </Button>
      </form>
    </div>
  );
}
