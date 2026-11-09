import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar, SearchInput, SelectFilter } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { useLeads, usePipelineStages } from '@/modules/leads/api';
import { useLookups } from '@/modules/settings/api';
import { useUsers } from '@/modules/users/api';
import { ApiError } from '@/types/api';

const PAGE_SIZE = 25;

export function LeadsPage(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const search = params.get('search') ?? '';
  const stageId = params.get('stageId') ?? '';
  const sourceKey = params.get('sourceKey') ?? '';
  const assignedTo = params.get('assignedTo') ?? '';
  const overdue = params.get('hasOverdueFollowUp') === 'true';
  const isAdmin = useHasPermission('leads:assign');
  const canCreate = useHasPermission('leads:create');

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  }

  const leads = useLeads({
    search: search || undefined,
    stageId: stageId || undefined,
    sourceKey: sourceKey || undefined,
    assignedTo: assignedTo || undefined,
    hasOverdueFollowUp: overdue ? 'true' : undefined,
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  const stages = usePipelineStages();
  const sources = useLookups('lead_source');
  const users = useUsers({ enabled: isAdmin });

  const stageName = (id: string): string => stages.data?.data.find((s) => s.id === id)?.name ?? '—';
  const stageCategory = (id: string): string => stages.data?.data.find((s) => s.id === id)?.category ?? 'open';
  const sourceLabel = (key: string): string => sources.data?.data.find((s) => s.key === key)?.label ?? key.replace(/_/g, ' ');
  const userName = (id: string): string => {
    const u = users.data?.data.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : '—';
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Create, filter, and work your pipeline."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/app/leads/pipeline">Pipeline board</Link>
            </Button>
            {canCreate ? (
              <Button asChild>
                <Link to="/app/leads/new">New lead</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <FilterBar>
        <SearchInput value={search} onChange={(v) => setFilter('search', v)} placeholder="Search name, phone, email, address" />
        <SelectFilter label="Stage" value={stageId} onChange={(v) => setFilter('stageId', v)} options={(stages.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <SelectFilter label="Source" value={sourceKey} onChange={(v) => setFilter('sourceKey', v)} options={(sources.data?.data ?? []).map((s) => ({ value: s.key, label: s.label }))} />
        {isAdmin ? (
          <SelectFilter
            label="Salesperson"
            value={assignedTo}
            onChange={(v) => setFilter('assignedTo', v)}
            options={(users.data?.data ?? []).filter((u) => u.role === 'salesperson').map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))}
          />
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={overdue} onChange={(e) => setFilter('hasOverdueFollowUp', e.target.checked ? 'true' : '')} />
          Overdue follow-up
        </label>
      </FilterBar>

      {leads.isLoading ? <LoadingState /> : null}
      {leads.isError ? (
        <ErrorState message={leads.error instanceof ApiError ? leads.error.message : 'Failed to load leads.'} onRetry={() => void leads.refetch()} />
      ) : null}
      {leads.data ? (
        <>
          <DataTable
            rows={leads.data.data}
            rowKey={(l) => l.id}
            rowHref={(l) => `/app/leads/${l.id}`}
            empty={<EmptyState title="No leads match" description="Adjust the filters or create a new lead." action={canCreate ? <Button asChild><Link to="/app/leads/new">New lead</Link></Button> : undefined} />}
            columns={[
              {
                key: 'name',
                header: 'Lead',
                render: (l) => (
                  <span>
                    {l.companyName || `${l.firstName} ${l.lastName}`.trim() || 'Untitled'}
                    {l.hasOverdueFollowUp ? <span className="ml-2 text-xs font-normal text-danger">Overdue</span> : null}
                    <span className="block text-xs font-normal text-muted-foreground">{l.phone || l.email}</span>
                  </span>
                ),
              },
              { key: 'stage', header: 'Stage', render: (l) => <StatusBadge status={stageName(l.stageId)} tone={stageCategory(l.stageId) === 'won' ? 'success' : stageCategory(l.stageId) === 'lost' ? 'danger' : 'info'} /> },
              { key: 'src', header: 'Source', render: (l) => sourceLabel(l.sourceKey), hideOnMobile: true },
              { key: 'svc', header: 'Service', render: (l) => (l.serviceInterestKey || '—').replace(/_/g, ' '), hideOnMobile: true },
              { key: 'prio', header: 'Priority', render: (l) => <StatusBadge status={l.priority ?? 'normal'} />, hideOnMobile: true },
              ...(isAdmin ? [{ key: 'owner', header: 'Salesperson', render: (l: { assignedTo: string }) => userName(l.assignedTo), hideOnMobile: true }] : []),
              { key: 'created', header: 'Created', render: (l) => new Date(l.createdAt).toLocaleDateString('en-US'), hideOnMobile: true },
            ]}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={leads.data.meta.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
