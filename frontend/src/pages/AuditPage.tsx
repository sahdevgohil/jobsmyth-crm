import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { PageHeader } from '@/components/shared/PageHeader';
import { useAuditLogs } from '@/modules/audit/api';
import { ApiError } from '@/types/api';

export function AuditPage(): React.ReactElement {
  const query = useAuditLogs(1);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Immutable record of important actions. Entries cannot be edited or deleted."
      />
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'Failed to load audit log.'}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.data.length === 0 ? (
        <EmptyState title="No audit entries yet" />
      ) : null}
      {query.data && query.data.data.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Actor</th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{row.action}</td>
                  <td className="px-4 py-3">
                    {row.entityType} / {row.entityId}
                  </td>
                  <td className="px-4 py-3">{row.actorId ?? row.actorType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
