import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatCents } from '@/lib/money';
import { statusLabel } from '@/lib/status';

type Prop = {
  id: string;
  number: string;
  customerId: string;
  status: string;
  version: number;
  totalCents: number;
  expirationDate?: string | null;
};

export function ProposalsPage(): React.ReactElement {
  return (
    <ListPage<Prop>
      title="Proposals"
      description="Proposals are immutable snapshots of an estimate. Approval is tracked here; e-signature is not connected."
      queryKey="proposals"
      path="/proposals"
      searchPlaceholder="Search proposal number"
      filters={[{ key: 'status', label: 'Status', options: ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'void'].map((s) => ({ value: s, label: statusLabel(s) })) }]}
      customerIdOf={(p) => p.customerId}
      rowHref={(p) => `/app/proposals/${p.id}`}
      emptyTitle="No proposals match"
      emptyHint="Create a proposal from an estimate."
      columns={({ customerName }) => [
        { key: 'n', header: 'Proposal', render: (p) => <span>{p.number}<span className="ml-2 text-xs font-normal text-muted-foreground">v{p.version}</span></span> },
        { key: 'c', header: 'Customer', render: (p) => customerName(p.customerId) },
        { key: 'e', header: 'Expires', render: (p) => (p.expirationDate ? new Date(p.expirationDate).toLocaleDateString('en-US') : '—'), hideOnMobile: true },
        { key: 's', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { key: 't', header: 'Total', render: (p) => formatCents(p.totalCents), align: 'right' },
      ]}
    />
  );
}
