/**
 * Removes ONLY the records created by the demo seed (matched by their deterministic ids).
 *   npm run seed:demo:reset -w backend
 * Local development databases only. Real data is never touched.
 */
import mongoose from 'mongoose';
import { loadEnv } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/db/connection.js';
import { buildDemoOps, type AnyModel } from './lib/demo-data.js';
import { assertDemoSeedAllowed } from './lib/demo-guard.js';
import { DEMO_SUBMISSION_CLIENT_IDS } from './lib/demo-field.js';
import { demoMeasurementIds, demoRequestIds } from './lib/demo-measurements.js';
import { EstimateModel } from '../src/modules/estimates/estimate.model.js';
import { MeasurementModel } from '../src/modules/measurements/measurement.model.js';
import { MaterialProductModel, SolarRequestModel } from '../src/modules/measurements/solar/solar.model.js';
import { FormSubmissionModel } from '../src/modules/forms/form.model.js';

async function main(): Promise<void> {
  loadEnv();
  assertDemoSeedAllowed({ destructive: true });
  await connectMongo();
  // Ids are independent of dates/stages, so any placeholder inputs reproduce the same id set.
  const anyStage = new Proxy({} as Record<string, mongoose.Types.ObjectId>, {
    get: () => new mongoose.Types.ObjectId(),
  });
  const ops = buildDemoOps({ now: new Date(), passwordHash: 'x', stageIds: anyStage });
  const byModel = new Map<string, { model: AnyModel; ids: mongoose.Types.ObjectId[] }>();
  for (const { model, doc } of ops) {
    const entry = byModel.get(model.modelName) ?? { model, ids: [] };
    entry.ids.push(doc._id);
    byModel.set(model.modelName, entry);
  }
  for (const [name, { model, ids }] of byModel) {
    const res = await model.deleteMany({ _id: { $in: ids } });
    console.log(`  ${name.padEnd(20)} removed ${res.deletedCount}`);
  }
  const mids = demoMeasurementIds();
  const est = await EstimateModel.deleteMany({ measurementId: { $in: mids } });
  const ms = await MeasurementModel.deleteMany({ _id: { $in: mids } });
  const reqs = await SolarRequestModel.deleteMany({ _id: { $in: demoRequestIds() } });
  console.log(`  Measurement (solar)  removed ${ms.deletedCount}, estimates ${est.deletedCount}, ledger rows ${reqs.deletedCount}`);
  const prods = await MaterialProductModel.deleteMany({ isDemo: true });
  console.log(`  MaterialProduct      removed ${prods.deletedCount}`);
  const subs = await FormSubmissionModel.deleteMany({ clientId: { $in: DEMO_SUBMISSION_CLIENT_IDS } });
  console.log(`  FormSubmission       removed ${subs.deletedCount}`);
  console.log('Demo records removed. Configuration (lookups, stages, settings) was left in place.');
  await disconnectMongo();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
