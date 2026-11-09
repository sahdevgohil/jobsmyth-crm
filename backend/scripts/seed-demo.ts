/**
 * Deterministic, idempotent DEVELOPMENT demo data.
 *   npm run seed:demo -w backend
 * Upserts records by stable ids; never deletes anything; refuses to run in production.
 */
import { loadEnv } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/db/connection.js';
import { DEMO_USERS } from './lib/demo-data.js';
import { seedFieldDemo } from './lib/demo-field.js';
import { assertDemoSeedAllowed } from './lib/demo-guard.js';
import { DEFAULT_DEMO_PASSWORD, prepareDemoOps, writeDemoOps } from './lib/demo-runner.js';

async function main(): Promise<void> {
  loadEnv();
  assertDemoSeedAllowed({ destructive: false });
  await connectMongo();
  const ops = await prepareDemoOps();
  const counts = await writeDemoOps(ops);
  for (const [name, n] of [...counts].sort()) console.log(`  ${name.padEnd(20)} ${n}`);
  console.log(`Demo data upserted (${ops.length} records).`);
  for (const line of await seedFieldDemo()) console.log(`  ${line}`);
  console.log('Demo staff logins (development only):');
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(12)} ${u.email}`);
  console.log(
    `  password: ${process.env.DEMO_USER_PASSWORD ? '(from DEMO_USER_PASSWORD)' : DEFAULT_DEMO_PASSWORD}`,
  );
  await disconnectMongo();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
