/**
 * Dev tool: runs the real measurement pipeline (real Google calls, billable within your free allowance) for one address against
 * the database in MONGODB_URI and writes the PDF to a folder. Usage: npx tsx --env-file=.env scripts/measure-real.ts "<address>" <outDir>
 */
import { writeFileSync } from 'node:fs';
import { PERMISSIONS } from '../src/config/permissions.js';
import { loadEnv } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/db/connection.js';
import { ensureDefaultCompany } from '../src/modules/companies/company.service.js';
import { CustomerModel } from '../src/modules/customers/customer.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { searchAddress, runMeasurement } from '../src/modules/measurements/solar/solar.service.js';
import { generateSolarReport } from '../src/modules/measurements/solar/solar.report.js';
import { buildDiagrams, summaryFor } from '../src/modules/measurements/solar/solar.geometry.service.js';
import { MeasurementModel } from '../src/modules/measurements/measurement.model.js';

loadEnv();
await connectMongo();
const [address, outDir = '.'] = [process.argv[2] ?? '', process.argv[3]];
const company = await ensureDefaultCompany();
const admin = await UserModel.findOne({ role: 'admin' });
const customer = await CustomerModel.findOne({});
if (!admin || !customer) throw new Error('Seed the demo data first');
const ctx = { userId: admin._id.toString(), role: 'admin' as const, companyId: company._id.toString(), permissions: [...PERMISSIONS] };
const found = await searchAddress(ctx, address, true);
const g = found.geocoded[0];
if (!g) throw new Error('No geocode result');
console.log('geocoded:', g.formattedAddress, g.locationType, g.latitude, g.longitude);
const r = await runMeasurement(ctx, { customerId: customer._id.toString(), address: { line1: g.line1, city: g.city, state: g.state, zip: g.zip }, latitude: g.latitude, longitude: g.longitude, confirmApproximate: true, force: true });
const doc = (await MeasurementModel.findById(r.measurement.id))!;
const geo = doc.geometry as { status: string; reason: string | null; facets: unknown[]; edges: Array<{ type: string; lengthFt: number | null; confidence: string; verification: string }>; structures: unknown[]; warnings: string[]; imagery: unknown };
console.log('measurement', r.measurement.id, 'area', doc.totalArea, 'pitch', doc.pitch, 'segments', doc.facets);
console.log('geometry', geo.status, geo.reason, 'facets', geo.facets.length, 'structures', geo.structures.length, 'edges', geo.edges.length);
const byType: Record<string, number> = {};
for (const e of geo.edges) byType[`${e.type}/${e.verification}`] = (byType[`${e.type}/${e.verification}`] ?? 0) + (e.lengthFt ?? 0);
console.log('edge totals ft', byType, 'warnings', geo.warnings);
console.log('summary', JSON.stringify(summaryFor(doc).structures.map((s) => ({ id: s.id, foot: s.footprintAreaSqFt, roof: s.roofAreaSqFt }))));
const pdf = await generateSolarReport(ctx, r.measurement.id, 14);
if (outDir) {
  writeFileSync(`${outDir}/real-report.pdf`, pdf.buffer);
  const d = buildDiagrams(doc);
  for (const [k, svg] of Object.entries(d.svgs)) writeFileSync(`${outDir}/diagram-${k}.svg`, svg as string);
}
console.log('pdf pages', pdf.pages, 'bytes', pdf.buffer.length);
await disconnectMongo();
