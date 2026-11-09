import { Link } from 'react-router-dom';
import { ListPage } from '@/components/shared/ListPage';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';
import { useMeasurementIntegrations } from '@/modules/measurements/api';

type Meas = {
  id: string;
  customerId: string;
  measurementDate: string;
  totalArea: number | null;
  units: string;
  pitch: string;
  source: string;
};

export function MeasurementsPage(): React.ReactElement {
  const canCreate = useHasPermission('measurements:create');
  const canOrder = useHasPermission('measurements:order');
  const canManage = useHasPermission('measurements:manage');
  const integrations = useMeasurementIntegrations();
  return (
    <ListPage<Meas>
      title="Measurements"
      description="Roof measurements from Google Solar (address lookup), entered manually, or recorded from a report on file."
      queryKey="measurements"
      path="/measurements"
      filters={[{ key: 'source', label: 'Source', options: ['manual', 'import', 'external', 'google_solar'].map((s) => ({ value: s, label: statusLabel(s) })) }]}
      actions={
        <>
          {canOrder ? <Button asChild><Link to="/app/measurements/solar/new">Measure from address</Link></Button> : null}
          {canCreate ? <Button asChild variant="outline"><Link to="/app/measurements/new">Enter manually</Link></Button> : null}
          {canManage ? <Button asChild variant="outline"><Link to="/app/measurements/usage">Integration &amp; usage</Link></Button> : null}
        </>
      }
      extra={() =>
        integrations.data ? (
          <ul className="mb-4 space-y-1 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
            {integrations.data.data.providers.map((p) => (
              <li key={p.id}>
                <span className="font-medium text-foreground">{p.id}</span>: {p.status.replace('_', ' ')} — {p.message}
              </li>
            ))}
          </ul>
        ) : null
      }
      customerIdOf={(m) => m.customerId}
      rowHref={(m) => `/app/measurements/${m.id}`}
      emptyTitle="No measurements"
      emptyHint="Add a measurement for a property."
      columns={({ customerName }) => [
        { key: 'a', header: 'Area', render: (m) => (m.totalArea !== null ? `${m.totalArea.toLocaleString('en-US')} ${m.units.replace('_', ' ')}` : 'No area') },
        { key: 'c', header: 'Customer', render: (m) => customerName(m.customerId) },
        { key: 'p', header: 'Pitch', render: (m) => m.pitch || '—', hideOnMobile: true },
        { key: 'd', header: 'Date', render: (m) => new Date(m.measurementDate).toLocaleDateString('en-US'), hideOnMobile: true },
        { key: 's', header: 'Source', render: (m) => <StatusBadge status={m.source === 'manual' ? 'manual_only' : m.source} /> },
      ]}
    />
  );
}
