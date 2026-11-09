import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FilePanel } from '@/components/shared/FilePanel';
import { FormField, selectClass } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { RelatedTable } from '@/components/shared/RelatedTable';
import { StatCard } from '@/components/shared/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TabPanel, Tabs } from '@/components/shared/Tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCents, dollarsToCents, centsToDollars } from '@/lib/money';
import { useHasPermission } from '@/lib/permissions';
import { statusLabel } from '@/lib/status';
import { useCustomerSummary } from '@/modules/customers/api';
import {
  useChangeProjectStatus,
  useCreateProjectTask,
  useProject,
  useProjectTasks,
  useProjectTimeline,
  useUpdateProject,
  type Project,
} from '@/modules/projects/api';
import {
  useCreateWorkOrder,
  useListQuery,
  useUpdateTaskStatus,
  useUpdateWorkOrder,
  type SubcontractorRow,
  type WorkOrderRow,
} from '@/modules/operations/api';
import { useStaffDirectory } from '@/modules/users/api';
import { apiFetch } from '@/services/http';
import { ApiError } from '@/types/api';
import { PROJECT_NEXT } from '@/lib/project-status';
import { StormHistoryPanel } from '@/modules/storm/StormHistoryPanel';

const date = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString('en-US') : '—');
const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
const toInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

type Row = { id: string };
type Inv = Row & { number: string; status: string; totalCents: number; amountPaidCents: number; balanceCents: number; dueDate?: string | null };
type Pay = Row & { invoiceId: string; invoiceNumber: string; amountCents: number; paymentDate: string; method: string };
type Req = Row & { materialId: string; quantity: number; unit: string; status: string };
type Mat = Row & { name: string; supplier: string };

const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];
const WO_STATUSES = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'];
const REQ_STATUSES = ['needed', 'ordered', 'delivered', 'cancelled'];

function useStaffName(): (id: string | null | undefined) => string {
  const staff = useStaffDirectory();
  return (id) => {
    if (!id) return '—';
    const m = staff.data?.data.find((u) => u.id === id);
    return m ? `${m.firstName} ${m.lastName}` : '…';
  };
}

function Overview({ p }: { p: Project }): React.ReactElement {
  const customer = useCustomerSummary(p.customerId);
  const staffName = useStaffName();
  const update = useUpdateProject(p.id);
  const canUpdate = useHasPermission('projects:update');
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ priority: p.priority, plannedStartAt: '', plannedEndAt: '', budget: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const cs = customer.data?.data;
  const property = cs?.properties.find((x) => x.id === p.propertyId);
  const custName = cs ? (cs.customer.type === 'business' ? cs.customer.companyName : `${cs.customer.firstName} ${cs.customer.lastName}`.trim()) : '…';

  function startEdit(): void {
    setF({ priority: p.priority, plannedStartAt: toInput(p.plannedStartAt), plannedEndAt: toInput(p.plannedEndAt), budget: centsToDollars(p.budgetCents), notes: p.notes });
    setEditing(true);
  }
  function save(e: React.FormEvent): void {
    e.preventDefault();
    setErr(null);
    update.mutate(
      {
        priority: f.priority,
        plannedStartAt: f.plannedStartAt ? new Date(`${f.plannedStartAt}T15:00:00Z`).toISOString() : null,
        plannedEndAt: f.plannedEndAt ? new Date(`${f.plannedEndAt}T15:00:00Z`).toISOString() : null,
        budgetCents: dollarsToCents(f.budget),
        notes: f.notes,
      },
      { onSuccess: () => setEditing(false), onError: (er) => setErr(er instanceof ApiError ? er.message : 'Could not save.') },
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Customer &amp; property</h2>
        <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Customer</dt>
          <dd><Link className="hover:underline" to={`/app/customers/${p.customerId}`}>{custName}</Link></dd>
          <dt className="text-muted-foreground">Property</dt>
          <dd>{property ? <Link className="hover:underline" to={`/app/properties/${property.id}`}>{property.address.line1}, {property.address.city} {property.address.zip}</Link> : '—'}</dd>
          <dt className="text-muted-foreground">Contact</dt>
          <dd>{[cs?.customer.phone, cs?.customer.email].filter(Boolean).join(' · ') || '—'}</dd>
          <dt className="text-muted-foreground">Project manager</dt>
          <dd>{staffName(p.projectManagerId)}</dd>
          <dt className="text-muted-foreground">Assigned staff</dt>
          <dd>{p.assignedEmployeeIds.length ? p.assignedEmployeeIds.map((i) => staffName(i)).join(', ') : '—'}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="flex flex-wrap gap-3">
            {p.leadId ? <Link className="hover:underline" to={`/app/leads/${p.leadId}`}>Lead</Link> : null}
            {p.estimateId ? <Link className="hover:underline" to={`/app/estimates/${p.estimateId}`}>Estimate</Link> : null}
            {p.proposalId ? <Link className="hover:underline" to={`/app/proposals/${p.proposalId}`}>Proposal</Link> : null}
            {!p.leadId && !p.estimateId && !p.proposalId ? '—' : null}
          </dd>
        </dl>
      </section>
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Schedule &amp; budget</h2>
          {canUpdate && !editing ? <Button size="sm" variant="outline" onClick={startEdit}>Edit</Button> : null}
        </div>
        {editing ? (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={save}>
            <FormField label="Priority" htmlFor="pr-prio">
              <select id="pr-prio" className={selectClass} value={f.priority} onChange={(e) => setF((v) => ({ ...v, priority: e.target.value }))}>
                {['low', 'normal', 'high', 'urgent'].map((x) => <option key={x} value={x}>{statusLabel(x)}</option>)}
              </select>
            </FormField>
            <FormField label="Budget (USD)" htmlFor="pr-budget"><Input id="pr-budget" value={f.budget} onChange={(e) => setF((v) => ({ ...v, budget: e.target.value }))} /></FormField>
            <FormField label="Planned start" htmlFor="pr-start"><Input id="pr-start" type="date" value={f.plannedStartAt} onChange={(e) => setF((v) => ({ ...v, plannedStartAt: e.target.value }))} /></FormField>
            <FormField label="Planned end" htmlFor="pr-end"><Input id="pr-end" type="date" value={f.plannedEndAt} onChange={(e) => setF((v) => ({ ...v, plannedEndAt: e.target.value }))} /></FormField>
            <div className="sm:col-span-2"><FormField label="Notes" htmlFor="pr-notes"><Input id="pr-notes" value={f.notes} onChange={(e) => setF((v) => ({ ...v, notes: e.target.value }))} /></FormField></div>
            {err ? <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p> : null}
            <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={update.isPending}>Save</Button><Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div>
          </form>
        ) : (
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Priority</dt><dd><StatusBadge status={p.priority} /></dd>
            <dt className="text-muted-foreground">Planned</dt><dd>{date(p.plannedStartAt)} → {date(p.plannedEndAt)}</dd>
            <dt className="text-muted-foreground">Actual</dt><dd>{date(p.actualStartAt)} → {date(p.actualEndAt)}</dd>
            <dt className="text-muted-foreground">Budget</dt><dd>{formatCents(p.budgetCents)}</dd>
            <dt className="text-muted-foreground">Notes</dt><dd>{p.notes || '—'}</dd>
          </dl>
        )}
      </section>
    </div>
  );
}

function Tasks({ p }: { p: Project }): React.ReactElement {
  const tasks = useProjectTasks(p.id);
  const create = useCreateProjectTask(p.id);
  const updateStatus = useUpdateTaskStatus();
  const staffName = useStaffName();
  const qc = useQueryClient();
  const canUpdate = useHasPermission('projects:update');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rows = tasks.data?.data ?? [];
  return (
    <div className="space-y-4">
      {canUpdate ? (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate({ title }, { onSuccess: () => setTitle(''), onError: (er) => setError(er instanceof ApiError ? er.message : 'Task create failed') }); }}>
          <Input className="max-w-sm" aria-label="New task" placeholder="New task title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Button type="submit" disabled={create.isPending}>Add task</Button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {tasks.isLoading ? <LoadingState /> : null}
      <DataTable
        rows={rows}
        rowKey={(t) => t.id}
        empty={tasks.isLoading ? null : <EmptyState title="No tasks yet" description="Break the job into tasks such as ordering materials or scheduling the crew." />}
        columns={[
          { key: 't', header: 'Task', render: (t) => t.title },
          { key: 'a', header: 'Assigned', render: (t) => staffName((t as { assignedTo?: string | null }).assignedTo), hideOnMobile: true },
          { key: 'd', header: 'Due', render: (t) => date((t as { dueAt?: string | null }).dueAt), hideOnMobile: true },
          {
            key: 's', header: 'Status',
            render: (t) => canUpdate ? (
              <select aria-label={`Status for ${t.title}`} className={`${selectClass} h-8 w-36 text-xs`} value={t.status}
                onChange={(e) => updateStatus.mutate({ projectId: p.id, taskId: t.id, status: e.target.value }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects', p.id] }) })}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            ) : <StatusBadge status={t.status} />,
          },
        ]}
      />
    </div>
  );
}

function WorkOrders({ p }: { p: Project }): React.ReactElement {
  const orders = useListQuery<WorkOrderRow>('work-orders', '/work-orders', { projectId: p.id, pageSize: 50 });
  const subs = useListQuery<SubcontractorRow>('subcontractors', '/subcontractors', { pageSize: 100 });
  const create = useCreateWorkOrder();
  const update = useUpdateWorkOrder();
  const canCreate = useHasPermission('work_orders:create');
  const canUpdate = useHasPermission('work_orders:update');
  const [f, setF] = useState({ title: '', subcontractorId: '' });
  const [error, setError] = useState<string | null>(null);
  const rows = orders.data?.data ?? [];
  const subById = new Map((subs.data?.data ?? []).map((s) => [s.id, s]));
  const used = [...new Set(rows.map((r) => r.subcontractorId).filter((x): x is string => Boolean(x)))].map((id) => subById.get(id)).filter((s): s is SubcontractorRow => Boolean(s));
  return (
    <div className="space-y-4">
      {canCreate ? (
        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
          onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate({ projectId: p.id, title: f.title.trim(), ...(f.subcontractorId ? { subcontractorId: f.subcontractorId } : {}) }, { onSuccess: () => setF({ title: '', subcontractorId: '' }), onError: (er) => setError(er instanceof ApiError ? er.message : 'Could not create.') }); }}>
          <div className="min-w-56 flex-1"><FormField label="New work order" htmlFor="wo-new-title"><Input id="wo-new-title" required value={f.title} onChange={(e) => setF((v) => ({ ...v, title: e.target.value }))} placeholder="e.g. Tear-off and disposal" /></FormField></div>
          <FormField label="Subcontractor" htmlFor="wo-new-sub">
            <select id="wo-new-sub" className={selectClass} value={f.subcontractorId} onChange={(e) => setF((v) => ({ ...v, subcontractorId: e.target.value }))}>
              <option value="">Unassigned</option>
              {(subs.data?.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
            </select>
          </FormField>
          <Button type="submit" disabled={create.isPending}>Create</Button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {orders.isLoading ? <LoadingState /> : null}
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={orders.isLoading ? null : <EmptyState title="No work orders" description="Assign work to a crew or subcontractor." />}
        columns={[
          { key: 'n', header: 'Work order', render: (r) => <span>{r.number}<span className="block text-xs font-normal text-muted-foreground">{r.title}</span></span> },
          { key: 's', header: 'Assigned to', render: (r) => (r.subcontractorId ? (subById.get(r.subcontractorId)?.companyName ?? '…') : 'Unassigned'), hideOnMobile: true },
          { key: 'd', header: 'Planned', render: (r) => date(r.plannedStartAt), hideOnMobile: true },
          {
            key: 'st', header: 'Status',
            render: (r) => canUpdate ? (
              <select aria-label={`Status for ${r.number}`} className={`${selectClass} h-8 w-36 text-xs`} value={r.status} onChange={(e) => update.mutate({ id: r.id, patch: { status: e.target.value } })}>
                {WO_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            ) : <StatusBadge status={r.status} />,
          },
        ]}
      />
      {used.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Subcontractors on this project</h2>
          <ul className="divide-y divide-border text-sm">
            {used.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-medium">{s.companyName}</span>
                <span className="text-muted-foreground">{[s.contactName, s.phone].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Materials({ p }: { p: Project }): React.ReactElement {
  const reqs = useListQuery<Req>('project-materials', '/material-requirements', { projectId: p.id, pageSize: 100 });
  const mats = useListQuery<Mat>('materials', '/materials', { pageSize: 100 });
  const canUpdate = useHasPermission('materials:update');
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const byId = new Map((mats.data?.data ?? []).map((m) => [m.id, m]));
  async function setStatus(id: string, status: string): Promise<void> {
    try {
      await apiFetch(`/material-requirements/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      void qc.invalidateQueries({ queryKey: ['project-materials'] });
    } catch (er) {
      setError(er instanceof ApiError ? er.message : 'Could not update.');
    }
  }
  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {reqs.isLoading ? <LoadingState /> : null}
      <DataTable
        rows={reqs.data?.data ?? []}
        rowKey={(r) => r.id}
        empty={reqs.isLoading ? null : <EmptyState title="No material requirements" description="Requirements are created from the estimate or the materials catalogue." />}
        columns={[
          { key: 'm', header: 'Material', render: (r) => byId.get(r.materialId)?.name ?? '…' },
          { key: 'q', header: 'Quantity', render: (r) => `${r.quantity} ${r.unit}`, align: 'right' },
          { key: 'sup', header: 'Supplier', render: (r) => byId.get(r.materialId)?.supplier || '—', hideOnMobile: true },
          {
            key: 's', header: 'Order status',
            render: (r) => canUpdate ? (
              <select aria-label={`Status for ${byId.get(r.materialId)?.name ?? 'material'}`} className={`${selectClass} h-8 w-32 text-xs`} value={r.status} onChange={(e) => void setStatus(r.id, e.target.value)}>
                {REQ_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            ) : <StatusBadge status={r.status} />,
          },
        ]}
      />
    </div>
  );
}

function Site({ p }: { p: Project }): React.ReactElement {
  type Insp = Row & { status: string; inspectionDate: string; roofCondition: string };
  type Meas = Row & { measurementDate: string; totalArea: number | null; units: string; pitch: string };
  const q = { customerId: p.customerId, propertyId: p.propertyId };
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Inspections</h2>
        <RelatedTable<Insp> queryKey="proj-insp" path="/inspections" params={q} rowHref={(r) => `/app/inspections/${r.id}`} emptyTitle="No inspections for this property" columns={[
          { key: 'd', header: 'Date', render: (r) => date(r.inspectionDate) },
          { key: 'c', header: 'Roof condition', render: (r) => r.roofCondition || '—', hideOnMobile: true },
          { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Measurements</h2>
        <RelatedTable<Meas> queryKey="proj-meas" path="/measurements" params={q} rowHref={(r) => `/app/measurements/${r.id}`} emptyTitle="No measurements for this property" columns={[
          { key: 'd', header: 'Date', render: (r) => date(r.measurementDate) },
          { key: 'a', header: 'Area', render: (r) => (r.totalArea != null ? `${r.totalArea.toLocaleString('en-US')} ${r.units.replace('_', ' ')}` : '—') },
          { key: 'p', header: 'Pitch', render: (r) => r.pitch || '—', hideOnMobile: true },
        ]} />
      </section>
    </div>
  );
}

function Pricing({ p }: { p: Project }): React.ReactElement {
  type Doc = Row & { number: string; status: string; totalCents: number };
  const est = useListQuery<Doc>('proj-est', '/estimates', { customerId: p.customerId, pageSize: 50 });
  const prop = useListQuery<Doc>('proj-prop', '/proposals', { customerId: p.customerId, pageSize: 50 });
  const estimates = (est.data?.data ?? []).filter((e) => e.id === p.estimateId);
  const proposals = (prop.data?.data ?? []).filter((e) => e.id === p.proposalId);
  const table = (rows: Doc[], base: string, empty: string): React.ReactElement => (
    <DataTable rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/app/${base}/${r.id}`} empty={<EmptyState title={empty} />} columns={[
      { key: 'n', header: 'Number', render: (r) => r.number },
      { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      { key: 't', header: 'Total', render: (r) => formatCents(r.totalCents), align: 'right' },
    ]} />
  );
  return (
    <div className="space-y-6">
      <section><h2 className="mb-2 text-sm font-semibold">Estimate</h2>{table(estimates, 'estimates', 'No estimate linked to this project')}</section>
      <section><h2 className="mb-2 text-sm font-semibold">Proposal</h2>{table(proposals, 'proposals', 'No proposal linked to this project')}</section>
    </div>
  );
}

function Finance({ p }: { p: Project }): React.ReactElement {
  const inv = useListQuery<Inv>('proj-inv', '/invoices', { projectId: p.id, pageSize: 100 });
  const rows = inv.data?.data ?? [];
  const live = rows.filter((i) => i.status !== 'void' && i.status !== 'draft');
  const invoiced = live.reduce((s, i) => s + i.totalCents, 0);
  const paid = live.reduce((s, i) => s + i.amountPaidCents, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Budget" value={formatCents(p.budgetCents)} />
        <StatCard label="Invoiced" value={formatCents(invoiced)} />
        <StatCard label="Collected" value={formatCents(paid)} />
        <StatCard label="Outstanding" value={formatCents(invoiced - paid)} tone={invoiced - paid > 0 ? 'warning' : 'default'} />
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Invoices</h2>
        {inv.isLoading ? <LoadingState /> : (
          <DataTable rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/app/invoices/${r.id}`} empty={<EmptyState title="No invoices yet" />} columns={[
            { key: 'n', header: 'Invoice', render: (r) => r.number },
            { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 't', header: 'Total', render: (r) => formatCents(r.totalCents), align: 'right', hideOnMobile: true },
            { key: 'b', header: 'Balance', render: (r) => formatCents(r.balanceCents), align: 'right' },
          ]} />
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Payments</h2>
        <RelatedTable<Pay> queryKey="proj-pay" path="/payments" params={{ projectId: p.id }} emptyTitle="No payments recorded" columns={[
          { key: 'd', header: 'Date', render: (r) => date(r.paymentDate) },
          { key: 'i', header: 'Invoice', render: (r) => <Link className="text-brand hover:underline" to={`/app/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link> },
          { key: 'm', header: 'Method', render: (r) => r.method.replace(/_/g, ' '), hideOnMobile: true },
          { key: 'a', header: 'Amount', render: (r) => formatCents(r.amountCents), align: 'right' },
        ]} />
      </section>
    </div>
  );
}

function Activity({ id }: { id: string }): React.ReactElement {
  const t = useProjectTimeline(id);
  if (t.isLoading) return <LoadingState />;
  if (t.isError) return <ErrorState message="Could not load activity." onRetry={() => void t.refetch()} />;
  const rows = t.data?.data ?? [];
  if (rows.length === 0) return <EmptyState title="No activity yet" />;
  return (
    <ol className="space-y-3 border-l-2 border-border pl-4">
      {rows.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden />
          <p className="text-sm font-medium">{e.title}</p>
          <p className="text-xs text-muted-foreground">{[e.detail, dateTime(e.at)].filter(Boolean).join(' · ')}</p>
        </li>
      ))}
    </ol>
  );
}

export function ProjectDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const project = useProject(id);
  const changeStatus = useChangeProjectStatus(id);
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState<string | null>(null);
  const canUpdate = useHasPermission('projects:update');
  const canInvoice = useHasPermission('invoices:create');
  const canUpload = useHasPermission('files:create');
  const canFiles = useHasPermission('files:read');
  const canStorm = useHasPermission('stormEvents:read');
  const canInvRead = useHasPermission('invoices:read');
  const canWo = useHasPermission('work_orders:read');
  const canMat = useHasPermission('materials:read');

  if (project.isLoading) return <LoadingState />;
  if (project.isError || !project.data) {
    return <ErrorState message={project.error instanceof ApiError ? project.error.message : 'Project not found.'} onRetry={() => void project.refetch()} />;
  }
  const p = project.data.data;
  const next = PROJECT_NEXT[p.status] ?? [];

  const tabs = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'tasks', label: 'Tasks', show: true },
    { key: 'workorders', label: 'Work orders', show: canWo },
    { key: 'materials', label: 'Materials', show: canMat },
    { key: 'site', label: 'Inspections & measurements', show: true },
    { key: 'pricing', label: 'Estimate & proposal', show: true },
    { key: 'documents', label: 'Documents', show: canFiles },
    { key: 'finance', label: 'Finance', show: canInvRead },
    { key: 'activity', label: 'Activity', show: true },
    { key: 'storm', label: 'Storm history', show: canStorm },
  ].filter((t) => t.show);
  const panel = (key: string, node: React.ReactNode): React.ReactElement | null => (tab === key ? <TabPanel id={key}>{node}</TabPanel> : null);

  return (
    <div>
      <PageHeader
        title={p.number}
        description={`Created ${date(p.createdAt)}`}
        actions={
          <>
            <StatusBadge status={p.status} />
            {canInvoice ? <Button asChild><Link to={`/app/invoices/new?projectId=${p.id}&customerId=${p.customerId}&propertyId=${p.propertyId}`}>Create invoice</Link></Button> : null}
            <Button asChild variant="outline"><Link to="/app/projects">All projects</Link></Button>
          </>
        }
      />
      {canUpdate && next.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
          <span className="text-sm text-muted-foreground">Move to:</span>
          {next.map((status) => (
            <Button key={status} type="button" size="sm" variant={status === 'cancelled' ? 'ghost' : 'outline'} disabled={changeStatus.isPending}
              onClick={() => {
                if (status === 'cancelled' && !window.confirm('Cancel this project?')) return;
                setError(null);
                changeStatus.mutate(status, { onError: (er) => setError(er instanceof ApiError ? er.message : 'Status change failed') });
              }}>
              {statusLabel(status)}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="mb-3 text-sm text-danger">{error}</p> : null}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {panel('overview', <Overview p={p} />)}
      {panel('tasks', <Tasks p={p} />)}
      {panel('workorders', <WorkOrders p={p} />)}
      {panel('materials', <Materials p={p} />)}
      {panel('site', <Site p={p} />)}
      {panel('pricing', <Pricing p={p} />)}
      {panel('documents', <FilePanel link={{ projectId: p.id }} canUpload={canUpload} allowCustomerVisibility />)}
      {panel('finance', <Finance p={p} />)}
      {panel('activity', <Activity id={p.id} />)}
      {panel('storm', <StormHistoryPanel target={{ projectId: p.id }} />)}
    </div>
  );
}
