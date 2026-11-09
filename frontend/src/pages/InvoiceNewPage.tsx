import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerPropertyPicker, LinkedRecordSelect } from '@/components/shared/EntityPickers';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dollarsToCents } from '@/lib/money';
import { useCreateInvoice } from '@/modules/invoices/api';
import { ApiError } from '@/types/api';

export function InvoiceNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateInvoice();
  const [form, setForm] = useState({
    customerId: params.get('customerId') ?? '',
    propertyId: params.get('propertyId') ?? '',
    projectId: params.get('projectId') ?? '',
    description: 'Services rendered',
    amountDollars: '',
    dueDate: '',
  });
  const [error, setError] = useState<string | null>(null);
  const amountCents = dollarsToCents(form.amountDollars);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New invoice" description="Totals are calculated on the server in cents. Tax is applied from company settings." />
      <form
        className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void create
            .mutateAsync({
              customerId: form.customerId,
              propertyId: form.propertyId || undefined,
              projectId: form.projectId || undefined,
              dueDate: form.dueDate ? new Date(`${form.dueDate}T23:00:00Z`).toISOString() : undefined,
              lineItems: [{ description: form.description, kind: 'other', quantity: 1, unit: 'job', unitCostCents: amountCents }],
            })
            .then((res) => navigate(`/app/invoices/${res.data.id}`))
            .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not create invoice.'));
        }}
      >
        <CustomerPropertyPicker customerId={form.customerId} propertyId={form.propertyId} requireProperty={false} onChange={(v) => setForm((f) => ({ ...f, ...v, projectId: v.customerId === f.customerId ? f.projectId : '' }))} />
        <LinkedRecordSelect<{ id: string; number: string; status: string }>
          id="invoice-project"
          label="Project (optional)"
          value={form.projectId}
          onChange={(v) => setForm((f) => ({ ...f, projectId: v }))}
          path="/projects"
          params={{ customerId: form.customerId }}
          enabled={Boolean(form.customerId)}
          describe={(p) => `${p.number} (${p.status.replace(/_/g, ' ')})`}
        />
        <FormField label="Line description" htmlFor="inv-desc"><Input id="inv-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required /></FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Amount (USD)" htmlFor="inv-amount"><Input id="inv-amount" inputMode="decimal" placeholder="0.00" value={form.amountDollars} onChange={(e) => setForm((f) => ({ ...f, amountDollars: e.target.value }))} required /></FormField>
          <FormField label="Due date" htmlFor="inv-due"><Input id="inv-due" type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></FormField>
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={create.isPending || !form.customerId || amountCents <= 0}>Create invoice</Button>
      </form>
    </div>
  );
}
