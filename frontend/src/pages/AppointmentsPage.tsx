import { Link } from 'react-router-dom';
import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';
import { useStaffDirectory } from '@/modules/users/api';

type Appt = {
  id: string;
  title: string;
  typeKey: string;
  status: string;
  customerId: string | null;
  assignedTo: string;
  startAt: string;
  timeZone: string;
  location: string;
};

function when(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('en-US');
  }
}

export function AppointmentsPage(): React.ReactElement {
  const canCreate = useHasPermission('appointments:create');
  const isAdmin = useHasPermission('leads:assign');
  const staff = useStaffDirectory();
  const name = (id: string): string => {
    const u = staff.data?.data.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : '—';
  };
  return (
    <ListPage<Appt>
      title="Appointments"
      description="Visits, inspections and consultations. Times are shown in each appointment time zone."
      queryKey="appointments"
      path="/appointments"
      searchPlaceholder="Search title or location"
      filters={[
        { key: 'status', label: 'Status', options: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'].map((s) => ({ value: s, label: statusLabel(s) })) },
        { key: 'typeKey', label: 'Type', options: ['inspection', 'sales_consultation', 'estimate_presentation', 'production_walkthrough', 'other'].map((s) => ({ value: s, label: statusLabel(s) })) },
        ...(isAdmin ? [{ key: 'assignedTo', label: 'Assigned to', options: (staff.data?.data ?? []).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` })) }] : []),
      ]}
      actions={
        <>
          <Button asChild variant="outline"><Link to="/app/appointments/calendar">Calendar</Link></Button>
          {canCreate ? <Button asChild><Link to="/app/appointments/new">New appointment</Link></Button> : null}
        </>
      }
      rowHref={(a) => `/app/appointments/${a.id}`}
      emptyTitle="No appointments match"
      emptyHint="Adjust the filters or schedule a new appointment."
      columns={[
        { key: 't', header: 'Appointment', render: (a) => <span>{a.title}<span className="block text-xs font-normal text-muted-foreground">{statusLabel(a.typeKey)}</span></span> },
        { key: 'w', header: 'When', render: (a) => when(a.startAt, a.timeZone) },
        { key: 'who', header: 'Assigned', render: (a) => name(a.assignedTo), hideOnMobile: true },
        { key: 'loc', header: 'Location', render: (a) => a.location || '—', hideOnMobile: true },
        { key: 's', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
      ]}
    />
  );
}
