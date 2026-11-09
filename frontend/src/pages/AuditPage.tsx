import { ListPage } from '@/components/shared/ListPage';
import { useStaffDirectory } from '@/modules/users/api';

type Audit = {
  id: string;
  actorType: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
};

export function AuditPage(): React.ReactElement {
  const staff = useStaffDirectory();
  const actor = (a: Audit): string => {
    const u = staff.data?.data.find((x) => x.id === a.actorId);
    return u ? `${u.firstName} ${u.lastName}` : a.actorType;
  };
  return (
    <ListPage<Audit>
      title="Audit logs"
      description="Immutable record of important actions. Entries cannot be edited or deleted."
      queryKey="audit-logs"
      path="/audit-logs"
      filters={[{ key: 'entityType', label: 'Entity', options: ['user', 'lead', 'customer', 'project', 'invoice', 'payment', 'proposal', 'estimate', 'file'].map((s) => ({ value: s, label: s })) }]}
      emptyTitle="No audit entries"
      columns={[
        { key: 'w', header: 'When', render: (a) => new Date(a.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago' }) },
        { key: 'a', header: 'Action', render: (a) => a.action },
        { key: 'e', header: 'Entity', render: (a) => <span>{a.entityType}<span className="ml-1 font-mono text-xs text-muted-foreground">{a.entityId.slice(-6)}</span></span>, hideOnMobile: true },
        { key: 'u', header: 'Actor', render: actor },
      ]}
    />
  );
}
