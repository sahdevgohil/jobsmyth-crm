import { Link } from 'react-router-dom';
import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';

type Est = {
  id: string;
  number: string;
  customerId: string;
  status: string;
  version: number;
  totalCents: number;
  createdAt: string;
};

export function EstimatesPage(): React.ReactElement {
  const canCreate = useHasPermission('estimates:create');
  return (
    <ListPage<Est>
      title="Estimates"
      description="Draft, version and print customer estimates. Totals are calculated by the server."
      queryKey="estimates"
      path="/estimates"
      filters={[{ key: 'status', label: 'Status', options: ['draft', 'sent', 'accepted', 'denied', 'expired', 'void'].map((s) => ({ value: s, label: statusLabel(s) })) }]}
      actions={canCreate ? <Button asChild><Link to="/app/estimates/new">New estimate</Link></Button> : null}
      customerIdOf={(e) => e.customerId}
      rowHref={(e) => `/app/estimates/${e.id}`}
      emptyTitle="No estimates match"
      emptyHint="Create an estimate from an inspection or measurement."
      columns={({ customerName }) => [
        { key: 'n', header: 'Estimate', render: (e) => <span>{e.number}<span className="ml-2 text-xs font-normal text-muted-foreground">v{e.version}</span></span> },
        { key: 'c', header: 'Customer', render: (e) => customerName(e.customerId) },
        { key: 'd', header: 'Created', render: (e) => new Date(e.createdAt).toLocaleDateString('en-US'), hideOnMobile: true },
        { key: 's', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
        { key: 't', header: 'Total', render: (e) => formatCents(e.totalCents), align: 'right' },
      ]}
    />
  );
}
