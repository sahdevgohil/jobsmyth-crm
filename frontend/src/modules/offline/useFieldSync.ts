import { useCallback, useEffect, useState } from 'react';
import { syncApi } from '@/modules/forms/api';
import { listDrafts, needsSync, type Draft } from './store';
import { syncAll } from './sync';

let running = false;
const listeners = new Set<() => void>();
export const notifyDraftsChanged = (): void => listeners.forEach((l) => l());

/** Drafts on this device, online state and a "sync now" action. Auto-syncs when the connection returns. */
export function useFieldSync(autoSync = false) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDrafts(await listDrafts());
    } catch {
      setDrafts([]); // IndexedDB unavailable (private mode): the pages show their own warning
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (running || !navigator.onLine) return;
    running = true;
    setSyncing(true);
    try {
      await syncAll(syncApi, () => notifyDraftsChanged());
    } finally {
      running = false;
      setSyncing(false);
      notifyDraftsChanged();
    }
  }, []);

  useEffect(() => {
    void refresh();
    listeners.add(refresh);
    const on = (): void => {
      setOnline(true);
      if (autoSync) void syncNow();
    };
    const off = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = window.setInterval(() => void refresh(), 5000);
    if (autoSync && navigator.onLine) void syncNow();
    return () => {
      listeners.delete(refresh);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.clearInterval(t);
    };
  }, [refresh, syncNow, autoSync]);

  return { drafts, online, syncing, syncNow, refresh, unsynced: drafts.filter(needsSync).length };
}
