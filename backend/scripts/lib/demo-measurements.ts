/**
 * DEMO roof measurements and a sample Google-request ledger. Development only.
 *
 * Everything here is synthetic. Records carry `isDemo: true` and `automated.provider = 'demo_fixture'`; the UI and the PDF
 * label them "Demonstration data". They are never presented as Google results and are excluded from usage limits.
 * Idempotent: fixed ids, upserts only.
 */

import { ensureDefaultCompany } from '../../src/modules/companies/company.service.js';
import { CustomerModel } from '../../src/modules/customers/customer.model.js';
import { PropertyModel } from '../../src/modules/customers/property.model.js';
import { EstimateModel } from '../../src/modules/estimates/estimate.model.js';
import { MeasurementModel } from '../../src/modules/measurements/measurement.model.js';
import { edgesUnavailable } from '../../src/modules/measurements/solar/edges.js';
import { buildingInsightsFixture } from '../../src/modules/measurements/solar/fixtures.js';
import { normalizeBuildingInsights } from '../../src/modules/measurements/solar/normalize.js';
import { MaterialProductModel, SolarRequestModel } from '../../src/modules/measurements/solar/solar.model.js';
import { createDemoEstimate } from './demo-measurement-estimate.js';
import { UserModel } from '../../src/modules/users/user.model.js';
import { DEMO_EMAIL_DOMAIN, demoId } from './demo-data.js';




/** Resizes the fixture roof so each demo property gets a different size. */
function scaled(factor: number, pitchShift = 0) {
  const bi = buildingInsightsFixture();
  for (const s of bi.solarPotential!.roofSegmentStats!) {
    s.stats!.areaMeters2 = Number((s.stats!.areaMeters2! * factor).toFixed(2));
    s.stats!.groundAreaMeters2 = Number((s.stats!.groundAreaMeters2! * factor).toFixed(2));
    s.pitchDegrees = Number((s.pitchDegrees! + pitchShift).toFixed(2));
  }
  bi.solarPotential!.wholeRoofStats!.areaMeters2 = Number((167.7 * factor).toFixed(2));
  return normalizeBuildingInsights(bi);
}

/**
 * DEMO product catalog. Names are real product lines, but the coverage numbers are PLACEHOLDERS for development: every row is
 * `specConfirmed: false` and reports print it with an asterisk. Replace with your supplier's specifications before ordering.
 */
const DEMO_PRODUCTS: Array<{ family: 'shingle' | 'starter' | 'ice_water' | 'underlayment' | 'hip_ridge' | 'valley' | 'drip_edge'; brand: string; name: string; unit: string; coverage: number }> = [
  ...[['IKO', 'Cambridge'], ['CertainTeed', 'Landmark'], ['GAF', 'Timberline'], ['Owens Corning', 'Duration'], ['Atlas', 'Pristine']].map(([brand, name]) => ({ family: 'shingle' as const, brand: brand as string, name: name as string, unit: 'bundle', coverage: 33.3 })),
  ...[['IKO', 'Leading Edge Plus'], ['CertainTeed', 'SwiftStart'], ['GAF', 'Pro-Start'], ['Owens Corning', 'Starter Strip'], ['Atlas', 'Pro-Cut']].map(([brand, name]) => ({ family: 'starter' as const, brand: brand as string, name: name as string, unit: 'bundle', coverage: 105 })),
  ...[['IKO', 'StormShield'], ['CertainTeed', 'WinterGuard'], ['GAF', 'WeatherWatch'], ['Owens Corning', 'WeatherLock'], ['Atlas', 'WeatherMaster']].map(([brand, name]) => ({ family: 'ice_water' as const, brand: brand as string, name: name as string, unit: 'roll', coverage: 66 })),
  ...[['IKO', 'Stormtite'], ['CertainTeed', 'RoofRunner'], ['GAF', 'Deck-Armor'], ['Owens Corning', 'RhinoRoof'], ['Atlas', 'Summit']].map(([brand, name]) => ({ family: 'underlayment' as const, brand: brand as string, name: name as string, unit: 'roll', coverage: 1000 })),
  ...[['IKO', 'Hip and Ridge'], ['CertainTeed', 'Shadow Ridge'], ['GAF', 'Seal-A-Ridge'], ['Owens Corning', 'DecoRidge'], ['Atlas', 'Pro-Cut H&R']].map(([brand, name]) => ({ family: 'hip_ridge' as const, brand: brand as string, name: name as string, unit: 'bundle', coverage: 33 })),
  { family: 'valley', brand: '', name: "8' Valley", unit: 'sheet', coverage: 8 },
  { family: 'drip_edge', brand: '', name: "10' Drip Edge", unit: 'piece', coverage: 10 },
];

export async function seedMeasurementDemo(): Promise<string[]> {
  const log: string[] = [];
  const company = await ensureDefaultCompany();
  const users = await UserModel.find({ email: { $regex: `@${DEMO_EMAIL_DOMAIN.replace(/[.]/g, '[.]')}$` } }).select({ _id: 1, email: 1, role: 1 });
  const admin = users.find((u) => u.role === 'admin');
  if (!admin) return ['no demo admin found: skipped demo measurements'];
  const customers = await CustomerModel.find({ ownerId: { $in: users.map((u) => u._id) } }).sort({ _id: 1 }).limit(8);
  const props = (await Promise.all(customers.map((c) => PropertyModel.findOne({ customerId: c._id }).sort({ _id: 1 })))).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (props.length < 5) return ['fewer than 5 demo properties: skipped demo measurements'];

  const plans = [
    { key: 'completed', factor: 1.0, shift: 0, note: 'DEMO: completed sample measurement (not real).' },
    { key: 'corrected', factor: 1.35, shift: 4, note: 'DEMO: sample measurement with manual corrections and verification.' },
    { key: 'estimate', factor: 0.85, shift: 0, note: 'DEMO: sample measurement used for a Good/Better/Best estimate.' },
    { key: 'large', factor: 1.8, shift: 8, note: 'DEMO: larger sample roof.' },
  ] as const;

  let created = 0;
  const ids: Record<string, string> = {};
  for (const [i, plan] of plans.entries()) {
    const prop = props[i]!;
    const roof = scaled(plan.factor, plan.shift);
    const _id = demoId(`measurement:solar:${plan.key}`);
    ids[plan.key] = _id.toString();
    const corrected = plan.key === 'corrected';
    const base = {
      _id,
      companyId: company._id,
      propertyId: prop._id,
      customerId: prop.customerId,
      isDemo: true,
      source: 'manual', // never 'google_solar': this is not a Google result
      provider: 'none',
      providerStatus: 'manual_only',
      measurementDate: new Date(Date.now() - (i + 1) * 3 * 86_400_000),
      // replaceOne bypasses mongoose timestamps, so set them explicitly (the API reads createdAt/updatedAt).
      createdAt: new Date(Date.now() - (i + 1) * 3 * 86_400_000),
      updatedAt: new Date(Date.now() - (i + 1) * 3 * 86_400_000),
      units: 'sq_ft',
      totalArea: corrected ? Math.round(roof.areaSqFt * 1.02) : roof.areaSqFt,
      facets: roof.segmentCount,
      pitch: roof.predominantPitch,
      ridge: corrected ? 46.5 : undefined,
      hip: corrected ? 58 : undefined,
      eave: corrected ? 188 : undefined,
      rake: corrected ? 74 : undefined,
      notes: plan.note,
      revision: 1,
      automated: { ...roof, provider: 'demo_fixture', requestedAt: new Date().toISOString(), coordinates: { latitude: prop.location?.lat ?? 30.2672, longitude: prop.location?.lng ?? -97.7431 }, attribution: 'Demonstration data. Not from Google.' },
      edges: corrected
        ? edgesUnavailable().map((e) => ({ ...e, ...(({ ridge: 46.5, hip: 58, eave: 188, rake: 74 } as Record<string, number>)[e.type] !== undefined ? { lengthFt: ({ ridge: 46.5, hip: 58, eave: 188, rake: 74 } as Record<string, number>)[e.type], source: 'manual', confidence: 'none', verification: e.type === 'ridge' ? 'verified' : 'unverified', note: 'Entered manually (demo).' } : {}) }))
        : edgesUnavailable(),
      fieldSources: corrected ? { totalArea: 'manual', facets: 'google', pitch: 'calculated', ridge: 'manual', hip: 'manual', eave: 'manual', rake: 'manual' } : { totalArea: 'google', facets: 'google', pitch: 'calculated' },
      verified: corrected ? { ridge: true } : {},
      counts: corrected ? { pipeBoots: 5, vents: 4, skylights: 1, chimneys: 1, roofLayers: 2 } : {},
      corrections: corrected
        ? [
            { field: 'totalArea', original: roof.areaSqFt, updated: Math.round(roof.areaSqFt * 1.02), userId: admin._id.toString(), at: new Date().toISOString(), reason: 'DEMO: adjusted after site walk' },
            { field: 'ridge', original: null, updated: 46.5, userId: admin._id.toString(), at: new Date().toISOString(), reason: 'DEMO: tape measured' },
            { field: 'ridge', original: 46.5, updated: 46.5, userId: admin._id.toString(), at: new Date().toISOString(), reason: 'Verified: DEMO: confirmed with photo' },
          ]
        : [],
      createdBy: admin._id,
    };
    const exists = await MeasurementModel.exists({ _id });
    await MeasurementModel.collection.replaceOne({ _id }, new MeasurementModel(base).toObject({ depopulate: true }), { upsert: true });
    if (!exists) created += 1;
  }
  log.push(`demo roof measurements: ${plans.length} (${created} new) — labelled "Demonstration data", never shown as Google results`);
  let products = 0;
  for (const [i, p] of DEMO_PRODUCTS.entries()) {
    const r = await MaterialProductModel.updateOne(
      { companyId: company._id, family: p.family, brand: p.brand, name: p.name },
      { $setOnInsert: { companyId: company._id, family: p.family, brand: p.brand, name: p.name, packageUnit: p.unit, coveragePerPackage: p.coverage, enabled: true, specConfirmed: false, sortOrder: i, notes: 'DEMO placeholder coverage. Replace with the supplier specification.', isDemo: true } },
      { upsert: true },
    );
    if (r.upsertedCount) products += 1;
  }
  log.push(`demo material products: ${DEMO_PRODUCTS.length} (${products} new), coverage is a placeholder and marked unconfirmed`);

  // One demo estimate built from a demo measurement (only if none exists yet).
  const estMeasurementId = ids.estimate!;
  const estProp = props[2]!;
  const hasEstimate = await EstimateModel.exists({ measurementId: estMeasurementId });
  if (!hasEstimate) {
    const made = await createDemoEstimate({ adminId: admin._id.toString(), companyId: company._id.toString(), customerId: estProp.customerId.toString(), propertyId: estProp._id.toString(), measurementId: estMeasurementId });
    log.push(made ? 'demo Good/Better/Best estimate created from a demo measurement (draft pricing)' : 'demo estimate skipped (price catalog not installed)');
  } else log.push('demo estimate from measurement: already present');

  // Sample ledger so the usage dashboard has history. Flagged isDemo: excluded from limits and counters.
  const now = Date.now();
  const kinds: Array<['building_insights' | 'geocode', 'ok' | 'not_found' | 'error', string | undefined]> = [
    ['geocode', 'ok', undefined], ['building_insights', 'ok', 'HIGH'], ['geocode', 'ok', undefined], ['building_insights', 'ok', 'HIGH'],
    ['building_insights', 'not_found', 'HIGH'], ['building_insights', 'ok', 'BASE'], ['geocode', 'ok', undefined], ['building_insights', 'ok', 'HIGH'],
    ['building_insights', 'error', 'HIGH'], ['building_insights', 'ok', 'MEDIUM'], ['geocode', 'ok', undefined], ['building_insights', 'ok', 'HIGH'],
  ];
  for (const [i, [kind, status, quality]] of kinds.entries()) {
    const at = new Date(now - (i + 1) * 36 * 3_600_000);
    const _id = demoId(`solar-request:${i}`);
    await SolarRequestModel.collection.replaceOne(
      { _id },
      { _id, companyId: company._id, userId: admin._id, kind, quality, status, ...(status === 'error' ? { errorCode: 'QUOTA_EXCEEDED' } : status === 'not_found' ? { errorCode: 'NOT_FOUND' } : {}), durationMs: 600 + i * 37, month: at.toISOString().slice(0, 7), day: at.toISOString().slice(0, 10), requestedAt: at, isDemo: true },
      { upsert: true },
    );
  }
  log.push(`demo request ledger: ${kinds.length} sample rows (excluded from usage limits)`);
  return log;
}

export const DEMO_MEASUREMENT_KEYS = ['completed', 'corrected', 'estimate', 'large'] as const;
export const demoMeasurementIds = (): string[] => DEMO_MEASUREMENT_KEYS.map((k) => demoId(`measurement:solar:${k}`).toString());
export const demoRequestIds = (): string[] => Array.from({ length: 12 }, (_, i) => demoId(`solar-request:${i}`).toString());
