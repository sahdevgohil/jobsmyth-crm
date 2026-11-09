import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FilePanel } from '@/components/shared/FilePanel';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { RelatedTable } from '@/components/shared/RelatedTable';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TabPanel, Tabs } from '@/components/shared/Tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCents } from '@/lib/money';
import { useHasPermission } from '@/lib/permissions';
import {
  useArchiveCustomer,
  useCreatePortalAccount,
  useCreateProperty,
  useCustomerSummary,
  usePortalAccountStatus,
  useUpdateCustomer,
} from '@/modules/customers/api';
import { usePipelineStages } from '@/modules/leads/api';
import { ApiError } from '@/types/api';

const date = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString('en-US') : '—');
const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

type Row = { id: string };

function Overview({ id }: { id: string }): React.ReactElement {
  const summary = useCustomerSummary(id);
  const update = useUpdateCustomer(id);
  const canUpdate = useHasPermission('customers:update');
  const canPortal = useHasPermission('portal:manage');
  const portal = usePortalAccountStatus(id, canPortal || canUpdate);
  const createPortal = useCreatePortalAccount(id);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ firstName: '', lastName: '', companyName: '', email: '', phone: '', notes: '' });
  const [inv, setInv] = useState({ email: '', temporaryPassword: '' });
  const [err, setErr] = useState<string | null>(null);
  if (!summary.data) return <LoadingState />;
  const c = summary.data.data.customer;

  function startEdit(): void {
    setF({ firstName: c.firstName, lastName: c.lastName, companyName: c.companyName, email: c.email, phone: c.phone, notes: c.notes });
    setEditing(true);
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Contact details</h2>
          {canUpdate && !editing && !c.archivedAt ? <Button size="sm" variant="outline" onClick={startEdit}>Edit</Button> : null}
        </div>
        {editing ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setErr(null);
              update.mutate(f, {
                onSuccess: () => {
                  setEditing(false);
                  void summary.refetch();
                },
                onError: (er) => setErr(er instanceof ApiError ? er.message : 'Could not save.'),
              });
            }}
          >
            {c.type === 'business' ? (
              <div className="sm:col-span-2"><FormField label="Company" htmlFor="c-company"><Input id="c-company" value={f.companyName} onChange={set('companyName')} /></FormField></div>
            ) : (
              <>
                <FormField label="First name" htmlFor="c-first"><Input id="c-first" value={f.firstName} onChange={set('firstName')} /></FormField>
                <FormField label="Last name" htmlFor="c-last"><Input id="c-last" value={f.lastName} onChange={set('lastName')} /></FormField>
              </>
            )}
            <FormField label="Email" htmlFor="c-email"><Input id="c-email" type="email" value={f.email} onChange={set('email')} /></FormField>
            <FormField label="Phone" htmlFor="c-phone"><Input id="c-phone" value={f.phone} onChange={set('phone')} /></FormField>
            <div className="sm:col-span-2"><FormField label="Notes" htmlFor="c-notes"><Input id="c-notes" value={f.notes} onChange={set('notes')} /></FormField></div>
            {err ? <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p> : null}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={update.isPending}>Save</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Type</dt><dd className="capitalize">{c.type}</dd>
            <dt className="text-muted-foreground">Phone</dt><dd>{c.phone || '—'}</dd>
            <dt className="text-muted-foreground">Email</dt><dd>{c.email || '—'}</dd>
            <dt className="text-muted-foreground">Customer since</dt><dd>{date(c.createdAt)}</dd>
            <dt className="text-muted-foreground">Notes</dt><dd>{c.notes || '—'}</dd>
          </dl>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Customer portal</h2>
        {portal.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : null}
        {portal.data?.data.exists ? (
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Account</dt><dd>{portal.data.data.email}</dd>
            <dt className="text-muted-foreground">Status</dt><dd><StatusBadge status={portal.data.data.isActive ? 'active' : 'inactive'} /></dd>
            <dt className="text-muted-foreground">Password</dt><dd>{portal.data.data.mustChangePassword ? 'Temporary — change required at first login' : 'Set by customer'}</dd>
            <dt className="text-muted-foreground">Last login</dt><dd>{portal.data.data.lastLoginAt ? dateTime(portal.data.data.lastLoginAt) : 'Never'}</dd>
          </dl>
        ) : null}
        {portal.data && !portal.data.data.exists ? (
          canPortal ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                createPortal.mutate(
                  { email: inv.email, temporaryPassword: inv.temporaryPassword, firstName: c.firstName || c.companyName || 'Customer', lastName: c.lastName || 'Account' },
                  { onError: (er) => setErr(er instanceof ApiError ? er.message : 'Could not create the account.') },
                );
              }}
            >
              <p className="text-sm text-muted-foreground">No portal account yet. Give the customer a temporary password; they must change it at first sign-in.</p>
              <FormField label="Portal email" htmlFor="p-email"><Input id="p-email" type="email" required value={inv.email} onChange={(e) => setInv((v) => ({ ...v, email: e.target.value }))} /></FormField>
              <FormField label="Temporary password" htmlFor="p-pass" hint="At least 12 characters"><Input id="p-pass" type="password" required minLength={12} value={inv.temporaryPassword} onChange={(e) => setInv((v) => ({ ...v, temporaryPassword: e.target.value }))} /></FormField>
              {err ? <p role="alert" className="text-sm text-danger">{err}</p> : null}
              <Button type="submit" disabled={createPortal.isPending}>Create portal account</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">No portal account.</p>
          )
        ) : null}
        {portal.isError ? <p className="text-sm text-muted-foreground">Portal status is not available for your role.</p> : null}
      </section>
    </div>
  );
}

function Properties({ id }: { id: string }): React.ReactElement {
  const summary = useCustomerSummary(id);
  const create = useCreateProperty(id);
  const canCreate = useHasPermission('properties:create');
  const [f, setF] = useState({ line1: '', city: '', zip: '' });
  const props = summary.data?.data.properties ?? [];
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
        {props.map((p) => (
          <li key={p.id}>
            <Link to={`/app/properties/${p.id}`} className="flex justify-between gap-3 px-4 py-3 hover:bg-muted/40">
              <span className="font-medium text-foreground">{p.address.line1}</span>
              <span className="text-sm text-muted-foreground">{p.address.city}, {p.address.state} {p.address.zip}</span>
            </Link>
          </li>
        ))}
        {props.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">No properties yet.</li> : null}
      </ul>
      {canCreate ? (
        <form
          className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ address: { line1: f.line1, city: f.city, zip: f.zip, state: 'TX' }, propertyTypeKey: 'single_family' }, { onSuccess: () => setF({ line1: '', city: '', zip: '' }) });
          }}
        >
          <div className="sm:col-span-2"><FormField label="Street" htmlFor="np-street"><Input id="np-street" required value={f.line1} onChange={(e) => setF((v) => ({ ...v, line1: e.target.value }))} /></FormField></div>
          <FormField label="City" htmlFor="np-city"><Input id="np-city" value={f.city} onChange={(e) => setF((v) => ({ ...v, city: e.target.value }))} /></FormField>
          <FormField label="ZIP" htmlFor="np-zip"><Input id="np-zip" required value={f.zip} onChange={(e) => setF((v) => ({ ...v, zip: e.target.value }))} /></FormField>
          <Button type="submit" className="sm:col-span-4" disabled={create.isPending}>Add property</Button>
        </form>
      ) : null}
    </div>
  );
}

function Leads({ id }: { id: string }): React.ReactElement {
  const summary = useCustomerSummary(id);
  const stages = usePipelineStages();
  const leads = summary.data?.data.relatedLeads ?? [];
  const stage = (sid: string): string => stages.data?.data.find((s) => s.id === sid)?.name ?? '—';
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
      {leads.map((l) => (
        <li key={l.id}>
          <Link to={`/app/leads/${l.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
            <span className="font-medium text-foreground">{l.name}</span>
            <span className="flex items-center gap-3 text-sm text-muted-foreground">{date(l.createdAt)} <StatusBadge status={stage(l.stageId)} tone="neutral" /></span>
          </Link>
        </li>
      ))}
      {leads.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">No related leads.</li> : null}
    </ul>
  );
}

type Appt = Row & { title: string; status: string; startAt: string; typeKey: string };
type Insp = Row & { status: string; inspectionDate: string; roofCondition: string };
type Meas = Row & { measurementDate: string; totalArea: number | null; units: string; pitch: string };
type Doc = Row & { number: string; status: string; totalCents: number; version?: number };
type Proj = Row & { number: string; status: string; priority: string; plannedStartAt: string | null };
type Inv = Row & { number: string; status: string; totalCents: number; balanceCents: number };
type Pay = Row & { invoiceId: string; invoiceNumber: string; amountCents: number; paymentDate: string; method: string };
type Comm = Row & { channel: string; direction: string; subject: string; body: string; deliveryStatus: string; createdAt: string };
type After = Row & { projectId: string; feedbackRating: number | null; followUpDueAt: string | null; completionConfirmedAt: string | null };

export function CustomerDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const summary = useCustomerSummary(id);
  const archive = useArchiveCustomer();
  const [tab, setTab] = useState('overview');
  const can = {
    appt: useHasPermission('appointments:read'),
    insp: useHasPermission('inspections:read'),
    meas: useHasPermission('measurements:read'),
    est: useHasPermission('estimates:read'),
    prop: useHasPermission('proposals:read'),
    proj: useHasPermission('projects:read'),
    inv: useHasPermission('invoices:read'),
    pay: useHasPermission('payments:read'),
    files: useHasPermission('files:read'),
    comm: useHasPermission('communications:read'),
    after: useHasPermission('after_sales:read'),
    upload: useHasPermission('files:create'),
    archive: useHasPermission('customers:archive'),
    newAppt: useHasPermission('appointments:create'),
    newEst: useHasPermission('estimates:create'),
    newProj: useHasPermission('projects:create'),
    newInv: useHasPermission('invoices:create'),
  };

  if (summary.isLoading) return <LoadingState />;
  if (summary.isError || !summary.data) {
    return <ErrorState message={summary.error instanceof ApiError ? summary.error.message : 'Customer not found.'} onRetry={() => void summary.refetch()} />;
  }
  const { customer, properties, relatedLeads } = summary.data.data;
  const q = { customerId: id };

  const tabs = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'properties', label: 'Properties', show: true, count: properties.length },
    { key: 'leads', label: 'Leads', show: true, count: relatedLeads.length },
    { key: 'appointments', label: 'Appointments', show: can.appt },
    { key: 'inspections', label: 'Inspections', show: can.insp },
    { key: 'measurements', label: 'Measurements', show: can.meas },
    { key: 'estimates', label: 'Estimates', show: can.est },
    { key: 'proposals', label: 'Proposals', show: can.prop },
    { key: 'projects', label: 'Projects', show: can.proj },
    { key: 'invoices', label: 'Invoices', show: can.inv },
    { key: 'payments', label: 'Payments', show: can.pay },
    { key: 'documents', label: 'Documents', show: can.files },
    { key: 'communications', label: 'Communications', show: can.comm },
    { key: 'aftersales', label: 'After-sales', show: can.after },
  ].filter((t) => t.show);

  const name = customer.type === 'business' ? customer.companyName : `${customer.firstName} ${customer.lastName}`.trim();
  const state = (key: string, children: React.ReactNode): React.ReactElement | null => (tab === key ? <TabPanel id={key}>{children}</TabPanel> : null);

  return (
    <div>
      <PageHeader
        title={name}
        description={[customer.phone, customer.email].filter(Boolean).join(' · ') || 'Customer'}
        actions={
          <>
            {customer.archivedAt ? <StatusBadge status="archived" tone="neutral" /> : null}
            {can.newAppt ? <Button asChild variant="outline"><Link to="/app/appointments/new">Schedule</Link></Button> : null}
            {can.newEst ? <Button asChild variant="outline"><Link to="/app/estimates/new">Estimate</Link></Button> : null}
            {can.newProj ? <Button asChild variant="outline"><Link to="/app/projects/new">Project</Link></Button> : null}
            {can.newInv ? <Button asChild variant="outline"><Link to="/app/invoices/new">Invoice</Link></Button> : null}
            {can.archive && !customer.archivedAt ? (
              <Button variant="outline" disabled={archive.isPending} onClick={() => { if (window.confirm('Archive this customer?')) void archive.mutateAsync(id); }}>Archive</Button>
            ) : null}
          </>
        }
      />
      <Tabs tabs={tabs.map(({ key, label, ...r }) => ({ key, label, count: (r as { count?: number }).count }))} active={tab} onChange={setTab} />

      {state('overview', <Overview id={id} />)}
      {state('properties', <Properties id={id} />)}
      {state('leads', <Leads id={id} />)}
      {state('appointments', <RelatedTable<Appt> queryKey="cust-appts" path="/appointments" params={q} rowHref={(r) => `/app/appointments/${r.id}`} emptyTitle="No appointments" columns={[
        { key: 't', header: 'Appointment', render: (r) => r.title },
        { key: 'w', header: 'When', render: (r) => dateTime(r.startAt) },
        { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]} />)}
      {state('inspections', <RelatedTable<Insp> queryKey="cust-insp" path="/inspections" params={q} rowHref={(r) => `/app/inspections/${r.id}`} emptyTitle="No inspections" columns={[
        { key: 'd', header: 'Date', render: (r) => date(r.inspectionDate) },
        { key: 'c', header: 'Roof condition', render: (r) => r.roofCondition || '—', hideOnMobile: true },
        { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]} />)}
      {state('measurements', <RelatedTable<Meas> queryKey="cust-meas" path="/measurements" params={q} rowHref={(r) => `/app/measurements/${r.id}`} emptyTitle="No measurements" columns={[
        { key: 'd', header: 'Date', render: (r) => date(r.measurementDate) },
        { key: 'a', header: 'Area', render: (r) => (r.totalArea != null ? `${r.totalArea.toLocaleString('en-US')} ${r.units.replace('_', ' ')}` : '—') },
        { key: 'p', header: 'Pitch', render: (r) => r.pitch || '—', hideOnMobile: true },
      ]} />)}
      {state('estimates', <RelatedTable<Doc> queryKey="cust-est" path="/estimates" params={q} rowHref={(r) => `/app/estimates/${r.id}`} emptyTitle="No estimates" columns={[
        { key: 'n', header: 'Estimate', render: (r) => r.number },
        { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 't', header: 'Total', render: (r) => formatCents(r.totalCents), align: 'right' },
      ]} />)}
      {state('proposals', <RelatedTable<Doc> queryKey="cust-prop" path="/proposals" params={q} rowHref={(r) => `/app/proposals/${r.id}`} emptyTitle="No proposals" columns={[
        { key: 'n', header: 'Proposal', render: (r) => r.number },
        { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 't', header: 'Total', render: (r) => formatCents(r.totalCents), align: 'right' },
      ]} />)}
      {state('projects', <RelatedTable<Proj> queryKey="cust-proj" path="/projects" params={q} rowHref={(r) => `/app/projects/${r.id}`} emptyTitle="No projects" columns={[
        { key: 'n', header: 'Project', render: (r) => r.number },
        { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'p', header: 'Priority', render: (r) => <StatusBadge status={r.priority} />, hideOnMobile: true },
        { key: 'd', header: 'Planned start', render: (r) => date(r.plannedStartAt), hideOnMobile: true },
      ]} />)}
      {state('invoices', <RelatedTable<Inv> queryKey="cust-inv" path="/invoices" params={q} rowHref={(r) => `/app/invoices/${r.id}`} emptyTitle="No invoices" columns={[
        { key: 'n', header: 'Invoice', render: (r) => r.number },
        { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 't', header: 'Total', render: (r) => formatCents(r.totalCents), align: 'right', hideOnMobile: true },
        { key: 'b', header: 'Balance', render: (r) => formatCents(r.balanceCents), align: 'right' },
      ]} />)}
      {state('payments', <RelatedTable<Pay> queryKey="cust-pay" path="/payments" params={q} emptyTitle="No payments" columns={[
        { key: 'd', header: 'Date', render: (r) => date(r.paymentDate) },
        { key: 'i', header: 'Invoice', render: (r) => <Link className="text-brand hover:underline" to={`/app/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link> },
        { key: 'm', header: 'Method', render: (r) => r.method.replace(/_/g, ' '), hideOnMobile: true },
        { key: 'a', header: 'Amount', render: (r) => formatCents(r.amountCents), align: 'right' },
      ]} />)}
      {state('documents', <FilePanel link={{ customerId: id }} canUpload={can.upload} allowCustomerVisibility />)}
      {state('communications', <RelatedTable<Comm> queryKey="cust-comm" path="/communications" params={q} emptyTitle="No communications" emptyHint="Notes, emails and SMS attempts appear here." columns={[
        { key: 'c', header: 'Type', render: (r) => <StatusBadge status={r.channel === 'internal_note' ? 'note' : r.channel} tone="neutral" /> },
        { key: 's', header: 'Subject / message', render: (r) => <span className="line-clamp-2">{r.subject || r.body}</span> },
        { key: 'd', header: 'Delivery', render: (r) => <StatusBadge status={r.deliveryStatus} />, hideOnMobile: true },
        { key: 'w', header: 'When', render: (r) => dateTime(r.createdAt), hideOnMobile: true },
      ]} />)}
      {state('aftersales', <RelatedTable<After> queryKey="cust-after" path="/after-sales" params={q} rowHref={(r) => `/app/projects/${r.projectId}`} emptyTitle="No after-sales records" columns={[
        { key: 'c', header: 'Completed', render: (r) => date(r.completionConfirmedAt) },
        { key: 'r', header: 'Rating', render: (r) => (r.feedbackRating ? `${r.feedbackRating} / 5` : '—') },
        { key: 'f', header: 'Follow-up due', render: (r) => date(r.followUpDueAt), hideOnMobile: true },
      ]} />)}
    </div>
  );
}
