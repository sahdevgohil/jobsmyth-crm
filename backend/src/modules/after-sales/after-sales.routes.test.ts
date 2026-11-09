import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { ProjectModel } from '../projects/project.model.js';
import { LookupValueModel } from '../settings/lookup-value.model.js';

describe('After-sales routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await startTestDb();
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearCollections();
    await seedPhase2Config();
  });

  it('creates an after-sales record for a project', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    await LookupValueModel.create({
      type: 'warranty_type',
      key: 'manufacturer_basic',
      label: 'Manufacturer basic',
      order: 10,
      isActive: true,
    });
    const customer = await CustomerModel.create({
      type: 'individual',
      firstName: 'Pat',
      lastName: 'Customer',
      ownerId: adminId,
      createdBy: adminId,
    });
    const property = await PropertyModel.create({
      customerId: customer._id,
      address: { line1: '1 Main', city: 'Austin', state: 'TX', zip: '78701' },
      createdBy: adminId,
    });
    const project = await ProjectModel.create({
      number: 'PRJ-0001',
      customerId: customer._id,
      propertyId: property._id,
      status: 'completed',
      priority: 'normal',
      createdBy: adminId,
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Password12345!' });
    const token = login.body.data.accessToken as string;

    const created = await request(app)
      .post('/api/v1/after-sales')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: project._id.toString(),
        customerId: customer._id.toString(),
        propertyId: property._id.toString(),
        completionConfirmedAt: new Date().toISOString(),
        feedbackRating: 5,
        warrantyLookupKey: 'manufacturer_basic',
        warrantyNotes: 'Customer-supplied term text only.',
        followUpDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

    expect(created.status).toBe(201);
    expect(created.body.data.projectId).toBe(project._id.toString());
    expect(created.body.data.feedbackRating).toBe(5);
    expect(created.body.data.warrantyLookupKey).toBe('manufacturer_basic');
    expect(created.body.data.completionConfirmedBy).toBeTruthy();
  });
});
