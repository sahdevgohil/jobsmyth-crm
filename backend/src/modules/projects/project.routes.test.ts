import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';

describe('Projects / subcontractors / work orders', () => {
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

  async function login(email: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password12345!' });
    return res.body.data.accessToken as string;
  }

  it('creates project, enforces status transitions, tasks, subcontractor and work order', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin', receivesLeads: false });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const salesToken = await login('sales@example.com');

    const customer = await CustomerModel.create({
      type: 'individual',
      firstName: 'Kim',
      lastName: 'Client',
      ownerId: salesId,
    });
    const property = await PropertyModel.create({
      customerId: customer._id,
      address: { line1: '9 Oak', city: 'Austin', state: 'TX', zip: '78702' },
    });

    const project = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        customerId: customer._id.toString(),
        propertyId: property._id.toString(),
        notes: 'Roof replacement',
      });
    expect(project.status).toBe(201);
    expect(project.body.data.number).toMatch(/^PRJ-\d{4}-0001$/);
    expect(project.body.data.status).toBe('awaiting_approval');

    const bad = await request(app)
      .post(`/api/v1/projects/${project.body.data.id}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ status: 'completed' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');

    const approved = await request(app)
      .post(`/api/v1/projects/${project.body.data.id}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ status: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');

    const task = await request(app)
      .post(`/api/v1/projects/${project.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ title: 'Order materials' });
    expect(task.status).toBe(201);

    const sub = await request(app)
      .post('/api/v1/subcontractors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyName: 'Texas Roof Crew', contactName: 'Luis', phone: '5125550199' });
    expect(sub.status).toBe(201);

    const wo = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        projectId: project.body.data.id,
        title: 'Tear-off',
        subcontractorId: sub.body.data.id,
      });
    expect(wo.status).toBe(201);
    expect(wo.body.data.number).toMatch(/^WO-\d{4}-0001$/);

    const done = await request(app)
      .patch(`/api/v1/work-orders/${wo.body.data.id}`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ status: 'completed', completionNotes: 'Finished' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('completed');
  });
});
