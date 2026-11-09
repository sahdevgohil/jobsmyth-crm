import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FilterBar, SearchInput } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { useCustomers } from '@/modules/customers/api';
import { ApiError } from '@/types/api';

export function CustomersPage(): React.ReactElement {
  const [search, setSearch] = useState('');
  const customers = useCustomers(search);
  const canCreate = useHasPermission('customers:create');

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Customers, their properties and full history."
        actions={
          canCreate ? (
            <Button asChild>
              <Link to="/app/customers/new">New customer</Link>
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone or email" />
      </FilterBar>
      {customers.isLoading ? <LoadingState /> : null}
      {customers.isError ? (
        <ErrorState
          message={customers.error instanceof ApiError ? customers.error.message : 'Failed to load customers.'}
          onRetry={() => void customers.refetch()}
        />
      ) : null}
      {customers.data ? (
        <DataTable
          rows={customers.data.data}
          rowKey={(c) => c.id}
          rowHref={(c) => `/app/customers/${c.id}`}
          empty={<EmptyState title="No customers found" description="Convert a lead or create a customer." />}
          columns={[
            { key: 'name', header: 'Customer', render: (c) => (c.type === 'business' ? c.companyName : `${c.firstName} ${c.lastName}`.trim()) },
            { key: 'type', header: 'Type', render: (c) => <StatusBadge status={c.type} tone="neutral" />, hideOnMobile: true },
            { key: 'phone', header: 'Phone', render: (c) => c.phone || '—' },
            { key: 'email', header: 'Email', render: (c) => c.email || '—', hideOnMobile: true },
          ]}
        />
      ) : null}
    </div>
  );
}
