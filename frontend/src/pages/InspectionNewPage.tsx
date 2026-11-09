import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerPropertyPicker } from '@/components/shared/EntityPickers';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateInspection } from '@/modules/inspections/api';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError } from '@/types/api';

export function InspectionNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateInspection();
  const userId = useAuthStore((s) => s.user?.id);
  const [form, setForm] = useState({
    customerId: params.get('customerId') ?? '',
    propertyId: params.get('propertyId') ?? '',
    appointmentId: params.get('appointmentId') ?? '',
    leadId: params.get('leadId') ?? '',
    inspectionDate: new Date().toISOString().slice(0, 10),
    typeKey: 'standard',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const res = await create.mutateAsync({
        customerId: form.customerId,
        propertyId: form.propertyId,
        appointmentId: form.appointmentId || undefined,
        leadId: form.leadId || undefined,
        assignedTo: userId,
        inspectionDate: new Date(`${form.inspectionDate}T12:00:00Z`).toISOString(),
        typeKey: form.typeKey,
        notes: form.notes || undefined,
      });
      void navigate(`/app/inspections/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create inspection.');
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New inspection" description="Choose the customer and property being inspected." />
      <form className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm" onSubmit={(e) => void onSubmit(e)}>
        <CustomerPropertyPicker customerId={form.customerId} propertyId={form.propertyId} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
        <FormField label="Inspection date" htmlFor="inspectionDate">
          <Input id="inspectionDate" type="date" value={form.inspectionDate} onChange={(e) => setForm((f) => ({ ...f, inspectionDate: e.target.value }))} required />
        </FormField>
        <FormField label="Notes" htmlFor="notes">
          <textarea id="notes" className="min-h-20 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </FormField>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={create.isPending || !form.customerId || !form.propertyId}>Create inspection</Button>
      </form>
    </div>
  );
}
