import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar, SearchInput } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { useListQuery, type PropertyRow } from '@/modules/operations/api';

export function PropertiesPage(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useListQuery<PropertyRow>('properties', '/properties', { search, page, pageSize: 25 });

  return (
    <div>
      <PageHeader title="Properties" description="Every property on file, with its customer and roof details." />
      <FilterBar>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search address, city or ZIP"
        />
      </FilterBar>
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Failed to load properties." onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <DataTable
            rows={q.data.data}
            rowKey={(r) => r.id}
            rowHref={(r) => `/app/properties/${r.id}`}
            empty={<EmptyState title="No properties found" description="Properties are created from a customer record." />}
            columns={[
              { key: 'addr', header: 'Address', render: (r) => `${r.address.line1}${r.address.line2 ? `, ${r.address.line2}` : ''}` },
              { key: 'city', header: 'City', render: (r) => `${r.address.city}, ${r.address.state} ${r.address.zip}`, hideOnMobile: true },
              { key: 'cust', header: 'Customer', render: (r) => <Link className="hover:underline" to={`/app/customers/${r.customerId}`}>{r.customerName || 'Customer'}</Link> },
              { key: 'type', header: 'Type', render: (r) => (r.propertyTypeKey || '—').replace(/_/g, ' '), hideOnMobile: true },
              { key: 'roof', header: 'Roof age', render: (r) => (r.details.roofAgeYears != null ? `${r.details.roofAgeYears} yrs` : '—'), hideOnMobile: true, align: 'right' },
            ]}
          />
          <Pagination page={page} pageSize={25} total={q.data.meta.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
