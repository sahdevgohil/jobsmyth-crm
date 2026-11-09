import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar, SelectFilter } from '@/components/shared/FilterBar';
import { FormField, selectClass } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { statusLabel } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import {
  useCreateWorkOrder,
  useListQuery,
  useUpdateWorkOrder,
  type SubcontractorRow,
  type WorkOrderRow,
} from '@/modules/operations/api';
import { ApiError } from '@/types/api';

const STATUSES = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'];

function CreateWorkOrder({ onDone }: { onDone: () => void }): React.ReactElement {
  const projects = useListQuery<{ id: string; number: string; status: string }>('projects', '/projects', { pageSize: 100 });
  const subs = useListQuery<SubcontractorRow>('subcontractors', '/subcontractors', { active: 'true', pageSize: 100 });
  const create = useCreateWorkOrder();
  const [form, setForm] = useState({ projectId: '', title: '', subcontractorId: '', instructions: '', plannedStartAt: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.projectId !== '' && form.title.trim() !== '';

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    create.mutate(
      {
        projectId: form.projectId,
        title: form.title.trim(),
        ...(form.subcontractorId ? { subcontractorId: form.subcontractorId } : {}),
        ...(form.instructions ? { instructions: form.instructions } : {}),
        ...(form.plannedStartAt ? { plannedStartAt: new Date(form.plannedStartAt).toISOString() } : {}),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-4 rounded-lg border border-border bg-card p-4 shadow-sm md:grid-cols-2">
      <FormField label="Project" htmlFor="wo-project">
        <select id="wo-project" className={selectClass} value={form.projectId} onChange={set('projectId')} required>
          <option value="">Select a project…</option>
          {(projects.data?.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.number} ({statusLabel(p.status)})</option>
          ))}
        </select>
      </FormField>
      <FormField label="Title" htmlFor="wo-title">
        <Input id="wo-title" value={form.title} onChange={set('title')} required />
      </FormField>
      <FormField label="Subcontractor (optional)" htmlFor="wo-sub">
        <select id="wo-sub" className={selectClass} value={form.subcontractorId} onChange={set('subcontractorId')}>
          <option value="">Unassigned</option>
          {(subs.data?.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.companyName}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Planned start" htmlFor="wo-start">
        <Input id="wo-start" type="datetime-local" value={form.plannedStartAt} onChange={set('plannedStartAt')} />
      </FormField>
      <div className="md:col-span-2">
        <FormField label="Instructions" htmlFor="wo-instr">
          <textarea id="wo-instr" className="min-h-20 w-full rounded-md border border-border bg-card p-3 text-sm" value={form.instructions} onChange={set('instructions')} />
        </FormField>
      </div>
      {create.isError ? (
        <p role="alert" className="text-sm text-danger md:col-span-2">
          {create.error instanceof ApiError ? create.error.message : 'Could not create the work order.'}
        </p>
      ) : null}
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={!valid || create.isPending}>Create work order</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function WorkOrdersPage(): React.ReactElement {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const canCreate = useHasPermission('work_orders:create');
  const canUpdate = useHasPermission('work_orders:update');
  const q = useListQuery<WorkOrderRow>('work-orders', '/work-orders', { status, page, pageSize: 25 });
  const subs = useListQuery<SubcontractorRow>('subcontractors', '/subcontractors', { pageSize: 100 });
  const update = useUpdateWorkOrder();
  const subName = (id: string | null): string => (id ? (subs.data?.data.find((s) => s.id === id)?.companyName ?? '…') : 'Unassigned');

  return (
    <div>
      <PageHeader
        title="Work orders"
        description="Crew and subcontractor assignments, instructions and completion notes."
        actions={canCreate && !creating ? <Button onClick={() => setCreating(true)}>New work order</Button> : null}
      />
      {creating ? <CreateWorkOrder onDone={() => setCreating(false)} /> : null}
      <FilterBar>
        <SelectFilter
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
        />
      </FilterBar>
      {update.isError ? <p role="alert" className="mb-2 text-sm text-danger">Could not update the work order.</p> : null}
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Failed to load work orders." onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <DataTable
            rows={q.data.data}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No work orders" description="Create one from a project to assign work to a crew or subcontractor." />}
            columns={[
              { key: 'num', header: 'Work order', render: (r) => <span><span className="font-medium">{r.number}</span><span className="block text-xs font-normal text-muted-foreground">{r.title}</span></span> },
              { key: 'proj', header: 'Project', render: (r) => <Link className="text-brand hover:underline" to={`/app/projects/${r.projectId}`}>Open</Link>, hideOnMobile: true },
              { key: 'sub', header: 'Assigned to', render: (r) => subName(r.subcontractorId), hideOnMobile: true },
              { key: 'start', header: 'Planned start', render: (r) => (r.plannedStartAt ? new Date(r.plannedStartAt).toLocaleDateString('en-US') : '—'), hideOnMobile: true },
              {
                key: 'status',
                header: 'Status',
                render: (r) =>
                  canUpdate ? (
                    <select
                      aria-label={`Status for ${r.number}`}
                      className={`${selectClass} h-8 w-36 text-xs`}
                      value={r.status}
                      onChange={(e) => update.mutate({ id: r.id, patch: { status: e.target.value } })}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{statusLabel(s)}</option>
                      ))}
                    </select>
                  ) : (
                    <StatusBadge status={r.status} />
                  ),
              },
            ]}
          />
          <Pagination page={page} pageSize={25} total={q.data.meta.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
