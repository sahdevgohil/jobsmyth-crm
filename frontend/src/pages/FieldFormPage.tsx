import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FormRenderer, type PhotoInput } from '@/components/forms/FormRenderer';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorState, LoadingState } from '@/components/shared/StatePanel';
import { Button } from '@/components/ui/button';
import { allFields, validateAnswers, type Answers, type Issue } from '@/lib/form-engine';
import { openReport, syncApi } from '@/modules/forms/api';
import { deletePhoto, getCachedTemplate, getDraft, listPhotos, saveDraft, savePhoto, type CachedTemplate, type Draft, type LocalPhoto } from '@/modules/offline/store';
import { resolveConflict, syncDraft } from '@/modules/offline/sync';
import { notifyDraftsChanged } from '@/modules/offline/useFieldSync';

/** For the on-device pre-check, signature/file placeholders count as present. */
function forCheck(answers: Answers): Answers {
  const out: Answers = { ...answers };
  for (const [k, v] of Object.entries(out)) {
    const o = v as { localFileId?: string; localFileIds?: string[]; signedAt?: string; signerName?: string } | null;
    if (o?.localFileId) out[k] = { fileId: o.localFileId, signedAt: o.signedAt, signerName: o.signerName };
    else if (o?.localFileIds) out[k] = { fileIds: o.localFileIds };
  }
  return out;
}

export function FieldFormPage(): React.ReactElement {
  const { clientId = '' } = useParams();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [template, setTemplate] = useState<CachedTemplate | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'saving' | 'saved'>('saved');
  const timer = useRef<number | undefined>(undefined);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const load = useCallback(async () => {
    try {
      const d = await getDraft(clientId);
      if (!d) return setError('This form is not on this device.');
      setDraft(d);
      setTemplate((await getCachedTemplate(d.templateKey)) ?? null);
      setPhotos(await listPhotos(clientId));
    } catch {
      setError('Could not open local storage. Private browsing may block offline forms.');
    }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback((next: Draft, immediate = false) => {
    setDraft(next);
    setSaved('saving');
    window.clearTimeout(timer.current);
    const write = async (): Promise<void> => {
      await saveDraft(next);
      setSaved('saved');
      notifyDraftsChanged();
    };
    if (immediate) void write();
    else timer.current = window.setTimeout(() => void write(), 400);
  }, []);

  // Flush a pending save when leaving the page.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (draftRef.current) void saveDraft(draftRef.current);
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!draft) return <LoadingState />;
  if (!template) return <ErrorState message="The form template is not saved on this device. Connect once and open Field mode to download it." />;
  const def = template.definition;
  const edited = (a: Answers): Draft => ({ ...draft, answers: a, status: draft.status === 'synced' && !draft.completed ? 'queued' : draft.status === 'local' ? 'local' : draft.status === 'conflict' ? 'conflict' : 'queued', completed: draft.completed });
  const readOnly = draft.completed;

  async function addPhoto(p: PhotoInput): Promise<void> {
    if (!draft) return;
    const lp: LocalPhoto = {
      id: p.id ?? crypto.randomUUID(), submissionClientId: clientId, fieldId: p.fieldId, blob: p.blob, filename: p.filename, mimeType: p.mimeType,
      tag: allFields(def).find((f) => f.id === p.fieldId)?.label ?? '', capturedAt: new Date().toISOString(), gps: p.gps, status: 'pending', attempts: 0, isSignature: p.isSignature,
    };
    if (p.isSignature) for (const old of photos.filter((x) => x.fieldId === p.fieldId && x.isSignature)) await deletePhoto(old.id);
    await savePhoto(lp);
    const all = await listPhotos(clientId);
    setPhotos(all);
    const field = allFields(def).find((f) => f.id === p.fieldId);
    let answers = draft.answers;
    if (field?.type === 'file') answers = { ...answers, [field.id]: { localFileIds: all.filter((x) => x.fieldId === field.id).map((x) => x.id) } };
    persist({ ...edited(answers) }, true);
  }

  async function removePhoto(id: string): Promise<void> {
    if (!draft) return;
    const gone = photos.find((x) => x.id === id);
    await deletePhoto(id);
    const all = await listPhotos(clientId);
    setPhotos(all);
    let answers = draft.answers;
    const field = allFields(def).find((f) => f.id === gone?.fieldId);
    if (field?.type === 'file') {
      const ids = all.filter((x) => x.fieldId === field.id).map((x) => x.id);
      answers = { ...answers };
      if (ids.length) answers[field.id] = { localFileIds: ids };
      else delete answers[field.id];
    }
    persist(edited(answers), true);
  }

  async function run(complete: boolean): Promise<void> {
    if (!draft) return;
    setBusy(true);
    setIssues([]);
    try {
      const counts: Record<string, number> = {};
      for (const p of photos) if (!p.isSignature) counts[p.fieldId] = (counts[p.fieldId] ?? 0) + 1;
      if (complete) {
        const found = validateAnswers(def, forCheck(draft.answers), { mode: 'complete', photoCounts: counts });
        if (found.length) {
          setIssues(found);
          return;
        }
      }
      const next: Draft = { ...draft, completeRequested: draft.completeRequested || complete, status: 'queued' };
      await saveDraft(next);
      setDraft(next);
      if (navigator.onLine) {
        const after = await syncDraft(clientId, syncApi);
        setDraft(after);
        if (after.issues) setIssues(after.issues);
        setPhotos(await listPhotos(clientId));
      }
      notifyDraftsChanged();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(keep: 'mine' | 'server'): Promise<void> {
    setDraft(await resolveConflict(clientId, keep));
    notifyDraftsChanged();
    if (keep === 'mine' && navigator.onLine) await run(false);
  }

  const statusText =
    draft.status === 'synced' ? (draft.completed ? 'Completed and synced' : 'Synced') :
    draft.status === 'failed' ? 'Not synced — will retry' :
    draft.status === 'syncing' ? 'Syncing…' :
    draft.status === 'conflict' ? 'Conflict — choose a version' :
    draft.status === 'queued' ? 'Waiting to sync' : 'Saved on this device';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={draft.templateName}
        description={draft.label}
        actions={<Button asChild variant="outline"><Link to="/app/field">All field forms</Link></Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm" role="status">
        <span className="rounded-full bg-muted px-3 py-1">{statusText}</span>
        <span className="text-muted-foreground">{saved === 'saving' ? 'Saving…' : 'All changes saved on this device'}</span>
        {!navigator.onLine ? <span className="text-danger">Offline</span> : null}
      </div>
      {draft.error ? <p role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{draft.error}</p> : null}

      {draft.status === 'conflict' && draft.conflict ? (
        <div role="alert" className="mb-4 space-y-3 rounded-md border border-warning bg-warning/15 p-4 text-sm">
          <p className="font-medium">Someone updated this form on the server (revision {draft.conflict.revision}) while you were editing it.</p>
          <p>Your version is still on this device. Pick which one to keep.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void resolve('mine')}>Keep my version</Button>
            <Button type="button" variant="outline" onClick={() => void resolve('server')}>Use the server version</Button>
          </div>
        </div>
      ) : null}

      <FormRenderer
        definition={def}
        answers={draft.answers}
        onChange={(a) => persist(edited(a))}
        photos={photos}
        onAddPhoto={addPhoto}
        onRemovePhoto={removePhoto}
        issues={issues}
        readOnly={readOnly}
      />

      {issues.length > 0 ? (
        <div role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <p className="font-medium">Finish these before completing:</p>
          <ul className="list-disc pl-5">{issues.map((i) => <li key={i.fieldId + i.message}>{allFields(def).find((f) => f.id === i.fieldId)?.label ?? i.fieldId}: {i.message}</li>)}</ul>
        </div>
      ) : null}

      <div className="sticky bottom-0 mt-6 flex flex-wrap gap-2 border-t border-border bg-background py-3">
        {!readOnly ? (
          <>
            <Button type="button" variant="outline" className="h-12" disabled={busy || draft.status === 'conflict'} onClick={() => void run(false)}>Save {navigator.onLine ? '& sync' : 'on device'}</Button>
            <Button type="button" className="h-12" disabled={busy || draft.status === 'conflict'} onClick={() => void run(true)}>Complete form</Button>
          </>
        ) : null}
        {draft.completed && draft.serverId ? (
          <Button type="button" className="h-12" onClick={() => void openReport(draft.serverId as string).catch((e: Error) => setError(e.message))}>Open PDF report</Button>
        ) : null}
      </div>
    </div>
  );
}
