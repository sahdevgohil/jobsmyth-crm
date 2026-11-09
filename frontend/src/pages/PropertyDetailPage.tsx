import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FilePanel } from '@/components/shared/FilePanel';
import { PageHeader } from '@/components/shared/PageHeader';
import { RelatedTable } from '@/components/shared/RelatedTable';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TabPanel, Tabs } from '@/components/shared/Tabs';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';
import { useCustomerSummary } from '@/modules/customers/api';
import type { Property } from '@/modules/customers/types';
import { apiFetch } from '@/services/http';
import { ApiError } from '@/types/api';

type Row = { id: string };
const date = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString('en-US') : '—');

export function PropertyDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const [tab, setTab] = useState('overview');
  const query = useQuery({
    queryKey: ['properties', id],
    queryFn: () => apiFetch<{ data: Property }>(`/properties/${id}`),
    enabled: Boolean(id),
  });
  const customerId = query.data?.data.customerId ?? '';
  const customer = useCustomerSummary(customerId);
  const canInsp = useHasPermission('inspections:read');
  const canMeas = useHasPermission('measurements:read');
  const canProj = useHasPermission('projects:read');
  const canFiles = useHasPermission('files:read');
  const canUpload = useHasPermission('files:create');
  const canNewInsp = useHasPermission('inspections:create');

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return <ErrorState message={query.error instanceof ApiError ? query.error.message : 'Property not found.'} onRetry={() => void query.refetch()} />;
  }
  const p = query.data.data;
  const c = customer.data?.data.customer;
  const q = { propertyId: p.id };
  const tabs = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'inspections', label: 'Inspections', show: canInsp },
    { key: 'measurements', label: 'Measurements', show: canMeas },
    { key: 'projects', label: 'Projects', show: canProj },
    { key: 'files', label: 'Photos & documents', show: canFiles },
  ].filter((t) => t.show);
  const panel = (key: string, node: React.ReactNode): React.ReactElement | null => (tab === key ? <TabPanel id={key}>{node}</TabPanel> : null);

  return (
    <div>
      <PageHeader
        title={p.address.line1}
        description={`${p.address.city}, ${p.address.state} ${p.address.zip}`}
        actions={
          <>
            {canNewInsp ? <Button asChild><Link to={`/app/inspections/new?customerId=${p.customerId}&propertyId=${p.id}`}>New inspection</Link></Button> : null}
            <Button asChild variant="outline"><Link to={`/app/customers/${p.customerId}`}>Customer</Link></Button>
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {panel('overview', (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Property &amp; roof</h2>
            <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Address</dt><dd>{p.address.line1}{p.address.line2 ? `, ${p.address.line2}` : ''}, {p.address.city}, {p.address.state} {p.address.zip}</dd>
              <dt className="text-muted-foreground">Property type</dt><dd className="capitalize">{(p.propertyTypeKey || '—').replace(/_/g, ' ')}</dd>
              <dt className="text-muted-foreground">Stories</dt><dd>{p.details?.stories ?? '—'}</dd>
              <dt className="text-muted-foreground">Roof age</dt><dd>{p.details?.roofAgeYears != null ? `${p.details.roofAgeYears} years` : '—'}</dd>
              <dt className="text-muted-foreground">Notes</dt><dd>{p.details?.notes || '—'}</dd>
            </dl>
          </section>
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Customer</h2>
            {c ? (
              <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Name</dt><dd><Link className="hover:underline" to={`/app/customers/${c.id}`}>{c.type === 'business' ? c.companyName : `${c.firstName} ${c.lastName}`.trim()}</Link></dd>
                <dt className="text-muted-foreground">Phone</dt><dd>{c.phone || '—'}</dd>
                <dt className="text-muted-foreground">Email</dt><dd>{c.email || '—'}</dd>
              </dl>
            ) : <p className="text-sm text-muted-foreground">Loading…</p>}
          </section>
        </div>
      ))}
      {panel('inspections', (
        <RelatedTable<Row & { status: string; inspectionDate: string; roofCondition: string }> queryKey="prop-insp" path="/inspections" params={q} rowHref={(r) => `/app/inspections/${r.id}`} emptyTitle="No inspections for this property" columns={[
          { key: 'd', header: 'Date', render: (r) => date(r.inspectionDate) },
          { key: 'c', header: 'Roof condition', render: (r) => r.roofCondition || '—', hideOnMobile: true },
          { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      ))}
      {panel('measurements', (
        <RelatedTable<Row & { measurementDate: string; totalArea: number | null; units: string; pitch: string; source: string }> queryKey="prop-meas" path="/measurements" params={q} rowHref={(r) => `/app/measurements/${r.id}`} emptyTitle="No measurements for this property" columns={[
          { key: 'd', header: 'Date', render: (r) => date(r.measurementDate) },
          { key: 'a', header: 'Area', render: (r) => (r.totalArea != null ? `${r.totalArea.toLocaleString('en-US')} ${r.units.replace('_', ' ')}` : '—') },
          { key: 'p', header: 'Pitch', render: (r) => r.pitch || '—', hideOnMobile: true },
          { key: 's', header: 'Source', render: (r) => statusLabel(r.source), hideOnMobile: true },
        ]} />
      ))}
      {panel('projects', (
        <RelatedTable<Row & { number: string; status: string; propertyId: string; plannedStartAt: string | null }> queryKey="prop-proj" path="/projects" params={{ customerId: p.customerId }} rowHref={(r) => `/app/projects/${r.id}`} emptyTitle="No projects for this property" columns={[
          { key: 'n', header: 'Project', render: (r) => r.number },
          { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'd', header: 'Planned start', render: (r) => date(r.plannedStartAt), hideOnMobile: true },
        ]} />
      ))}
      {panel('files', <FilePanel link={{ propertyId: p.id }} category="photo" canUpload={canUpload} />)}
    </div>
  );
}
