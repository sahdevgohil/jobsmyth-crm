import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDraft, getPhoto, listDrafts, listPhotos, newClientId, saveDraft, savePhoto, deleteDraft, type Draft, type LocalPhoto } from './store';
import { resolveConflict, syncAll, syncDraft, type SyncApi, type SyncResponse } from './sync';

/** In-memory stand-in for the server: idempotent on clientId, revision-checked, with switchable failures. */
class FakeServer {
  submissions = new Map<string, { id: string; revision: number; answers: Record<string, unknown>; completed: boolean }>();
  files = new Map<string, { id: string; field: string }>();
  online = true;
  failUploadAfterStoringOnce = false;
  syncCalls = 0;
  requireComplete = false;

  api: SyncApi = {
    sync: async (b): Promise<SyncResponse> => {
      if (!this.online) throw new TypeError('fetch failed');
      this.syncCalls += 1;
      const cur = this.submissions.get(b.clientId);
      if (!cur) {
        const s = { id: `srv-${b.clientId}`, revision: 1, answers: b.answers, completed: false };
        this.submissions.set(b.clientId, s);
        if (b.complete) return this.complete(b, s);
        return { status: 'created', submission: s };
      }
      if (b.baseRevision !== cur.revision && JSON.stringify(b.answers) !== JSON.stringify(cur.answers)) return { status: 'conflict', submission: cur };
      if (b.complete) return this.complete(b, cur);
      if (JSON.stringify(b.answers) === JSON.stringify(cur.answers)) return { status: 'unchanged', submission: cur };
      cur.answers = b.answers;
      cur.revision += 1;
      return { status: 'updated', submission: cur };
    },
    uploadFile: async (b) => {
      if (!this.online) throw new TypeError('fetch failed');
      let f = this.files.get(b.clientId);
      if (!f) {
        f = { id: `file-${b.clientId}`, field: b.formFieldId };
        this.files.set(b.clientId, f);
      }
      if (this.failUploadAfterStoringOnce) {
        this.failUploadAfterStoringOnce = false;
        throw new TypeError('network connection lost');
      }
      return { id: f.id };
    },
  };

  private complete(b: Parameters<SyncApi['sync']>[0], s: { id: string; revision: number; answers: Record<string, unknown>; completed: boolean }): SyncResponse {
    if (this.requireComplete && !b.answers.roof_material) return { status: 'invalid', issues: [{ fieldId: 'roof_material', message: 'This field is required.' }] };
    s.answers = b.answers;
    s.revision += 1;
    s.completed = true;
    return { status: 'completed', submission: s };
  }
}

// Node's Blob: jsdom's Blob is not structured-cloneable by fake-indexeddb (real browsers store Blobs natively).
const blob = (n = 8): Blob => new NodeBlob([new Uint8Array(n).fill(7)], { type: 'image/jpeg' }) as unknown as Blob;
const draft = (over: Partial<Draft> = {}): Draft => ({
  clientId: newClientId(), templateKey: 'roofing_inspection', templateVersion: 1, templateName: 'Roofing inspection', kind: 'inspection',
  answers: { roof_material: 'asphalt_shingle' }, links: {}, label: 'Test', baseRevision: 0, status: 'local', completeRequested: false, completed: false,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});
const photo = (clientId: string, over: Partial<LocalPhoto> = {}): LocalPhoto => ({
  id: newClientId(), submissionClientId: clientId, fieldId: 'photo_elevations', blob: blob(), filename: 'front.jpg', mimeType: 'image/jpeg',
  tag: 'Front', capturedAt: new Date().toISOString(), status: 'pending', attempts: 0, ...over,
});

describe('offline field workflow', () => {
  let server: FakeServer;
  beforeEach(async () => {
    server = new FakeServer();
    for (const d of await listDrafts()) await deleteDraft(d.clientId);
  });

  it('keeps drafts and queued photos after the browser is closed and reopened', async () => {
    server.online = false;
    const d = draft();
    await saveDraft(d);
    const p = photo(d.clientId);
    await savePhoto(p);
    await closeDb(); // simulates quitting the browser: the connection is gone, the data stays
    const again = await getDraft(d.clientId);
    expect(again?.answers).toEqual({ roof_material: 'asphalt_shingle' });
    expect(again?.status).toBe('local');
    const stored = await getPhoto(p.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.blob.size).toBe(8);
    expect((await listPhotos(d.clientId)).length).toBe(1);
  });

  it('never loses data when offline, then syncs the draft and photos once the connection returns', async () => {
    const d = draft();
    await saveDraft(d);
    await savePhoto(photo(d.clientId));
    server.online = false;
    const failed = await syncDraft(d.clientId, server.api);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/No connection/);
    expect((await getDraft(d.clientId))?.answers).toEqual(d.answers);
    expect((await listPhotos(d.clientId))[0]?.blob.size).toBe(8);

    server.online = true;
    const ok = await syncDraft(d.clientId, server.api);
    expect(ok.status).toBe('synced');
    expect(ok.serverId).toBe(`srv-${d.clientId}`);
    expect(server.submissions.size).toBe(1);
    expect(server.files.size).toBe(1);
    expect((await listPhotos(d.clientId))[0]?.status).toBe('uploaded');
  });

  it('retrying after a lost response creates no duplicates (submission and photo are idempotent)', async () => {
    const d = draft();
    await saveDraft(d);
    await savePhoto(photo(d.clientId));
    server.failUploadAfterStoringOnce = true; // server stored the photo, but the response never arrived
    const first = await syncDraft(d.clientId, server.api);
    expect(first.status).toBe('failed');
    expect((await listPhotos(d.clientId))[0]?.status).toBe('failed');
    const second = await syncDraft(d.clientId, server.api);
    expect(second.status).toBe('synced');
    expect(server.files.size).toBe(1);
    expect(server.submissions.size).toBe(1);
  });

  it('syncAll skips drafts that are already synced (no duplicate submissions)', async () => {
    const d = draft();
    await saveDraft(d);
    expect(await syncAll(server.api)).toEqual({ synced: 1, failed: 0, conflicts: 0 });
    const calls = server.syncCalls;
    expect(await syncAll(server.api)).toEqual({ synced: 0, failed: 0, conflicts: 0 });
    expect(server.syncCalls).toBe(calls);
    expect(server.submissions.size).toBe(1);
  });

  it('detects a conflict instead of overwriting newer server data, and lets the user choose', async () => {
    const d = draft({ baseRevision: 1, status: 'queued', answers: { roof_material: 'metal' } });
    await saveDraft(d);
    server.submissions.set(d.clientId, { id: `srv-${d.clientId}`, revision: 3, answers: { roof_material: 'tile' }, completed: false });
    const c = await syncDraft(d.clientId, server.api);
    expect(c.status).toBe('conflict');
    expect(c.conflict?.answers).toEqual({ roof_material: 'tile' });
    expect(server.submissions.get(d.clientId)?.answers).toEqual({ roof_material: 'tile' }); // untouched
    expect(await syncAll(server.api)).toEqual({ synced: 0, failed: 0, conflicts: 1 });

    const mine = await resolveConflict(d.clientId, 'mine');
    expect(mine.status).toBe('queued');
    expect(mine.baseRevision).toBe(3);
    const done = await syncDraft(d.clientId, server.api);
    expect(done.status).toBe('synced');
    expect(server.submissions.get(d.clientId)?.answers).toEqual({ roof_material: 'metal' });
  });

  it('uploads the signature first, then completes with the server file id; incomplete forms stay on the device', async () => {
    server.requireComplete = true;
    const d = draft({ completeRequested: true, answers: { roof_material: 'asphalt_shingle', customer_signature: { localFileId: 'sig-1', signedAt: '2026-11-06T10:00:00.000Z', signerName: 'Pat Owner' } } });
    await saveDraft(d);
    await savePhoto(photo(d.clientId, { id: 'sig-1', fieldId: 'customer_signature', isSignature: true, mimeType: 'image/png', filename: 'sig.png' }));
    const done = await syncDraft(d.clientId, server.api);
    expect(done.status).toBe('synced');
    expect(done.completed).toBe(true);
    expect(server.submissions.get(d.clientId)?.completed).toBe(true);
    expect(server.submissions.get(d.clientId)?.answers.customer_signature).toEqual({ fileId: 'file-sig-1', signedAt: '2026-11-06T10:00:00.000Z', signerName: 'Pat Owner' });

    const bad = draft({ completeRequested: true, answers: {} });
    await saveDraft(bad);
    const failed = await syncDraft(bad.clientId, server.api);
    expect(failed.status).toBe('failed');
    expect(failed.issues?.[0]?.fieldId).toBe('roof_material');
    expect((await getDraft(bad.clientId))?.answers).toEqual({}); // still there for the user to fix
  });
});
