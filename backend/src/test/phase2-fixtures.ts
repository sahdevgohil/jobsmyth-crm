import { createPasswordHash } from '../modules/auth/auth.service.js';
import { LookupValueModel } from '../modules/settings/lookup-value.model.js';
import { PipelineStageModel } from '../modules/settings/pipeline-stage.model.js';
import { ensureCompanySettings } from '../modules/settings/settings.service.js';
import { UserModel } from '../modules/users/user.model.js';

export async function seedPhase2Config(): Promise<void> {
  await ensureCompanySettings();

  const lookups = [
    { type: 'lead_source', key: 'door_knocking', label: 'Door knocking', order: 10 },
    { type: 'lead_source', key: 'website', label: 'Website', order: 30 },
    { type: 'lead_source', key: 'phone_call', label: 'Phone call', order: 40 },
    { type: 'lost_reason', key: 'price', label: 'Price', order: 10 },
    { type: 'property_type', key: 'single_family', label: 'Single-family', order: 10 },
    { type: 'project_category', key: 'roofing', label: 'Roofing', order: 10 },
  ] as const;

  for (const item of lookups) {
    await LookupValueModel.updateOne(
      { type: item.type, key: item.key },
      { $setOnInsert: { ...item, isActive: true } },
      { upsert: true },
    );
  }

  const stages = [
    { name: 'New', category: 'open', order: 1 },
    { name: 'Contacted', category: 'open', order: 2 },
    { name: 'Won', category: 'won', order: 6 },
    { name: 'Lost', category: 'lost', order: 7 },
  ];
  for (const stage of stages) {
    await PipelineStageModel.updateOne(
      { pipeline: 'lead', name: stage.name },
      { $setOnInsert: { pipeline: 'lead', ...stage, isActive: true } },
      { upsert: true },
    );
  }
}

export async function createUser(input: {
  email: string;
  role: 'admin' | 'salesperson';
  receivesLeads?: boolean;
  firstName?: string;
  lastName?: string;
  /** Put the user in a specific company (default: the default company, assigned lazily). */
  companyId?: string;
}): Promise<string> {
  const user = await UserModel.create({
    email: input.email,
    firstName: input.firstName ?? 'Test',
    lastName: input.lastName ?? 'User',
    role: input.role,
    isActive: true,
    ...(input.companyId ? { companyId: input.companyId } : {}),
    receivesLeads: input.receivesLeads ?? input.role === 'salesperson',
    mustChangePassword: false,
    passwordHash: await createPasswordHash('Password12345!'),
  });
  return user._id.toString();
}
