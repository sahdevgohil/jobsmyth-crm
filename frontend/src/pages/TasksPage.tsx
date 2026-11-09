import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar, SelectFilter } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { selectClass } from '@/components/shared/FormField';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { statusLabel } from '@/lib/status';
import { useHasPermission } from '@/lib/permissions';
import { useListQuery, useUpdateTaskStatus, type TaskRow } from '@/modules/operations/api';

const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];

export function TasksPage(): React.ReactElement {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const canUpdate = useHasPermission('projects:update');
  const q = useListQuery<TaskRow>('tasks', '/tasks', { status, page, pageSize: 25 });
  const update = useUpdateTaskStatus();

  return (
    <div>
      <PageHeader title="Tasks" description="Project tasks across all jobs, ordered by due date." />
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
      {update.isError ? <p role="alert" className="mb-2 text-sm text-danger">Could not update the task.</p> : null}
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Failed to load tasks." onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <DataTable
            rows={q.data.data}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No tasks" description="Tasks are created from a project." />}
            columns={[
              { key: 'title', header: 'Task', render: (r) => r.title },
              { key: 'project', header: 'Project', render: (r) => <Link className="text-brand hover:underline" to={`/app/projects/${r.projectId}`}>{r.projectNumber}</Link> },
              { key: 'due', header: 'Due', render: (r) => (r.dueAt ? new Date(r.dueAt).toLocaleDateString('en-US') : '—'), hideOnMobile: true },
              { key: 'prio', header: 'Priority', render: (r) => <StatusBadge status={r.priority} />, hideOnMobile: true },
              {
                key: 'status',
                header: 'Status',
                render: (r) =>
                  canUpdate ? (
                    <select
                      aria-label={`Status for ${r.title}`}
                      className={`${selectClass} h-8 w-36 text-xs`}
                      value={r.status}
                      onChange={(e) => update.mutate({ projectId: r.projectId, taskId: r.id, status: e.target.value })}
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
