import { CloudOff, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CustomerPropertyPicker } from '@/components/shared/EntityPickers';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { defaultAnswers } from '@/lib/form-engine';
import { apiFetch } from '@/services/http';
import type { FormTemplate, TemplateVersion } from '@/modules/forms/api';
import { cacheTemplate, deleteDraft, getCachedTemplate, listCachedTemplates, newClientId, saveDraft, type CachedTemplate, type Draft } from '@/modules/offline/store';
import { notifyDraftsChanged, useFieldSync } from '@/modules/offline/useFieldSync';

const STATUS_LABEL: Record<Draft['status'], string> = {
  local: 'Saved on this device',
  queued: 'Waiting to sync',
  syncing: 'Syncing',
  synced: 'Synced',
  failed: 'Sync failed',
  conflict: 'Conflict',
};

/** Downloads every published inspection/job template so forms can be started with no connection. */
async function refreshTemplateCache(): Promise<void> {
  const res = await apiFetch<{ data: FormTemplate[] }>('/forms/templates?active=true');
  for (const t of res.data) {
    if (t.publishedVersion < 1 || t.kind === 'intake') continue;
    if ((await getCachedTemplate(t.key))?.version === t.publishedVersion) continue; // already saved on this device
    const v = await apiFetch<{ data: TemplateVersion }>(`/forms/templates/${t.id}/versions/${t.publishedVersion}`);
    await cacheTemplate({ key: t.key, version: t.publishedVersion, name: t.name, kind: t.kind, definition: v.data.definition, cachedAt: new Date().toISOString() });
  }
}

export function FieldHomePage(): React.ReactElement {
  const nav = useNavigate();
  const { drafts, online, syncing, syncNow, unsynced } = useFieldSync(true);
  const [templates, setTemplates] = useState<CachedTemplate[]>([]);
  const [target, setTarget] = useState({ customerId: '', propertyId: '' });
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        setTemplates(await listCachedTemplates());
        if (navigator.onLine) {
          await refreshTemplateCache();
          if (alive) setTemplates(await listCachedTemplates());
        }
      } catch {
        if (alive) setNote('Could not refresh form templates. Showing the ones saved on this device.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [online]);

  async function start(t: CachedTemplate): Promise<void> {
    const d: Draft = {
      clientId: newClientId(), templateKey: t.key, templateVersion: t.version, templateName: t.name, kind: t.kind,
      answers: defaultAnswers(t.definition), links: { ...(target.customerId ? { customerId: target.customerId } : {}), ...(target.propertyId ? { propertyId: target.propertyId } : {}) },
      label: t.name, baseRevision: 0, status: 'local', completeRequested: false, completed: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await saveDraft(d);
    notifyDraftsChanged();
    nav(`/app/field/${d.clientId}`);
  }

  return (
    <div>
      <PageHeader
        title="Field mode"
        description="Inspections and job forms that save on this device first. Nothing is lost if the connection drops."
        actions={
          <Button type="button" variant="outline" disabled={!online || syncing || unsynced === 0} onClick={() => void syncNow()}>
            <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden /> Sync now
          </Button>
        }
      />
      {!online ? (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><CloudOff className="h-4 w-4" aria-hidden /> You are offline. Forms you save here will sync automatically when the connection returns.</p>
      ) : null}
      {unsynced > 0 ? <p role="status" className="mb-4 rounded-md border border-warning bg-warning/15 p-3 text-sm">{unsynced} form{unsynced === 1 ? '' : 's'} not yet on the server. Keep this browser until they show “Synced”.</p> : null}
      {note ? <p className="mb-4 text-sm text-muted-foreground">{note}</p> : null}

      <section aria-labelledby="start-h" className="mb-8 rounded-lg border border-border bg-card p-4">
        <h2 id="start-h" className="mb-3 text-base font-semibold">Start a form</h2>
        {online ? (
          <div className="mb-4"><CustomerPropertyPicker customerId={target.customerId} propertyId={target.propertyId} onChange={setTarget} requireProperty={false} /></div>
        ) : <p className="mb-3 text-sm text-muted-foreground">Offline: the form is saved unlinked. Link it to a customer after it syncs.</p>}
        {templates.length === 0 ? <p className="text-sm text-muted-foreground">No templates saved on this device yet. Open this page once while online to download them.</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <button key={t.key} type="button" onClick={() => void start(t)} className="min-h-14 rounded-md border border-border bg-card px-4 py-3 text-left text-sm font-medium hover:bg-muted">
                {t.name}<span className="block text-xs font-normal text-muted-foreground">Version {t.version}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="drafts-h">
        <h2 id="drafts-h" className="mb-3 text-base font-semibold">On this device</h2>
        {drafts.length === 0 ? <p className="text-sm text-muted-foreground">No forms saved on this device.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {drafts.map((d) => (
              <li key={d.clientId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link to={`/app/field/${d.clientId}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.label}</span>
                  <span className="block text-xs text-muted-foreground">Updated {new Date(d.updatedAt).toLocaleString('en-US')}{d.completed ? ' · Completed' : d.completeRequested ? ' · Completion pending' : ''}</span>
                  {d.error ? <span className="block text-xs text-danger">{d.error}</span> : null}
                </Link>
                <StatusBadge status={d.status} tone={d.status === 'synced' ? 'success' : d.status === 'failed' || d.status === 'conflict' ? 'danger' : 'warning'} className="whitespace-nowrap" />
                <span className="sr-only">{STATUS_LABEL[d.status]}</span>
                {d.status === 'synced' && (d.completed || !d.completeRequested) ? (
                  <button type="button" aria-label={`Remove ${d.label} from this device`} className="rounded p-2 text-muted-foreground hover:bg-muted" onClick={() => void deleteDraft(d.clientId).then(notifyDraftsChanged)}><Trash2 className="h-4 w-4" /></button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
