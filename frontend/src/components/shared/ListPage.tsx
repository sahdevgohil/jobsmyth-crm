import { useState } from 'react';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FilterBar, SearchInput, SelectFilter } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { useCustomerNames } from '@/modules/customers/api';
import { useListQuery } from '@/modules/operations/api';

export type ListContext = { customerName: (id: string) => string };

export type FilterDef = { key: string; label: string; options: Array<{ value: string; label: string }> };

/**
 * Standard branded list page: header, search, filters, table, loading / empty / error states and
 * pagination, driven by a paginated list API. Only pass filters the endpoint's query schema supports.
 */
export function ListPage<T extends { id: string }>({
  title,
  description,
  actions,
  queryKey,
  path,
  searchPlaceholder,
  filters = [],
  columns,
  customerIdOf,
  rowHref,
  emptyTitle,
  emptyHint,
  emptyAction,
  pageSize = 25,
  fixedParams = {},
  extra,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  queryKey: string;
  path: string;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  /** Columns, or a function of the shared context (e.g. resolved customer names). */
  columns: Column<T>[] | ((ctx: ListContext) => Column<T>[]);
  /** When set, customer names are resolved for the loaded rows and passed to `columns`. */
  customerIdOf?: (row: T) => string;
  rowHref?: (row: T) => string;
  emptyTitle: string;
  emptyHint?: string;
  emptyAction?: React.ReactNode;
  pageSize?: number;
  fixedParams?: Record<string, string | undefined>;
  /** Rendered above the filters (e.g. summary cards), receives the loaded rows. */
  extra?: (rows: T[]) => React.ReactNode;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const q = useListQuery<T>(queryKey, path, { ...fixedParams, ...values, search: search || undefined, page, pageSize });

  const customerName = useCustomerNames(customerIdOf ? (q.data?.data ?? []).map(customerIdOf) : []);
  const resolved = typeof columns === 'function' ? columns({ customerName }) : columns;

  return (
    <div>
      <PageHeader title={title} description={description} actions={actions} />
      {extra ? extra(q.data?.data ?? []) : null}
      {searchPlaceholder || filters.length > 0 ? (
        <FilterBar>
          {searchPlaceholder ? <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={searchPlaceholder} /> : null}
          {filters.map((f) => (
            <SelectFilter key={f.key} label={f.label} value={values[f.key] ?? ''} options={f.options} onChange={(v) => { setValues((s) => ({ ...s, [f.key]: v })); setPage(1); }} />
          ))}
        </FilterBar>
      ) : null}
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message={`Failed to load ${title.toLowerCase()}.`} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <DataTable
            rows={q.data.data}
            rowKey={(r) => r.id}
            rowHref={rowHref}
            columns={resolved}
            empty={<EmptyState title={emptyTitle} description={emptyHint} action={emptyAction} />}
          />
          <Pagination page={page} pageSize={pageSize} total={q.data.meta?.total ?? q.data.data.length} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
