import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { loadEnv, resetEnvCache } from '../config/env.js';

let replSet: MongoMemoryReplSet | undefined;
let storageDir: string | undefined;

export async function startTestDb(): Promise<string> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri('legacy-crm-test');
  process.env.NODE_ENV = 'test';
  process.env.PORT = '4000';
  process.env.APP_URL = 'http://localhost:5173';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.MONGODB_URI = uri;
  process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-at-least-32-chars!!';
  process.env.REFRESH_TOKEN_TTL_DAYS = '14';
  process.env.WEBSITE_LEAD_INTAKE_SECRET = 'test-website-intake-secret!!';
  storageDir = mkdtempSync(path.join(os.tmpdir(), 'legacy-crm-files-'));
  process.env.FILE_STORAGE_DIR = storageDir;
  process.env.FILE_MAX_BYTES = '8000000';
  resetEnvCache();
  loadEnv();
  await mongoose.connect(uri);
  return uri;
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
  if (storageDir) {
    rmSync(storageDir, { recursive: true, force: true });
    storageDir = undefined;
  }
  resetEnvCache();
}

export async function clearCollections(): Promise<void> {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    const collection = collections[key];
    if (collection) {
      await collection.deleteMany({});
    }
  }
}
