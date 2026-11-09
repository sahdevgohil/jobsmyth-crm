/**
 * Demo data for forms, inspections and pricing. Development only (guarded by the caller).
 * Idempotent: templates/catalogs install once; demo submissions use fixed client ids.
 * All prices are the client's DRAFT, UNAPPROVED figures. Customers and addresses are fictional.
 */
import { CustomerModel } from '../../src/modules/customers/customer.model.js';
import { PropertyModel } from '../../src/modules/customers/property.model.js';
import { ensureDefaultCompany } from '../../src/modules/companies/company.service.js';
import { FormSubmissionModel } from '../../src/modules/forms/form.model.js';
import { createSubmission, installDefaultTemplates, updateSubmission, type FormCtx } from '../../src/modules/forms/form.service.js';
import { installDefaults } from '../../src/modules/pricing/pricing.service.js';
import { PERMISSIONS } from '../../src/config/permissions.js';
import { UserModel } from '../../src/modules/users/user.model.js';
import { DEMO_EMAIL_DOMAIN } from './demo-data.js';
import { seedMeasurementDemo } from './demo-measurements.js';

const DEMO_SUBMISSIONS = [
  {
    clientId: '00000000-0000-4000-8000-00000000d001',
    templateKey: 'roofing_inspection',
    answers: { inspection_date: '2026-11-03', inspection_time: '09:30', inspector: 'Maria Delgado', weather: 'Clear', roof_material: 'asphalt_shingle', roofing_layers: 1, roof_age_years: 14, roof_pitch: '7/12', slope_count: 4, walkability: 'walkable', harness_required: false },
  },
  {
    clientId: '00000000-0000-4000-8000-00000000d002',
    templateKey: 'remodeling_inspection',
    answers: { area: 'kitchen', customer_goals: 'Open the kitchen to the dining room and replace outdated cabinets.', budget_range: '25k_50k', timeline: 'within_3_months', room_length: { value: 14, unit: 'ft' }, room_width: { value: 12, unit: 'ft' }, ceiling_height: { value: 9, unit: 'ft' }, window_openings: 2, door_openings: 2 },
  },
  {
    clientId: '00000000-0000-4000-8000-00000000d003',
    templateKey: 'gutter_inspection',
    answers: {},
  },
] as const;

export const DEMO_SUBMISSION_CLIENT_IDS: string[] = DEMO_SUBMISSIONS.map((s) => s.clientId);

export async function seedFieldDemo(): Promise<string[]> {
  const log: string[] = [];
  const company = await ensureDefaultCompany();
  const admin = await UserModel.findOne({ email: `admin@${DEMO_EMAIL_DOMAIN}` });
  if (!admin) throw new Error('Run the base demo seed first (admin demo user missing).');
  const ctx: FormCtx = { userId: admin._id.toString(), companyId: company._id.toString(), role: 'admin', permissions: [...PERMISSIONS] };

  await installDefaultTemplates(ctx);
  log.push('form templates installed (11 default forms, version 1)');
  const pricing = await installDefaults(ctx);
  log.push(`price catalog (draft/unapproved): ${pricing.catalogCreated ? 'created' : 'already present'}; subcontractor rate card (draft): ${pricing.rateCardCreated ? 'created' : 'already present'}`);

  const customer = await CustomerModel.findOne({ ownerId: { $in: (await UserModel.find({ email: { $regex: `@${DEMO_EMAIL_DOMAIN.replace(/[.]/g, '[.]')}$` } }).select({ _id: 1 })).map((u) => u._id) } }).sort({ _id: 1 });
  const property = customer ? await PropertyModel.findOne({ customerId: customer._id }).sort({ _id: 1 }) : null;
  if (!customer || !property) {
    log.push('no demo customer found: skipped demo inspections');
    return log;
  }
  for (const s of DEMO_SUBMISSIONS) {
    const r = await createSubmission(ctx, { clientId: s.clientId, templateKey: s.templateKey, links: { customerId: customer._id.toString(), propertyId: property._id.toString() } });
    if (r.created && Object.keys(s.answers).length > 0) {
      await updateSubmission(ctx, r.submission.id, { answers: s.answers as Record<string, unknown>, expectedRevision: r.submission.revision });
    }
    log.push(`${s.templateKey}: ${r.created ? 'created (draft)' : 'already present'}`);
  }
  const n = await FormSubmissionModel.countDocuments({ companyId: company._id });
  log.push(`form submissions in company: ${n}`);
  log.push(...(await seedMeasurementDemo()));
  return log;
}
