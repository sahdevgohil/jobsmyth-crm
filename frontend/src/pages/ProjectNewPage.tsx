import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerPropertyPicker, LinkedRecordSelect } from '@/components/shared/EntityPickers';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { useCreateProject } from '@/modules/projects/api';
import { ApiError } from '@/types/api';

export function ProjectNewPage(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateProject();
  const [form, setForm] = useState({
    customerId: params.get('customerId') ?? '',
    propertyId: params.get('propertyId') ?? '',
    proposalId: params.get('proposalId') ?? '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New project" description="Link the customer and property. Choosing an accepted proposal also links its estimate." />
      <form
        className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void create
            .mutateAsync({
              customerId: form.customerId,
              propertyId: form.propertyId,
              proposalId: form.proposalId || undefined,
              notes: form.notes || undefined,
              status: form.proposalId ? 'approved' : undefined,
            })
            .then((res) => navigate(`/app/projects/${res.data.id}`))
            .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not create project.'));
        }}
      >
        <CustomerPropertyPicker customerId={form.customerId} propertyId={form.propertyId} onChange={(v) => setForm((f) => ({ ...f, ...v, proposalId: v.customerId === f.customerId ? f.proposalId : '' }))} />
        <LinkedRecordSelect<{ id: string; number: string; status: string; propertyId?: string }>
          id="project-proposal"
          label="Accepted proposal (optional)"
          value={form.proposalId}
          onChange={(v) => setForm((f) => ({ ...f, proposalId: v }))}
          path="/proposals"
          params={{ customerId: form.customerId, status: 'accepted' }}
          enabled={Boolean(form.customerId)}
          describe={(p) => p.number}
        />
        <FormField label="Notes" htmlFor="project-notes">
          <textarea id="project-notes" className="min-h-20 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </FormField>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={create.isPending || !form.customerId || !form.propertyId}>Create project</Button>
      </form>
    </div>
  );
}
