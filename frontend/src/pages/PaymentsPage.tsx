import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { formatCents } from '@/lib/money';
import { useListQuery, type PaymentRow } from '@/modules/operations/api';

export function PaymentsPage(): React.ReactElement {
  const [page, setPage] = useState(1);
  const q = useListQuery<PaymentRow>('payments', '/payments', { page, pageSize: 25 });
  return (
    <div>
      <PageHeader
        title="Payments"
        description="Recorded payments across all invoices. Record a payment from the invoice itself."
      />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Failed to load payments." onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <DataTable
            rows={q.data.data}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No payments recorded" description="Payments appear here once recorded against an invoice." />}
            columns={[
              { key: 'date', header: 'Date', render: (r) => new Date(r.paymentDate).toLocaleDateString('en-US') },
              { key: 'inv', header: 'Invoice', render: (r) => <Link className="text-brand hover:underline" to={`/app/invoices/${r.invoiceId}`}>{r.invoiceNumber || 'Invoice'}</Link> },
              { key: 'method', header: 'Method', render: (r) => r.method.replace(/_/g, ' ') },
              { key: 'ref', header: 'Reference', render: (r) => r.transactionRef || '—', hideOnMobile: true },
              { key: 'amt', header: 'Amount', render: (r) => formatCents(r.amountCents), align: 'right' },
            ]}
          />
          <Pagination page={page} pageSize={25} total={q.data.meta.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
