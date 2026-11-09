import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bpsToPercent, centsToDollars, dollarsToCents, percentToBps } from '@/lib/money';
import { usePricingConfig, useUpdatePricingConfig } from '@/modules/estimates/api';
import type { LineItemKind } from '@/modules/estimates/types';
import { ApiError } from '@/types/api';

type Row = {
  key: string;
  label: string;
  unit: string;
  unitDollars: string;
  kind: LineItemKind;
  active: boolean;
};

export function PricingPage(): React.ReactElement {
  const query = usePricingConfig();
  const update = useUpdatePricingConfig();
  const [taxPercent, setTaxPercent] = useState('0.00');
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = query.data?.data;
    if (!d) return;
    setTaxPercent(bpsToPercent(d.taxRateBps));
    setRows(
      d.standardLineItems.map((i) => ({
        key: i.key,
        label: i.label,
        unit: i.unit,
        unitDollars: centsToDollars(i.unitCostCents),
        kind: i.kind,
        active: i.active,
      })),
    );
  }, [query.data?.data]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof ApiError ? query.error.message : 'Failed to load pricing.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  function patchRow(index: number, values: Partial<Row>): void {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...values } : r)));
  }

  async function onSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      await update.mutateAsync({
        taxRateBps: percentToBps(taxPercent),
        standardLineItems: rows.map((r) => ({
          key: r.key.trim(),
          label: r.label.trim(),
          unit: r.unit.trim(),
          unitCostCents: dollarsToCents(r.unitDollars),
          kind: r.kind,
          active: r.active,
        })),
      });
      setMsg('Pricing saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save pricing.');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing"
        description="Default tax rate and standard line items for estimates. Leave the tax rate at 0 until you have confirmed the correct rate."
      />
      <form
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => void onSave(e)}
      >
        <div className="max-w-xs space-y-2">
          <Label htmlFor="taxPercent">Default tax rate (%)</Label>
          <Input
            id="taxPercent"
            inputMode="decimal"
            value={taxPercent}
            onChange={(e) => setTaxPercent(e.target.value)}
          />
        </div>
        <h2 className="font-medium">Standard line items</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No standard items yet.</p>
        ) : null}
        {rows.map((row, index) => (
          <div key={index} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-6">
            <Input
              aria-label="Key"
              placeholder="key_name"
              value={row.key}
              onChange={(e) => patchRow(index, { key: e.target.value })}
            />
            <Input
              aria-label="Label"
              placeholder="Label"
              className="sm:col-span-2"
              value={row.label}
              onChange={(e) => patchRow(index, { label: e.target.value })}
            />
            <Input
              aria-label="Unit"
              placeholder="Unit"
              value={row.unit}
              onChange={(e) => patchRow(index, { unit: e.target.value })}
            />
            <Input
              aria-label="Unit cost ($)"
              inputMode="decimal"
              value={row.unitDollars}
              onChange={(e) => patchRow(index, { unitDollars: e.target.value })}
            />
            <select
              aria-label="Kind"
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={row.kind}
              onChange={(e) => patchRow(index, { kind: e.target.value as LineItemKind })}
            >
              <option value="material">Material</option>
              <option value="labor">Labor</option>
              <option value="other">Other</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={row.active}
                onChange={(e) => patchRow(index, { active: e.target.checked })}
              />
              Active
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setRows((prev) => [
                ...prev,
                { key: '', label: '', unit: 'ea', unitDollars: '0.00', kind: 'material', active: true },
              ])
            }
          >
            Add item
          </Button>
          <Button type="submit" disabled={update.isPending}>
            Save pricing
          </Button>
        </div>
        {msg ? <p className="text-sm text-brand">{msg}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </div>
  );
}
