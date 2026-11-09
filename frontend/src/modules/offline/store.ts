/**
 * Local-first storage for field forms (IndexedDB, no dependencies).
 * Everything a representative enters is written here first, so a form never disappears when the
 * connection drops or the browser is closed. Photos and signatures are stored as Blobs until uploaded.
 */
import type { Answers, FormDefinition } from '@/lib/form-engine';

export type DraftStatus = 'local' | 'queued' | 'syncing' | 'synced' | 'failed' | 'conflict';

export type Draft = {
  /** Client-generated UUID: the idempotency key for the server. */
  clientId: string;
  templateKey: string;
  templateVersion: number;
  templateName: string;
  kind: string;
  answers: Answers;
  links: { customerId?: string; propertyId?: string; leadId?: string; appointmentId?: string; inspectionId?: string; projectId?: string };
  label: string;
  /** Server revision this draft is based on (0 = never synced). */
  baseRevision: number;
  serverId?: string;
  status: DraftStatus;
  /** The user pressed "Complete": the server will validate required fields and photos. */
  completeRequested: boolean;
  completed: boolean;
  error?: string;
  issues?: Array<{ fieldId: string; message: string }>;
  conflict?: { revision: number; answers: Answers };
  createdAt: string;
  updatedAt: string;
};

export type LocalPhoto = {
  /** Also the server-side clientId, so retried uploads are stored once. */
  id: string;
  submissionClientId: string;
  fieldId: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  tag: string;
  capturedAt: string;
  gps?: { lat: number; lng: number };
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  attempts: number;
  error?: string;
  serverFileId?: string;
  /** Marks a signature image (its server file id replaces the placeholder in the answer when completing). */
  isSignature?: boolean;
};

export type CachedTemplate = { key: string; version: number; name: string; kind: string; definition: FormDefinition; cachedAt: string };
export type CachedContact = { id: string; label: string; phone?: string; properties: Array<{ id: string; label: string }>; cachedAt: string };

const DB_NAME = 'legacy-field';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'clientId' });
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('bySubmission', 'submissionClientId');
        }
        if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('contacts')) db.createObjectStore('contacts', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('IndexedDB unavailable'));
      };
    });
  }
  return dbPromise;
}

/** Closes the connection (used by tests to simulate closing and reopening the browser). */
export async function closeDb(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
}

export const saveDraft = (d: Draft): Promise<IDBValidKey> => tx('drafts', 'readwrite', (s) => s.put({ ...d, updatedAt: new Date().toISOString() }));
export const getDraft = (id: string): Promise<Draft | undefined> => tx<Draft | undefined>('drafts', 'readonly', (s) => s.get(id));
export const listDrafts = async (): Promise<Draft[]> => (await tx<Draft[]>('drafts', 'readonly', (s) => s.getAll())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export const deleteDraft = async (id: string): Promise<void> => {
  const photos = await listPhotos(id);
  for (const p of photos) await deletePhoto(p.id);
  await tx('drafts', 'readwrite', (s) => s.delete(id));
};

export const savePhoto = (p: LocalPhoto): Promise<IDBValidKey> => tx('photos', 'readwrite', (s) => s.put(p));
export const getPhoto = (id: string): Promise<LocalPhoto | undefined> => tx<LocalPhoto | undefined>('photos', 'readonly', (s) => s.get(id));
export const listPhotos = (submissionClientId: string): Promise<LocalPhoto[]> => tx<LocalPhoto[]>('photos', 'readonly', (s) => s.index('bySubmission').getAll(submissionClientId));
export const deletePhoto = (id: string): Promise<undefined> => tx<undefined>('photos', 'readwrite', (s) => s.delete(id));

export const cacheTemplate = (t: CachedTemplate): Promise<IDBValidKey> => tx('templates', 'readwrite', (s) => s.put(t));
export const getCachedTemplate = (key: string): Promise<CachedTemplate | undefined> => tx<CachedTemplate | undefined>('templates', 'readonly', (s) => s.get(key));
export const listCachedTemplates = (): Promise<CachedTemplate[]> => tx<CachedTemplate[]>('templates', 'readonly', (s) => s.getAll());
export const cacheContact = (c: CachedContact): Promise<IDBValidKey> => tx('contacts', 'readwrite', (s) => s.put(c));
export const listCachedContacts = (): Promise<CachedContact[]> => tx<CachedContact[]>('contacts', 'readonly', (s) => s.getAll());

export function newClientId(): string {
  return crypto.randomUUID();
}

/** Drafts with anything still to send (shown with an "unsynced data" warning). */
export function needsSync(d: Draft): boolean {
  return d.status !== 'synced' || (d.completeRequested && !d.completed);
}
