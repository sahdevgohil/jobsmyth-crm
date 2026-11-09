/**
 * Offline synchronisation. Idempotent end to end:
 *  - the submission is sent with its stable clientId (server create-or-update, conflict-checked);
 *  - every photo is uploaded with its own clientId, so a retry after a lost response stores it once;
 *  - nothing local is deleted until the server has confirmed it.
 */
import { blobToBase64 } from './base64';
import { getDraft, listDrafts, listPhotos, needsSync, savePhoto, saveDraft, type Draft, type LocalPhoto } from './store';

export type SyncResponse =
  | { status: 'created' | 'updated' | 'unchanged' | 'completed'; submission: { id: string; revision: number; answers: Record<string, unknown> } }
  | { status: 'conflict'; submission: { id: string; revision: number; answers: Record<string, unknown> } }
  | { status: 'invalid'; issues: Array<{ fieldId: string; message: string }> };

export type SyncApi = {
  sync(body: {
    clientId: string;
    templateKey: string;
    templateVersion: number;
    answers: Record<string, unknown>;
    baseRevision: number;
    links: Draft['links'];
    complete?: boolean;
  }): Promise<SyncResponse>;
  uploadFile(body: {
    filename: string;
    mimeType: string;
    category: 'photo' | 'document';
    contentBase64: string;
    formSubmissionId: string;
    formFieldId: string;
    clientId: string;
    tag?: string;
    capturedAt?: string;
    gps?: { lat: number; lng: number };
  }): Promise<{ id: string }>;
};

const isNetworkError = (e: unknown): boolean => e instanceof TypeError || (e instanceof Error && /network|fetch|offline/i.test(e.message));

async function setDraft(id: string, patch: Partial<Draft>): Promise<Draft> {
  const cur = await getDraft(id);
  if (!cur) throw new Error('Draft missing');
  const next = { ...cur, ...patch };
  await saveDraft(next);
  return next;
}

async function uploadPendingPhotos(draft: Draft, api: SyncApi): Promise<{ ok: boolean; photos: LocalPhoto[] }> {
  let ok = true;
  const photos = await listPhotos(draft.clientId);
  for (const p of photos) {
    if (p.status === 'uploaded') continue;
    await savePhoto({ ...p, status: 'uploading' });
    try {
      const res = await api.uploadFile({
        filename: p.filename,
        mimeType: p.mimeType,
        category: p.mimeType.startsWith('image/') ? 'photo' : 'document',
        contentBase64: await blobToBase64(p.blob),
        formSubmissionId: draft.serverId as string,
        formFieldId: p.fieldId,
        clientId: p.id,
        tag: p.tag,
        capturedAt: p.capturedAt,
        gps: p.gps,
      });
      await savePhoto({ ...p, status: 'uploaded', serverFileId: res.id, error: undefined, attempts: p.attempts + 1 });
    } catch (e) {
      ok = false;
      await savePhoto({ ...p, status: 'failed', attempts: p.attempts + 1, error: e instanceof Error ? e.message : 'Upload failed' });
      if (isNetworkError(e)) break; // offline again: stop and retry later
    }
  }
  return { ok, photos: await listPhotos(draft.clientId) };
}

/** Replaces local signature placeholders (`{ localFileId }`) with the server file id before completing. */
export function resolveSignatures(answers: Record<string, unknown>, photos: LocalPhoto[]): Record<string, unknown> {
  const out = { ...answers };
  for (const [k, v] of Object.entries(out)) {
    const localIds = (v as { localFileIds?: string[] } | null)?.localFileIds;
    if (localIds) {
      const ids = localIds.map((id) => photos.find((p) => p.id === id)?.serverFileId).filter((x): x is string => Boolean(x));
      if (ids.length === localIds.length) out[k] = { fileIds: ids };
      continue;
    }
    const local = (v as { localFileId?: string } | null)?.localFileId;
    if (local) {
      const photo = photos.find((p) => p.id === local);
      if (photo?.serverFileId) {
        const { signedAt, signerName } = v as { signedAt: string; signerName?: string };
        out[k] = { fileId: photo.serverFileId, signedAt, signerName };
      }
    }
  }
  return out;
}

/** Syncs one draft. Never throws for expected outcomes; returns the resulting draft. */
export async function syncDraft(clientId: string, api: SyncApi): Promise<Draft> {
  let draft = await getDraft(clientId);
  if (!draft) throw new Error('Draft not found');
  if (draft.status === 'conflict') return draft; // needs a human decision
  draft = await setDraft(clientId, { status: 'syncing', error: undefined, issues: undefined });
  try {
    // Placeholders for signatures that are not uploaded yet stay out of the draft-mode payload.
    const draftAnswers = Object.fromEntries(Object.entries(draft.answers).filter(([, v]) => !((v as { localFileId?: string; localFileIds?: string[] } | null)?.localFileId || (v as { localFileIds?: string[] } | null)?.localFileIds)));
    const first = await api.sync({ clientId, templateKey: draft.templateKey, templateVersion: draft.templateVersion, answers: draftAnswers, baseRevision: draft.baseRevision, links: draft.links });
    if (first.status === 'conflict') {
      return setDraft(clientId, { status: 'conflict', conflict: { revision: first.submission.revision, answers: first.submission.answers }, serverId: first.submission.id });
    }
    if (first.status === 'invalid') {
      return setDraft(clientId, { status: 'failed', error: 'Some answers are invalid.', issues: first.issues });
    }
    draft = await setDraft(clientId, { serverId: first.submission.id, baseRevision: first.submission.revision });

    const uploaded = await uploadPendingPhotos(draft, api);
    if (!uploaded.ok) {
      return setDraft(clientId, { status: 'failed', error: 'Some photos could not be uploaded yet. They are saved and will retry.' });
    }

    if (draft.completeRequested && !draft.completed) {
      const answers = resolveSignatures(draft.answers, uploaded.photos);
      const done = await api.sync({ clientId, templateKey: draft.templateKey, templateVersion: draft.templateVersion, answers, baseRevision: draft.baseRevision, links: draft.links, complete: true });
      if (done.status === 'conflict') return setDraft(clientId, { status: 'conflict', conflict: { revision: done.submission.revision, answers: done.submission.answers } });
      if (done.status === 'invalid') return setDraft(clientId, { status: 'failed', error: 'The form is not complete yet.', issues: done.issues });
      return setDraft(clientId, { status: 'synced', completed: done.status === 'completed' || done.status === 'unchanged', baseRevision: done.submission.revision, answers });
    }
    return setDraft(clientId, { status: 'synced' });
  } catch (e) {
    // Offline or server error: keep everything and retry later.
    return setDraft(clientId, { status: 'failed', error: isNetworkError(e) ? 'No connection. Saved on this device; will sync when online.' : e instanceof Error ? e.message : 'Sync failed' });
  }
}

/** Syncs every draft that has something to send, one at a time. Safe to call repeatedly. */
export async function syncAll(api: SyncApi, onUpdate?: (d: Draft) => void): Promise<{ synced: number; failed: number; conflicts: number }> {
  const result = { synced: 0, failed: 0, conflicts: 0 };
  for (const d of await listDrafts()) {
    if (!needsSync(d) || d.status === 'syncing') continue;
    if (d.status === 'conflict') {
      result.conflicts += 1;
      continue;
    }
    const after = await syncDraft(d.clientId, api);
    onUpdate?.(after);
    if (after.status === 'synced') result.synced += 1;
    else if (after.status === 'conflict') result.conflicts += 1;
    else result.failed += 1;
  }
  return result;
}

/** Resolve a conflict: keep this device's answers (re-based on the server revision) or accept the server copy. */
export async function resolveConflict(clientId: string, keep: 'mine' | 'server'): Promise<Draft> {
  const d = await getDraft(clientId);
  if (!d?.conflict) throw new Error('No conflict to resolve');
  if (keep === 'server') return setDraft(clientId, { answers: d.conflict.answers, baseRevision: d.conflict.revision, status: 'synced', conflict: undefined, completeRequested: false });
  return setDraft(clientId, { baseRevision: d.conflict.revision, status: 'queued', conflict: undefined });
}
