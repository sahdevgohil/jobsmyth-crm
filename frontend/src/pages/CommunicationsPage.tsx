import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/shared/DataTable';
import { FormField, selectClass } from '@/components/shared/FormField';
import { SearchInput } from '@/components/shared/FilterBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHasPermission } from '@/lib/permissions';
import type { Customer } from '@/modules/customers/types';
import {
  useCommunications,
  useCreateEmail,
  useCreateInternalNote,
  useCreateSms,
  type Communication,
} from '@/modules/communications/api';
import { useListQuery } from '@/modules/operations/api';
import { apiFetch } from '@/services/http';
import { ApiError } from '@/types/api';

const name = (c: Customer): string => (c.type === 'business' ? c.companyName : `${c.firstName} ${c.lastName}`.trim());
const CHANNELS = [
  { value: 'internal_note', label: 'Internal note' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
];

function Composer({ customer, projectId }: { customer: Customer; projectId: string }): React.ReactElement {
  const [kind, setKind] = useState('internal_note');
  const [f, setF] = useState({ to: customer.email, subject: '', body: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const note = useCreateInternalNote();
  const email = useCreateEmail();
  const sms = useCreateSms();
  const pending = note.isPending || email.isPending || sms.isPending;
  const base = { customerId: customer.id, projectId: projectId || undefined };

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setMsg(null);
    setError(null);
    const done = (m: string) => ({ onSuccess: () => { setF((v) => ({ ...v, body: '', subject: '' })); setMsg(m); }, onError: (er: Error) => setError(er instanceof ApiError ? er.message : 'Could not save.') });
    if (kind === 'internal_note') note.mutate({ ...base, subject: f.subject || undefined, body: f.body }, done('Internal note saved.'));
    if (kind === 'email') email.mutate({ ...base, recipient: f.to, subject: f.subject, body: f.body }, done('Recorded. Email is not configured, so nothing was sent.'));
    if (kind === 'sms') sms.mutate({ ...base, recipient: f.to || customer.phone, body: f.body }, done('Recorded. SMS is not configured, so nothing was sent.'));
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-2">
      <FormField label="Type" htmlFor="cm-kind">
        <select id="cm-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)}>
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </FormField>
      {kind !== 'internal_note' ? (
        <FormField label={kind === 'email' ? 'To' : 'Phone'} htmlFor="cm-to"><Input id="cm-to" value={f.to} onChange={(e) => setF((v) => ({ ...v, to: e.target.value }))} required /></FormField>
      ) : <div />}
      {kind !== 'sms' ? (
        <div className="sm:col-span-2"><FormField label="Subject" htmlFor="cm-subject"><Input id="cm-subject" value={f.subject} onChange={(e) => setF((v) => ({ ...v, subject: e.target.value }))} required={kind === 'email'} /></FormField></div>
      ) : null}
      <div className="sm:col-span-2">
        <FormField label="Message" htmlFor="cm-body">
          <textarea id="cm-body" required className="min-h-24 w-full rounded-md border border-border bg-card p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" value={f.body} onChange={(e) => setF((v) => ({ ...v, body: e.target.value }))} />
        </FormField>
      </div>
      {kind !== 'internal_note' ? (
        <p className="text-xs text-muted-foreground sm:col-span-2">Email and SMS providers are not configured. The message is recorded as “not configured” and is never sent.</p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p> : null}
      {msg ? <p role="status" className="text-sm text-success sm:col-span-2">{msg}</p> : null}
      <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{kind === 'internal_note' ? 'Save note' : 'Record message'}</Button></div>
    </form>
  );
}

function Timeline({ customer }: { customer: Customer }): React.ReactElement {
  const [channel, setChannel] = useState('');
  const [projectId, setProjectId] = useState('');
  const canCreate = useHasPermission('communications:create');
  const projects = useListQuery<{ id: string; number: string }>('projects', '/projects', { customerId: customer.id, pageSize: 50 });
  const q = useCommunications({ customerId: customer.id, projectId: projectId || undefined, channel: channel || undefined });
  const rows: Communication[] = q.data?.data ?? [];
  return (
    <div>
      {canCreate ? <Composer customer={customer} projectId={projectId} /> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Channel" className={`${selectClass} w-48`} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Channel: all</option>
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select aria-label="Project" className={`${selectClass} w-48`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Project: all</option>
          {(projects.data?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}
        </select>
      </div>
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Could not load communications." onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No communications yet" description="Notes, emails and SMS attempts for this customer appear here." />}
          columns={[
            { key: 'c', header: 'Type', render: (r) => <StatusBadge status={r.channel === 'internal_note' ? 'note' : r.channel} tone="neutral" /> },
            { key: 'm', header: 'Subject / message', render: (r) => <span><span className="font-medium">{r.subject}</span><span className="line-clamp-2 block text-xs font-normal text-muted-foreground">{r.body}</span></span> },
            { key: 'd', header: 'Delivery', render: (r) => <StatusBadge status={r.deliveryStatus} />, hideOnMobile: true },
            { key: 'w', header: 'When', render: (r) => new Date(r.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }), hideOnMobile: true },
          ]}
        />
      ) : null}
    </div>
  );
}

export function CommunicationsPage(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const customerId = params.get('customerId') ?? '';
  const [search, setSearch] = useState('');
  const results = useQuery({
    queryKey: ['comm-customers', search],
    enabled: search.trim().length >= 2,
    queryFn: () => apiFetch<{ data: Customer[] }>(`/customers?search=${encodeURIComponent(search)}&pageSize=8`),
  });
  const selected = useQuery({
    queryKey: ['comm-customer', customerId],
    enabled: Boolean(customerId),
    queryFn: () => apiFetch<{ data: { customer: Customer } }>(`/customers/${customerId}/summary`),
  });

  return (
    <div>
      <PageHeader title="Communications" description="Customer timeline of notes, email and SMS. Delivery is never reported as sent while providers are not configured." />
      <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-medium">Customer</p>
        {selected.data ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold">{name(selected.data.data.customer)}</span>
            <span className="text-sm text-muted-foreground">{selected.data.data.customer.phone || selected.data.data.customer.email}</span>
            <Button size="sm" variant="outline" onClick={() => setParams({})}>Change</Button>
          </div>
        ) : (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Find a customer by name, phone or email" />
            {results.data && results.data.data.length > 0 ? (
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {results.data.data.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setParams({ customerId: c.id }); setSearch(''); }}>
                      <span className="font-medium">{name(c)}</span>
                      <span className="text-muted-foreground">{c.phone || c.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {results.data && results.data.data.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No customers found.</p> : null}
          </>
        )}
      </div>
      {selected.data ? <Timeline customer={selected.data.data.customer} /> : <EmptyState title="Choose a customer" description="Search for a customer to see their communication history and add notes." />}
    </div>
  );
}
