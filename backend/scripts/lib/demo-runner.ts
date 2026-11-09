import type mongoose from 'mongoose';
import { createPasswordHash } from '../../src/modules/auth/auth.service.js';
import { PipelineStageModel } from '../../src/modules/settings/pipeline-stage.model.js';
import { ensureCompanySettings } from '../../src/modules/settings/settings.service.js';
import { UserModel } from '../../src/modules/users/user.model.js';
import { seedLookups, seedPipelineStages } from './base-config.js';
import { buildDemoOps, DEMO_USERS, type DemoOp } from './demo-data.js';
import { verifyDemoOps } from './demo-verify.js';

export const DEFAULT_DEMO_PASSWORD = 'LegacyDemo!2026';

/** Ensures base configuration, then builds and verifies the demo dataset (does not write demo records). */
export async function prepareDemoOps(now = new Date()): Promise<DemoOp[]> {
  await ensureCompanySettings();
  await seedLookups();
  await seedPipelineStages();
  const stages = await PipelineStageModel.find({ pipeline: 'lead' });
  const stageIds: Record<string, mongoose.Types.ObjectId> = {};
  for (const s of stages) stageIds[s.name] = s._id;
  const existing = await UserModel.find({ email: { $in: DEMO_USERS.map((u) => u.email) } }).select({
    email: 1,
  });
  const existingUserIds: Record<string, mongoose.Types.ObjectId> = {};
  for (const u of existing) existingUserIds[u.email] = u._id;
  const password = process.env.DEMO_USER_PASSWORD ?? DEFAULT_DEMO_PASSWORD;
  const ops = buildDemoOps({
    now,
    passwordHash: await createPasswordHash(password),
    stageIds,
    existingUserIds,
  });
  const problems = verifyDemoOps(ops);
  if (problems.length > 0) {
    throw new Error(`Demo dataset failed consistency checks:\n${problems.join('\n')}`);
  }
  return ops;
}

/** Inserts/updates every demo record by stable id. Returns counts per collection. */
export async function writeDemoOps(ops: DemoOp[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const { model, doc } of ops) {
    const hydrated = new model(doc);
    await hydrated.validate();
    // Raw upsert keeps the explicit historical createdAt/updatedAt values.
    await model.collection.replaceOne({ _id: doc._id }, hydrated.toObject({ depopulate: true }), {
      upsert: true,
    });
    counts.set(model.modelName, (counts.get(model.modelName) ?? 0) + 1);
  }
  return counts;
}
