/**
 * Development-only: starts a persistent local MongoDB (single-node replica set, because the app
 * uses transactions) via mongodb-memory-server when no mongod is installed.
 *   npm run dev:db -w backend      (127.0.0.1:27017, data kept in backend/.devdb)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

if (process.env.NODE_ENV === 'production') throw new Error('dev:db is for development only.');
const dbPath = path.resolve(process.cwd(), '.devdb');
mkdirSync(dbPath, { recursive: true });
const port = Number(process.env.DEV_DB_PORT ?? 27017);
const rs = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger', dbName: 'legacy-roofing-crm' },
  instanceOpts: [{ port, dbPath }],
});
console.log(`Dev MongoDB ready: ${rs.getUri('legacy-roofing-crm')}`);
console.log(`Set MONGODB_URI=mongodb://127.0.0.1:${port}/legacy-roofing-crm?replicaSet=rs0&directConnection=true`);
process.on('SIGINT', () => void rs.stop().then(() => process.exit(0)));
