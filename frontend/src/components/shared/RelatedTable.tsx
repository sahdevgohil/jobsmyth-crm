import { useState } from 'react';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Pagination } from '@/components/shared/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { useListQuery } from '@/modules/operations/api';

/**
 * Loads one related collection from its real list API (filtered by the parent record) and renders it
 * with the standard branded table. Mount it only when its tab is active so requests stay lazy.
 */
export function RelatedTable<T extends { id: string }>({
  queryKey,
  path,
  params,
  columns,
  rowHref,
  emptyTitle,
  emptyHint,
  pageSize = 10,
}: {
  queryKey: string;
  path: string;
  params: Record<string, string | undefined>;
  columns: Column<T>[];
  rowHref?: (row: T) => string;
  emptyTitle: string;
  emptyHint?: string;
  pageSize?: number;
}): React.ReactElement {
  const [page, setPage] = useState(1);
  const q = useListQuery<T>(queryKey, path, { ...params, page, pageSize });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={`Could not load ${emptyTitle.toLowerCase()}.`} onRetry={() => void q.refetch()} />;
  const rows = q.data?.data ?? [];
  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={rowHref}
        columns={columns}
        empty={<EmptyState title={emptyTitle} description={emptyHint} />}
      />
      {q.data?.meta ? <Pagination page={page} pageSize={pageSize} total={q.data.meta.total} onPage={setPage} /> : null}
    </>
  );
}
