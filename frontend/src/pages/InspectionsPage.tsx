import { Link } from 'react-router-dom';
import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';

type Insp = {
  id: string;
  customerId: string;
  typeKey: string;
  status: string;
  inspectionDate: string;
  roofCondition: string;
  findings: string;
};

export function InspectionsPage(): React.ReactElement {
  const canCreate = useHasPermission('inspections:create');
  return (
    <ListPage<Insp>
      title="Inspections"
      description="Roof condition, findings, photos and printable reports."
      queryKey="inspections"
      path="/inspections"
      filters={[{ key: 'status', label: 'Status', options: ['draft', 'in_progress', 'completed', 'cancelled'].map((s) => ({ value: s, label: statusLabel(s) })) }]}
      actions={canCreate ? <Button asChild><Link to="/app/inspections/new">New inspection</Link></Button> : null}
      customerIdOf={(i) => i.customerId}
      rowHref={(i) => `/app/inspections/${i.id}`}
      emptyTitle="No inspections match"
      emptyHint="Create an inspection from a customer property."
      columns={({ customerName }) => [
        { key: 'd', header: 'Date', render: (i) => new Date(i.inspectionDate).toLocaleDateString('en-US') },
        { key: 'c', header: 'Customer', render: (i) => customerName(i.customerId) },
        { key: 'f', header: 'Roof condition / findings', render: (i) => <span className="line-clamp-1">{i.roofCondition || i.findings || 'Not recorded yet'}</span>, hideOnMobile: true },
        { key: 's', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
      ]}
    />
  );
}
