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
import { LookupValueModel } from '../src/modules/settings/lookup-value.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import mongoose from 'mongoose';

const DEFAULT_LOOKUPS: Array<{ type: string; key: string; label: string; order: number }> = [
  { type: 'lead_source', key: 'door_knocking', label: 'Door knocking', order: 10 },
  { type: 'lead_source', key: 'word_of_mouth', label: 'Word of mouth', order: 20 },
  { type: 'lead_source', key: 'website', label: 'Website', order: 30 },
  { type: 'lead_source', key: 'phone_call', label: 'Phone call', order: 40 },
  { type: 'lead_source', key: 'other', label: 'Other', order: 50 },
  { type: 'lost_reason', key: 'price', label: 'Price', order: 10 },
  { type: 'lost_reason', key: 'competitor', label: 'Chose competitor', order: 20 },
  { type: 'lost_reason', key: 'timing', label: 'Timing / not ready', order: 30 },
  { type: 'lost_reason', key: 'other', label: 'Other', order: 40 },
  { type: 'property_type', key: 'single_family', label: 'Single-family', order: 10 },
  { type: 'property_type', key: 'multi_family', label: 'Multi-family', order: 20 },
  { type: 'property_type', key: 'commercial', label: 'Commercial', order: 30 },
  { type: 'appointment_type', key: 'inspection', label: 'Inspection', order: 10 },
  { type: 'appointment_type', key: 'sales_consultation', label: 'Sales consultation', order: 20 },
  { type: 'appointment_type', key: 'estimate_presentation', label: 'Estimate presentation', order: 30 },
  { type: 'appointment_type', key: 'production_walkthrough', label: 'Production walkthrough', order: 40 },
  { type: 'appointment_type', key: 'other', label: 'Other', order: 50 },
  { type: 'project_category', key: 'roofing', label: 'Roofing', order: 10 },
  { type: 'project_category', key: 'gutters', label: 'Gutters', order: 20 },
  { type: 'project_category', key: 'windows', label: 'Windows', order: 30 },
  { type: 'project_category', key: 'remodeling', label: 'Remodeling', order: 40 },
  { type: 'project_category', key: 'exterior_repair', label: 'Exterior repair', order: 50 },
  { type: 'project_category', key: 'interior_repair', label: 'Interior repair', order: 60 },
  { type: 'project_category', key: 'general_construction', label: 'General construction', order: 70 },
  { type: 'project_category', key: 'commercial', label: 'Commercial', order: 80 },
  { type: 'warranty_type', key: 'manufacturer', label: 'Manufacturer', order: 10 },
  { type: 'warranty_type', key: 'workmanship', label: 'Workmanship', order: 20 },
];

const DEFAULT_LEAD_STAGES = [
  { name: 'New', category: 'open', order: 1 },
  { name: 'Contacted', category: 'open', order: 2 },
  { name: 'Appointment Set', category: 'open', order: 3 },
  { name: 'Inspected', category: 'open', order: 4 },
  { name: 'Estimate Sent', category: 'open', order: 5 },
  { name: 'Won', category: 'won', order: 6 },
  { name: 'Lost', category: 'lost', order: 7 },
];

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function seedLookups(): Promise<void> {
  for (const item of DEFAULT_LOOKUPS) {
    await LookupValueModel.updateOne(
      { type: item.type, key: item.key },
      {
        $setOnInsert: {
          type: item.type,
          key: item.key,
          label: item.label,
          order: item.order,
          isActive: true,
        },
      },
      { upsert: true },
    );
  }
  console.log(`Lookups seeded (${DEFAULT_LOOKUPS.length} keys).`);
}

async function seedPipelineStages(): Promise<void> {
  const collection = mongoose.connection.collection('pipelineStages');
  for (const stage of DEFAULT_LEAD_STAGES) {
    await collection.updateOne(
      { pipeline: 'lead', name: stage.name },
      {
        $setOnInsert: {
          pipeline: 'lead',
          name: stage.name,
          category: stage.category,
          order: stage.order,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  console.log(`Lead pipeline stages seeded (${DEFAULT_LEAD_STAGES.length}).`);
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
