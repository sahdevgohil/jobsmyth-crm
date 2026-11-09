import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FormField, selectClass } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import { useAfterSalesList, useCreateAfterSales } from '@/modules/after-sales/api';
import { useCustomerNames } from '@/modules/customers/api';
import { useListQuery } from '@/modules/operations/api';
import { useLookups } from '@/modules/settings/api';
import { ApiError } from '@/types/api';

type Proj = { id: string; number: string; customerId: string; status: string };
const d = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-US') : '—');

function CreateRecord({ projects, onDone }: { projects: Proj[]; onDone: () => void }): React.ReactElement {
  const create = useCreateAfterSales();
  const warranty = useLookups('warranty_type');
  const [f, setF] = useState({ projectId: '', rating: '5', comment: '', warrantyKey: '', warrantyNotes: '', followUp: '' });
  const [error, setError] = useState<string | null>(null);
  const project = projects.find((p) => p.id === f.projectId);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      className="mb-6 grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!project) return;
        setError(null);
        create.mutate(
          {
            projectId: project.id,
            customerId: project.customerId,
            completionConfirmedAt: new Date().toISOString(),
            feedbackRating: Number(f.rating),
            feedbackComment: f.comment || undefined,
            warrantyLookupKey: f.warrantyKey || undefined,
            warrantyNotes: f.warrantyNotes || undefined,
            followUpDueAt: f.followUp ? new Date(`${f.followUp}T15:00:00Z`).toISOString() : undefined,
          },
          { onSuccess: onDone, onError: (er) => setError(er instanceof ApiError ? er.message : 'Failed to create record.') },
        );
      }}
    >
      <FormField label="Project" htmlFor="as-project">
        <select id="as-project" className={selectClass} required value={f.projectId} onChange={set('projectId')}>
          <option value="">Select a project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}
        </select>
      </FormField>
      <FormField label="Feedback rating (1–5)" htmlFor="as-rating"><Input id="as-rating" type="number" min={1} max={5} value={f.rating} onChange={set('rating')} /></FormField>
      <div className="sm:col-span-2"><FormField label="Customer feedback" htmlFor="as-comment"><Input id="as-comment" value={f.comment} onChange={set('comment')} /></FormField></div>
      <FormField label="Warranty type (optional)" htmlFor="as-wkey" hint="Types come from Settings → Lookups. Terms are not invented here.">
        <select id="as-wkey" className={selectClass} value={f.warrantyKey} onChange={set('warrantyKey')}>
          <option value="">None</option>
          {(warranty.data?.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
      </FormField>
      <FormField label="Follow-up due" htmlFor="as-follow"><Input id="as-follow" type="date" value={f.followUp} onChange={set('followUp')} /></FormField>
      <div className="sm:col-span-2"><FormField label="Warranty notes (staff only)" htmlFor="as-wnotes"><Input id="as-wnotes" value={f.warrantyNotes} onChange={set('warrantyNotes')} /></FormField></div>
      {error ? <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={!project || create.isPending}>Save record</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function AfterSalesPage(): React.ReactElement {
  const list = useAfterSalesList();
  const projects = useListQuery<Proj>('projects', '/projects', { pageSize: 100 });
  const canManage = useHasPermission('after_sales:manage');
  const [creating, setCreating] = useState(false);
  const rows = list.data?.data ?? [];
  const customerName = useCustomerNames(rows.map((r) => r.customerId));
  const number = (id: string): string => projects.data?.data.find((p) => p.id === id)?.number ?? '…';

  return (
    <div>
      <PageHeader
        title="After-sales"
        description="Completion confirmation, customer feedback and follow-ups. Warranty notes are staff text only; no terms are invented."
        actions={canManage && !creating ? <Button onClick={() => setCreating(true)}>New record</Button> : null}
      />
      {creating ? <CreateRecord projects={projects.data?.data ?? []} onDone={() => setCreating(false)} /> : null}
      {list.isLoading ? <LoadingState /> : null}
      {list.isError ? <ErrorState message="Failed to load after-sales records." onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No after-sales records" description="Record completion and feedback once a project is finished." />}
          columns={[
            { key: 'p', header: 'Project', render: (r) => <Link className="text-brand hover:underline" to={`/app/projects/${r.projectId}`}>{number(r.projectId)}</Link> },
            { key: 'c', header: 'Customer', render: (r) => customerName(r.customerId) },
            { key: 'r', header: 'Rating', render: (r) => (r.feedbackRating ? `${r.feedbackRating} / 5` : '—') },
            { key: 'w', header: 'Warranty', render: (r) => (r.warrantyLookupKey ? r.warrantyLookupKey.replace(/_/g, ' ') : '—'), hideOnMobile: true },
            { key: 'f', header: 'Follow-up', render: (r) => (r.followUpCompletedAt ? <StatusBadge status="completed" /> : r.followUpDueAt ? `Due ${d(r.followUpDueAt)}` : '—'), hideOnMobile: true },
            { key: 'cc', header: 'Completed', render: (r) => d(r.completionConfirmedAt), hideOnMobile: true },
          ]}
        />
      ) : null}
    </div>
  );
}
