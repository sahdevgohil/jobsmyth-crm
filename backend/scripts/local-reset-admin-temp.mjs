/**
 * LOCAL ONLY recovery: reset the seeded admin password hash and keep
 * mustChangePassword=true so the forced password-change flow can be verified.
 * Does not print the password.
 */
import process from 'node:process';
import mongoose from 'mongoose';
import * as argon2 from 'argon2';

const email = process.env.LOCAL_ADMIN_EMAIL ?? 'admin123@gmail.com';
const tempPassword = process.env.LOCAL_ADMIN_TEMP_PASSWORD ?? 'LocalTempPass1!';

await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/legacy-roofing-crm');
const hash = await argon2.hash(tempPassword, { type: argon2.argon2id });
const result = await mongoose.connection.db.collection('users').updateOne(
  { email },
  { $set: { passwordHash: hash, mustChangePassword: true, isActive: true } },
);
process.stdout.write(
  `${JSON.stringify({ email, matched: result.matchedCount, modified: result.modifiedCount, mustChangePassword: true })}\n`,
);
await mongoose.disconnect();
