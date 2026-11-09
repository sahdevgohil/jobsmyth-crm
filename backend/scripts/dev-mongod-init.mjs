/**
 * Development only: initiates the single-node replica set `rs0` on a local mongod that was started with
 *   mongod --dbpath backend/.mongo-data --replSet rs0 --port 27018 --bind_ip 127.0.0.1
 * (the application uses transactions, which need a replica set). Safe to run repeatedly.
 */
import process from 'node:process';
import mongoose from 'mongoose';

const port = process.env.DEV_MONGO_PORT ?? '27018';
const conn = await mongoose.createConnection(`mongodb://127.0.0.1:${port}/admin?directConnection=true`).asPromise();
try {
  const status = await conn.db.admin().command({ replSetGetStatus: 1 });
  process.stdout.write(`Replica set already initiated: ${status.set}\n`);
} catch {
  await conn.db.admin().command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  process.stdout.write('Replica set rs0 initiated.\n');
}
await conn.close();
