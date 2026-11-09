/**
 * Creates (or resets) an admin user non-interactively. LOCAL/dev use.
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run create-admin -w backend
 */
import { loadEnv } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/db/connection.js';
import { createPasswordHash } from '../src/modules/auth/auth.service.js';
import { UserModel } from '../src/modules/users/user.model.js';

async function main(): Promise<void> {
  loadEnv();
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email || password.length < 12) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 characters).');
  }
  await connectMongo();
  const passwordHash = await createPasswordHash(password);
  const existing = await UserModel.findOne({ email });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    existing.isActive = true;
    existing.mustChangePassword = false;
    await existing.save();
    console.log(`Updated existing user ${email} (admin, active).`);
  } else {
    await UserModel.create({
      email,
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true,
      receivesLeads: false,
      mustChangePassword: false,
      passwordHash,
    });
    console.log(`Created admin ${email}.`);
  }
  await disconnectMongo();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
