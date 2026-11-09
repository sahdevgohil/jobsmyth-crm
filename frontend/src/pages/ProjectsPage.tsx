import { Link } from 'react-router-dom';
import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';

type Proj = {
  id: string;
  number: string;
  customerId: string;
  status: string;
  priority: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  budgetCents: number;
};

const STATUSES = ['awaiting_approval', 'approved', 'planning', 'scheduled', 'materials_preparation', 'in_progress', 'on_hold', 'quality_review', 'completed', 'closed', 'cancelled'];
const d = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-US') : '—');

export function ProjectsPage(): React.ReactElement {
  const canCreate = useHasPermission('projects:create');
  return (
    <ListPage<Proj>
      title="Projects"
      description="Active and completed jobs. Projects are usually created once a proposal is accepted."
      queryKey="projects"
      path="/projects"
      searchPlaceholder="Search project number"
      filters={[{ key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) }]}
      actions={canCreate ? <Button asChild><Link to="/app/projects/new">New project</Link></Button> : null}
      customerIdOf={(p) => p.customerId}
      rowHref={(p) => `/app/projects/${p.id}`}
      emptyTitle="No projects match"
      emptyHint="Create a project from an accepted proposal or manually."
      columns={({ customerName }) => [
        { key: 'n', header: 'Project', render: (p) => p.number },
        { key: 'c', header: 'Customer', render: (p) => customerName(p.customerId) },
        { key: 'sch', header: 'Planned', render: (p) => `${d(p.plannedStartAt)} → ${d(p.plannedEndAt)}`, hideOnMobile: true },
        { key: 'pr', header: 'Priority', render: (p) => <StatusBadge status={p.priority} />, hideOnMobile: true },
        { key: 'b', header: 'Budget', render: (p) => formatCents(p.budgetCents), align: 'right', hideOnMobile: true },
        { key: 's', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
      ]}
    />
  );
}
