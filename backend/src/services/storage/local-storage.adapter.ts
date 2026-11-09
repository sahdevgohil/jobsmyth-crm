import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../../config/env.js';
import type { StorageAdapter, StorageStatus, StoredObject } from './storage.types.js';

const MAX_FILENAME_LENGTH = 100;

/** Reduce a client-supplied filename to a safe, flat file name (no paths, no odd characters). */
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(-MAX_FILENAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'file';
}

/** Build a storage key of the form `yyyy/mm/<uuid>-<sanitizedFilename>`. */
export function buildStorageKey(filename: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${yyyy}/${mm}/${randomUUID()}-${sanitizeFilename(filename)}`;
}

export class LocalStorageAdapter implements StorageAdapter {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Resolve a key to an absolute path, refusing anything that escapes the storage root. */
  private resolveKey(key: string): string {
    const resolved = path.resolve(this.root, key);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid storage key');
    }
    return resolved;
  }

  async putObject(input: { key: string; buffer: Buffer; contentType: string }): Promise<void> {
    const target = this.resolveKey(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.buffer, { flag: 'wx' });
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const target = this.resolveKey(key);
    try {
      const info = await stat(target);
      if (!info.isFile()) return null;
      return { body: createReadStream(target), sizeBytes: info.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  getStatus(): StorageStatus {
    return { provider: 'local', configured: true, mode: 'local_dev' };
  }
}

let cached: { dir: string; adapter: StorageAdapter } | undefined;

/**
 * Returns the active storage adapter. Always the local adapter for now.
 * S3 is NOT configured (no credentials/bucket settings exist); add it here when it is.
 */
export function getStorageAdapter(): StorageAdapter {
  const dir = path.resolve(getEnv().FILE_STORAGE_DIR);
  if (!cached || cached.dir !== dir) {
    cached = { dir, adapter: new LocalStorageAdapter(dir) };
  }
  return cached.adapter;
}
