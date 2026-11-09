import { useState } from 'react';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar, SearchInput, SelectFilter } from '@/components/shared/FilterBar';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import {
  useCreateSubcontractor,
  useListQuery,
  useUpdateSubcontractor,
  type SubcontractorRow,
} from '@/modules/operations/api';
import { ApiError } from '@/types/api';

function CreateSubcontractor({ onDone }: { onDone: () => void }): React.ReactElement {
  const create = useCreateSubcontractor();
  const [f, setF] = useState({ companyName: '', contactName: '', email: '', phone: '', categories: '', notes: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    create.mutate(
      {
        companyName: f.companyName.trim(),
        contactName: f.contactName,
        email: f.email,
        phone: f.phone,
        notes: f.notes,
        serviceCategories: f.categories.split(',').map((c) => c.trim()).filter(Boolean),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-4 rounded-lg border border-border bg-card p-4 shadow-sm md:grid-cols-2">
      <FormField label="Company name" htmlFor="sub-company"><Input id="sub-company" value={f.companyName} onChange={set('companyName')} required /></FormField>
      <FormField label="Contact name" htmlFor="sub-contact"><Input id="sub-contact" value={f.contactName} onChange={set('contactName')} /></FormField>
      <FormField label="Email" htmlFor="sub-email"><Input id="sub-email" type="email" value={f.email} onChange={set('email')} /></FormField>
      <FormField label="Phone" htmlFor="sub-phone"><Input id="sub-phone" value={f.phone} onChange={set('phone')} /></FormField>
      <FormField label="Service types" htmlFor="sub-cats" hint="Comma separated, e.g. roofing, gutters">
        <Input id="sub-cats" value={f.categories} onChange={set('categories')} />
      </FormField>
      <FormField label="Internal notes" htmlFor="sub-notes"><Input id="sub-notes" value={f.notes} onChange={set('notes')} /></FormField>
      {create.isError ? (
        <p role="alert" className="text-sm text-danger md:col-span-2">
          {create.error instanceof ApiError ? create.error.message : 'Could not save the subcontractor.'}
        </p>
      ) : null}
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={f.companyName.trim() === '' || create.isPending}>Add subcontractor</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function SubcontractorsPage(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const canCreate = useHasPermission('subcontractors:create');
  const canUpdate = useHasPermission('subcontractors:update');
  const q = useListQuery<SubcontractorRow>('subcontractors', '/subcontractors', { search, active, page, pageSize: 25 });
  const update = useUpdateSubcontractor();

  return (
    <div>
      <PageHeader
        title="Subcontractors"
        description="Directory of outside crews and vendors. Subcontractors do not have portal access."
        actions={canCreate && !creating ? <Button onClick={() => setCreating(true)}>Add subcontractor</Button> : null}
      />
      {creating ? <CreateSubcontractor onDone={() => setCreating(false)} /> : null}
      <FilterBar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search company" />
        <SelectFilter label="Status" value={active} onChange={(v) => { setActive(v); setPage(1); }} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
      </FilterBar>
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Failed to load subcontractors." onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <DataTable
            rows={q.data.data}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No subcontractors" description="Add the crews and vendors you work with." />}
            columns={[
              { key: 'co', header: 'Company', render: (r) => <span><span className="font-medium">{r.companyName}</span><span className="block text-xs font-normal text-muted-foreground">{r.contactName}</span></span> },
              { key: 'contact', header: 'Contact', render: (r) => <span>{r.phone}<span className="block text-xs text-muted-foreground">{r.email}</span></span>, hideOnMobile: true },
              { key: 'cats', header: 'Services', render: (r) => r.serviceCategories.map((c) => c.replace(/_/g, ' ')).join(', ') || '—', hideOnMobile: true },
              { key: 'city', header: 'City', render: (r) => r.address.city || '—', hideOnMobile: true },
              {
                key: 'active',
                header: 'Status',
                render: (r) => (
                  <span className="flex items-center gap-2">
                    <StatusBadge status={r.active ? 'active' : 'inactive'} />
                    {canUpdate ? (
                      <button type="button" className="text-xs text-brand hover:underline" onClick={() => update.mutate({ id: r.id, patch: { active: !r.active } })}>
                        {r.active ? 'Deactivate' : 'Activate'}
                      </button>
                    ) : null}
                  </span>
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
