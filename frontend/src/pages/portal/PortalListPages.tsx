import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { formatCents } from '@/lib/money';
import {
  usePortalFiles,
  usePortalInvoices,
  usePortalProjects,
  usePortalProposals,
} from '@/modules/portal/api';
import { ApiError } from '@/types/api';

export function PortalProposalsPage(): React.ReactElement {
  const q = usePortalProposals();
  return (
    <PortalListShell
      title="Proposals"
      description="Your proposal status and totals."
      query={q}
      renderItem={(row) => (
        <li key={String(row.id)} className="px-4 py-3 text-sm">
          <p className="font-medium">{String(row.number)}</p>
          <p className="text-muted-foreground">
            {String(row.status)} · {formatCents(Number(row.totalCents ?? 0))}
          </p>
        </li>
      )}
    />
  );
}

export function PortalProjectsPage(): React.ReactElement {
  const q = usePortalProjects();
  return (
    <PortalListShell
      title="Projects"
      description="Active and completed project status."
      query={q}
      renderItem={(row) => (
        <li key={String(row.id)} className="px-4 py-3 text-sm">
          <p className="font-medium">{String(row.number)}</p>
          <p className="text-muted-foreground">{String(row.status)}</p>
        </li>
      )}
    />
  );
}

export function PortalInvoicesPage(): React.ReactElement {
  const q = usePortalInvoices();
  return (
    <PortalListShell
      title="Invoices"
      description="Issued invoices and balances."
      query={q}
      renderItem={(row) => (
        <li key={String(row.id)} className="px-4 py-3 text-sm">
          <p className="font-medium">{String(row.number)}</p>
          <p className="text-muted-foreground">
            {String(row.status)} · {formatCents(Number(row.totalCents ?? 0))} · bal{' '}
            {formatCents(Number(row.balanceCents ?? 0))}
          </p>
        </li>
      )}
    />
  );
}

export function PortalDocumentsPage(): React.ReactElement {
  const q = usePortalFiles();
  return (
    <PortalListShell
      title="Documents"
      description="Files shared with customer visibility."
      query={q}
      renderItem={(row) => (
        <li key={String(row.id)} className="px-4 py-3 text-sm">
          <p className="font-medium">{String(row.originalFilename)}</p>
          <p className="text-muted-foreground">
            {String(row.category)} · {String(row.mimeType)}
          </p>
        </li>
      )}
    />
  );
}

function PortalListShell({
  title,
  description,
  query,
  renderItem,
}: {
  title: string;
  description: string;
  query: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: { data: Array<Record<string, unknown>> };
    refetch: () => unknown;
  };
  renderItem: (row: Record<string, unknown>) => React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'Failed to load.'}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.data.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()}`} description="Nothing to show yet." />
      ) : null}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {(query.data?.data ?? []).map((row) => renderItem(row))}
      </ul>
    </div>
  );
}
