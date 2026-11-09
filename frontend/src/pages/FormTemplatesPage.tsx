import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTemplateMutations, useTemplates, type FormKind } from '@/modules/forms/api';
import { ApiError } from '@/types/api';

const KIND_LABEL: Record<FormKind, string> = { intake: 'Intake', roofing_job: 'Job details', inspection: 'Inspection', other: 'Other' };

export function FormTemplatesPage(): React.ReactElement {
  const q = useTemplates();
  const m = useTemplateMutations();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FormKind>('inspection');
  const [err, setErr] = useState<string | null>(null);

  async function create(): Promise<void> {
    setErr(null);
    const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    try {
      const t = await m.create.mutateAsync({ key, name: name.trim(), kind, definition: { sections: [{ id: 'main', title: 'Details', fields: [{ id: 'notes', label: 'Notes', type: 'long_text' }] }] } });
      nav(`/app/forms/${t.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not create the form.');
    }
  }

  return (
    <div>
      <PageHeader
        title="Form templates"
        description="Intake, job-detail and inspection forms. Publishing creates a new version; completed forms keep the version they were filled with."
        actions={<Button type="button" variant="outline" disabled={m.install.isPending} onClick={() => void m.install.mutateAsync()}>Install default forms</Button>}
      />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState message="Could not load form templates." onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <EmptyState title="No forms yet" description="Install the default forms to start with the client's intake and inspection checklists." /> : null}
      {q.data && q.data.length > 0 ? (
        <ul className="mb-8 divide-y divide-border rounded-lg border border-border bg-card">
          {q.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link to={`/app/forms/${t.id}`} className="min-w-0 flex-1">
                <span className="block font-medium">{t.name}</span>
                <span className="block text-xs text-muted-foreground">{KIND_LABEL[t.kind]} · {t.publishedVersion > 0 ? `Published v${t.publishedVersion}` : 'Not published'}{t.hasUnpublishedChanges ? ' · unpublished changes' : ''}</span>
              </Link>
              <StatusBadge status={t.isActive ? 'active' : 'inactive'} />
            </li>
          ))}
        </ul>
      ) : null}
      <section className="max-w-xl rounded-lg border border-border bg-card p-4" aria-labelledby="new-form">
        <h2 id="new-form" className="mb-3 text-base font-semibold">New form</h2>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Form name" placeholder="Form name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <select aria-label="Form type" className="h-10 rounded-md border border-border bg-card px-3 text-sm" value={kind} onChange={(e) => setKind(e.target.value as FormKind)}>
            {(Object.keys(KIND_LABEL) as FormKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <Button type="button" disabled={name.trim().length < 2 || m.create.isPending} onClick={() => void create()}>Create</Button>
        </div>
        {err ? <p role="alert" className="mt-2 text-sm text-danger">{err}</p> : null}
      </section>
    </div>
  );
}
