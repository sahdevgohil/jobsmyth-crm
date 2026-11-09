import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { LeadModel } from '../leads/lead.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PipelineStageModel } from '../settings/pipeline-stage.model.js';

describe('Analytics dashboard', () => {
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

  it('returns live counts matching independent queries (AC-DASH-1) and scopes salesperson (AC-DASH-2)', async () => {
    const adminId = await createUser({
      email: 'admin@example.com',
      role: 'admin',
      receivesLeads: false,
    });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const otherId = await createUser({ email: 'other@example.com', role: 'salesperson' });
    const newStage = await PipelineStageModel.findOne({ name: 'New' });

    await LeadModel.create({
      firstName: 'Mine',
      phone: '5125550001',
      phoneE164: '+15125550001',
      sourceKey: 'door_knocking',
      stageId: newStage!._id,
      assignedTo: salesId,
      createdBy: salesId,
    });
    await LeadModel.create({
      firstName: 'Theirs',
      phone: '5125550002',
      phoneE164: '+15125550002',
      sourceKey: 'door_knocking',
      stageId: newStage!._id,
      assignedTo: otherId,
      createdBy: otherId,
    });
    await CustomerModel.create({
      type: 'individual',
      firstName: 'Cust',
      ownerId: salesId,
      createdBy: salesId,
    });

    const salesLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sales@example.com', password: 'Password12345!' });
    const dash = await request(app)
      .get('/api/v1/analytics/dashboard')
      .set('Authorization', `Bearer ${salesLogin.body.data.accessToken}`);
    expect(dash.status).toBe(200);
    expect(dash.body.data.tiles.totalLeads).toBe(1);
    expect(dash.body.data.tiles.totalCustomers).toBe(1);
    expect(dash.body.data.tiles.newLeads).toBe(1);
    // Salespeople only ever see their own performance row.
    expect(dash.body.data.salesPerformance).toHaveLength(1);
    expect(dash.body.data.salesPerformance[0].userId).toBe(String(salesId));

    const independentLeads = await LeadModel.countDocuments({ assignedTo: salesId });
    expect(dash.body.data.tiles.totalLeads).toBe(independentLeads);

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Password12345!' });
    const adminDash = await request(app)
      .get('/api/v1/analytics/dashboard')
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`);
    expect(adminDash.body.data.tiles.totalLeads).toBe(2);
    expect(adminDash.body.data.salesPerformance.length).toBeGreaterThan(0);
    expect(adminId).toBeTruthy();
  });

  it('returns sales aggregations without loading raw lead arrays', async () => {
    const salesId = await createUser({ email: 'sales2@example.com', role: 'salesperson' });
    const newStage = await PipelineStageModel.findOne({ name: 'New' });
    await LeadModel.create({
      firstName: 'Agg',
      phone: '5125550099',
      phoneE164: '+15125550099',
      sourceKey: 'website',
      stageId: newStage!._id,
      assignedTo: salesId,
      createdBy: salesId,
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sales2@example.com', password: 'Password12345!' });
    const sales = await request(app)
      .get('/api/v1/analytics/sales')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(sales.status).toBe(200);
    expect(sales.body.data.totalLeads).toBe(1);
    expect(sales.body.data.leadsBySource).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'website', count: 1 })]),
    );
    expect(sales.body.data.leadsByStage).toEqual(
      expect.arrayContaining([expect.objectContaining({ count: 1 })]),
    );
    expect(sales.body.data.followUpPerformance).toMatchObject({
      total: expect.any(Number),
      completed: expect.any(Number),
      overdue: expect.any(Number),
    });
    expect(sales.body.data.leads).toBeUndefined();
  });
});
