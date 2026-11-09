import type { Readable } from 'node:stream';

export type StorageStatus = {
  provider: 'local' | 's3';
  configured: true;
  mode: 'local_dev';
};

export type StoredObject = {
  body: Readable;
  sizeBytes: number;
};

/**
 * Storage abstraction for uploaded files.
 *
 * Objects are NEVER exposed through public URLs: downloads go through the authenticated
 * `/api/v1/files/:id/download` endpoint, which streams the object returned by `getObject`.
 *
 * Only the `local` provider exists today. An S3 adapter is NOT configured; it can be added
 * behind this interface without changing the files module.
 */
export interface StorageAdapter {
  putObject(input: { key: string; buffer: Buffer; contentType: string }): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  deleteObject(key: string): Promise<void>;
  getStatus(): StorageStatus;
}
