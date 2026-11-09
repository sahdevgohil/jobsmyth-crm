/**
 * Idempotent configuration seed: Admin user (prompted), company settings, lookups, pipeline stages.
 * Does not create fake business records (leads, customers, etc.).
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadEnv } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/db/connection.js';
import { createPasswordHash } from '../src/modules/auth/auth.service.js';
import { ensureCompanySettings } from '../src/modules/settings/settings.service.js';
import { seedLookups, seedPipelineStages } from './lib/base-config.js';
import { UserModel } from '../src/modules/users/user.model.js';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function seedAdmin(): Promise<void> {
  const existingAdmin = await UserModel.findOne({ role: 'admin', isActive: true });
  if (existingAdmin) {
    console.log(`Active admin already exists (${existingAdmin.email}). Skipping admin creation.`);
    return;
  }

  const email = (await prompt('Admin email: ')).toLowerCase();
  const firstName = (await prompt('Admin first name: ')) || 'Admin';
  const lastName = (await prompt('Admin last name: ')) || 'User';
  const password = await prompt('Admin temporary password (min 12 chars): ');
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters.');
  }

  await UserModel.create({
    email,
    firstName,
    lastName,
    role: 'admin',
    isActive: true,
    receivesLeads: false,
    mustChangePassword: true,
    passwordHash: await createPasswordHash(password),
  });
  console.log(`Admin created: ${email}`);
}

async function main(): Promise<void> {
  loadEnv();
  await connectMongo();
  await ensureCompanySettings();
  console.log('Company settings ensured.');
  await seedLookups();
  await seedPipelineStages();
  await seedAdmin();
  await disconnectMongo();
  console.log('Seed complete.');
}

main().catch(async (error: unknown) => {
  console.error(error);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
