import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar, SelectFilter } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { StatCard } from '@/components/shared/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';
import { formatCents } from '@/lib/money';
import { useInvoiceSummary, useInvoices } from '@/modules/invoices/api';
import { ApiError } from '@/types/api';

const STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void'];

export function InvoicesPage(): React.ReactElement {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const invoices = useInvoices({ pageSize: '25', page: String(page), status: status || undefined });
  const summary = useInvoiceSummary();
  const canCreate = useHasPermission('invoices:create');

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Internal billing. QuickBooks sync stays “not configured” until credentials exist."
        actions={canCreate ? <Button asChild><Link to="/app/invoices/new">New invoice</Link></Button> : null}
      />
      {summary.data ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Invoiced" value={formatCents(summary.data.data.invoicedCents)} />
          <StatCard label="Collected" value={formatCents(summary.data.data.collectedCents)} />
          <StatCard label="Outstanding" value={formatCents(summary.data.data.outstandingCents)} tone={summary.data.data.outstandingCents > 0 ? 'warning' : 'default'} />
          <StatCard label="QuickBooks" value={statusLabel(summary.data.data.qbo.status)} hint="No live sync" />
        </div>
      ) : null}
      <FilterBar>
        <SelectFilter label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
      </FilterBar>
      {invoices.isLoading ? <LoadingState /> : null}
      {invoices.isError ? (
        <ErrorState message={invoices.error instanceof ApiError ? invoices.error.message : 'Failed to load.'} onRetry={() => void invoices.refetch()} />
      ) : null}
      {invoices.data ? (
        <>
          <DataTable
            rows={invoices.data.data}
            rowKey={(i) => i.id}
            rowHref={(i) => `/app/invoices/${i.id}`}
            empty={<EmptyState title="No invoices" description="Create an invoice for a customer or project." />}
            columns={[
              { key: 'num', header: 'Invoice', render: (i) => i.number },
              { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
              { key: 'total', header: 'Total', render: (i) => formatCents(i.totalCents), align: 'right' },
              { key: 'paid', header: 'Paid', render: (i) => formatCents(i.amountPaidCents), align: 'right', hideOnMobile: true },
              { key: 'bal', header: 'Balance', render: (i) => formatCents(i.balanceCents), align: 'right' },
            ]}
          />
          <Pagination page={page} pageSize={25} total={invoices.data.meta.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
