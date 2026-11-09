import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerPropertyPicker, LinkedRecordSelect } from '@/components/shared/EntityPickers';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateMeasurement } from '@/modules/measurements/api';
import { ApiError } from '@/types/api';

type NumericField = 'totalArea' | 'facets' | 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';

const NUMERIC_FIELDS: Array<[NumericField, string]> = [
  ['totalArea', 'Total area'],
  ['facets', 'Facets'],
  ['ridge', 'Ridge (ft)'],
  ['hip', 'Hip (ft)'],
  ['valley', 'Valley (ft)'],
  ['eave', 'Eave (ft)'],
  ['rake', 'Rake (ft)'],
];

export function MeasurementNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateMeasurement();
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [form, setForm] = useState({
    propertyId: params.get('propertyId') ?? '',
    inspectionId: params.get('inspectionId') ?? '',
    measurementDate: new Date().toISOString().slice(0, 10),
    units: 'sq_ft',
    provider: 'none',
    importedFilename: '',
    pitch: '',
    notes: '',
    totalArea: '',
    facets: '',
    ridge: '',
    hip: '',
    valley: '',
    eave: '',
    rake: '',
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {
      propertyId: form.propertyId.trim(),
      inspectionId: form.inspectionId.trim() || undefined,
      measurementDate: new Date(form.measurementDate).toISOString(),
      units: form.units,
      provider: form.provider,
      pitch: form.pitch || undefined,
      notes: form.notes || undefined,
      // Non-empty filename records manual entry from a file (source=import), not a live sync.
      importedFilename: form.importedFilename.trim() || undefined,
    };
    for (const [key] of NUMERIC_FIELDS) {
      if (form[key].trim() !== '') body[key] = Number(form[key]);
    }
    try {
      const res = await create.mutateAsync(body);
      void navigate(`/app/measurements/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save measurement.');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New measurement"
        description="Enter values by hand. To record numbers from a report file, add the file name below. No live Roofr/EagleView/HOVER sync is configured."
      />
      <form
        className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2"
        onSubmit={(e) => void onSubmit(e)}
      >
        <div className="space-y-4 sm:col-span-2">
          <CustomerPropertyPicker
            customerId={customerId}
            propertyId={form.propertyId}
            onChange={(v) => {
              setCustomerId(v.customerId);
              setForm((f) => ({ ...f, propertyId: v.propertyId, inspectionId: v.propertyId === f.propertyId ? f.inspectionId : '' }));
            }}
          />
          <LinkedRecordSelect<{ id: string; inspectionDate: string; status: string }>
            id="meas-inspection"
            label="Inspection (optional)"
            value={form.inspectionId}
            onChange={(v) => setForm((f) => ({ ...f, inspectionId: v }))}
            path="/inspections"
            params={{ customerId, propertyId: form.propertyId }}
            enabled={Boolean(form.propertyId)}
            describe={(i) => `${new Date(i.inspectionDate).toLocaleDateString('en-US')} (${i.status.replace(/_/g, ' ')})`}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="measurementDate">Measurement date</Label>
          <Input
            id="measurementDate"
            type="date"
            required
            value={form.measurementDate}
            onChange={(e) => setForm((f) => ({ ...f, measurementDate: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="units">Area units</Label>
          <select
            id="units"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.units}
            onChange={(e) => setForm((f) => ({ ...f, units: e.target.value }))}
          >
            <option value="sq_ft">Square feet</option>
            <option value="squares">Squares</option>
            <option value="sq_m">Square meters</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="provider">Report source</Label>
          <select
            id="provider"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.provider}
            onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
          >
            <option value="none">None (manual)</option>
            <option value="roofr">Roofr report</option>
            <option value="eagleview">EagleView report</option>
            <option value="hover">HOVER report</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="importedFilename">Report file name (optional)</Label>
          <Input
            id="importedFilename"
            value={form.importedFilename}
            onChange={(e) => setForm((f) => ({ ...f, importedFilename: e.target.value }))}
          />
        </div>
        {NUMERIC_FIELDS.map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              inputMode="decimal"
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="pitch">Pitch</Label>
          <Input
            id="pitch"
            placeholder="6/12"
            value={form.pitch}
            onChange={(e) => setForm((f) => ({ ...f, pitch: e.target.value }))}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
        {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Save measurement
          </Button>
        </div>
      </form>
    </div>
  );
}
