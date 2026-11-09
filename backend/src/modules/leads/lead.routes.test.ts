import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { PipelineStageModel } from '../settings/pipeline-stage.model.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { LeadModel } from './lead.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { NotificationModel } from '../notifications/notification.model.js';

describe('Leads Phase 2 routes', () => {
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

  it('creates lead for salesperson assigned to self and scopes other leads as 404', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin', receivesLeads: false });
    const salesA = await createUser({
      email: 'a@example.com',
      role: 'salesperson',
      firstName: 'Ann',
    });
    await createUser({ email: 'b@example.com', role: 'salesperson', firstName: 'Bob' });

    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');

    const created = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Pat',
        phone: '(512) 555-0100',
        sourceKey: 'door_knocking',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.assignedTo).toBe(salesA);
    expect(created.body.data.phone).toBe('(512) 555-0100');

    const other = await request(app)
      .get(`/api/v1/leads/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(other.status).toBe(404);
  });

  it('requires lost reason when moving to lost stage', async () => {
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const token = await login('sales@example.com');
    const lead = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Lee', phone: '5125550199', sourceKey: 'phone_call' });
    const lost = await PipelineStageModel.findOne({ name: 'Lost' });

    const bad = await request(app)
      .post(`/api/v1/leads/${lead.body.data.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stageId: lost!._id.toString() });
    expect(bad.status).toBe(422);

    const ok = await request(app)
      .post(`/api/v1/leads/${lead.body.data.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stageId: lost!._id.toString(), lostReasonKey: 'price' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.lostReasonKey).toBe('price');
  });

  it('converts lead idempotently and creates customer + property', async () => {
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const token = await login('sales@example.com');
    const lead = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Chris',
        phone: '5125550111',
        sourceKey: 'door_knocking',
        address: { line1: '123 Main St', zip: '78701', city: 'Austin', state: 'TX' },
      });

    const first = await request(app)
      .post(`/api/v1/leads/${lead.body.data.id}/convert`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(first.status).toBe(200);
    const customerId = first.body.data.customerId as string;

    const second = await request(app)
      .post(`/api/v1/leads/${lead.body.data.id}/convert`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.data.customerId).toBe(customerId);
    expect(await CustomerModel.countDocuments()).toBe(1);

    const summary = await request(app)
      .get(`/api/v1/customers/${customerId}/summary`)
      .set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.properties).toHaveLength(1);
  });

  it('detects duplicate phone formats', async () => {
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const token = await login('sales@example.com');
    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'individual',
        firstName: 'Existing',
        phone: '+15125550100',
      });

    const check = await request(app)
      .post('/api/v1/leads/duplicate-check')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '(512) 555-0100' });
    expect(check.status).toBe(200);
    expect(check.body.data.some((m: { entityType: string }) => m.entityType === 'customer')).toBe(
      true,
    );
  });

  it('website intake is idempotent and notifies assignee', async () => {
    await createUser({ email: 'sales@example.com', role: 'salesperson', receivesLeads: true });

    const first = await request(app)
      .post('/api/v1/public/website-leads')
      .set('X-Website-Lead-Secret', 'test-website-intake-secret!!')
      .send({
        submissionId: 'sub-1',
        firstName: 'Web',
        phone: '5125550222',
      });
    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(true);
    expect(await LeadModel.countDocuments({ sourceKey: 'website' })).toBe(1);
    expect(await NotificationModel.countDocuments({ type: 'website_lead_received' })).toBe(1);

    const second = await request(app)
      .post('/api/v1/public/website-leads')
      .set('X-Website-Lead-Secret', 'test-website-intake-secret!!')
      .send({
        submissionId: 'sub-1',
        firstName: 'Web',
        phone: '5125550222',
      });
    expect(second.status).toBe(201);
    expect(second.body.data.created).toBe(false);
    expect(await LeadModel.countDocuments({ sourceKey: 'website' })).toBe(1);
  });

  it('admin can manage pipeline stages without deploy', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin', receivesLeads: false });
    const token = await login('admin@example.com');
    const created = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Qualified', category: 'open', order: 3 });
    expect(created.status).toBe(201);

    const list = await request(app)
      .get('/api/v1/settings/pipeline-stages')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.data.some((s: { name: string }) => s.name === 'Qualified')).toBe(true);
  });

  it('round-robin concurrent assignments stay fair (V2-01)', async () => {
    const { assignRoundRobin } = await import('./lead-assignment.service.js');
    const { CompanySettingsModel } = await import('../settings/company-settings.model.js');
    await createUser({ email: 's1@example.com', role: 'salesperson', firstName: 'S1' });
    await createUser({ email: 's2@example.com', role: 'salesperson', firstName: 'S2' });
    await createUser({ email: 's3@example.com', role: 'salesperson', firstName: 'S3' });

    const results = await Promise.all(
      Array.from({ length: 12 }, () => assignRoundRobin()),
    );
    const ids = results.map((id) => id.toString());
    expect(new Set(ids).size).toBe(3);
    const counts = Object.fromEntries(
      [...new Set(ids)].map((id) => [id, ids.filter((x) => x === id).length]),
    );
    expect(Object.values(counts).every((n) => n === 4)).toBe(true);

    const settings = await CompanySettingsModel.findOne().select({ leadAssignment: 1 });
    expect(settings?.leadAssignment?.lastAssignedUserId).toBeTruthy();
  });

  it('concurrent website intake with same submissionId never 500s (V2-02)', async () => {
    await createUser({ email: 'sales@example.com', role: 'salesperson', receivesLeads: true });
    const payload = {
      submissionId: 'race-sub-1',
      firstName: 'Race',
      phone: '5125550333',
    };
    const [a, b] = await Promise.all([
      request(app)
        .post('/api/v1/public/website-leads')
        .set('X-Website-Lead-Secret', 'test-website-intake-secret!!')
        .send(payload),
      request(app)
        .post('/api/v1/public/website-leads')
        .set('X-Website-Lead-Secret', 'test-website-intake-secret!!')
        .send(payload),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.data.created, b.body.data.created].filter(Boolean)).toHaveLength(1);
    expect(a.body.data.leadId).toBe(b.body.data.leadId);
    expect(a.body.data.leadId).toBeTruthy();
    expect(await LeadModel.countDocuments({ externalSubmissionId: 'race-sub-1' })).toBe(1);
  });

  it('website intake stays 201 when notification write fails (V2-04)', async () => {
    await createUser({ email: 'sales@example.com', role: 'salesperson', receivesLeads: true });
    const spy = vi.spyOn(NotificationModel, 'create').mockRejectedValueOnce(new Error('notify down'));
    try {
      const res = await request(app)
        .post('/api/v1/public/website-leads')
        .set('X-Website-Lead-Secret', 'test-website-intake-secret!!')
        .send({
          submissionId: 'notify-fail-1',
          firstName: 'Notify',
          phone: '5125550444',
        });
      expect(res.status).toBe(201);
      expect(res.body.data.created).toBe(true);
      expect(res.body.data.leadId).toBeTruthy();
      expect(await LeadModel.countDocuments({ externalSubmissionId: 'notify-fail-1' })).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects create into won or inactive stage (V2-03)', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin', receivesLeads: false });
    await createUser({ email: 'sales@example.com', role: 'salesperson', receivesLeads: true });
    const token = await login('admin@example.com');
    const won = await PipelineStageModel.findOne({ name: 'Won' });
    const contacted = await PipelineStageModel.findOne({ name: 'Contacted' });

    const wonCreate = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'WonBad',
        phone: '5125550444',
        sourceKey: 'phone_call',
        stageId: won!._id.toString(),
      });
    expect(wonCreate.status).toBe(422);
    expect(wonCreate.body.error.code).toBe('USE_CONVERT');

    await PipelineStageModel.updateOne({ _id: contacted!._id }, { $set: { isActive: false } });
    const inactiveCreate = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'InactiveBad',
        phone: '5125550445',
        sourceKey: 'phone_call',
        stageId: contacted!._id.toString(),
      });
    expect(inactiveCreate.status).toBe(422);
    expect(inactiveCreate.body.error.code).toBe('STAGE_INACTIVE');
  });

  it('blocks deactivating a stage that still has open leads (V2-05)', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin', receivesLeads: false });
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const salesToken = await login('sales@example.com');
    const newStage = await PipelineStageModel.findOne({ name: 'New' });

    await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ firstName: 'Stuck', phone: '5125550555', sourceKey: 'door_knocking' });

    const deactivate = await request(app)
      .patch(`/api/v1/settings/pipeline-stages/${newStage!._id.toString()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(422);
    expect(deactivate.body.error.code).toBe('STAGE_IN_USE');
  });

  it('rejects invalid email and invalid assignee (V2-10 / V2-14)', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin', receivesLeads: false });
    await createUser({ email: 'sales@example.com', role: 'salesperson', receivesLeads: true });
    const adminId = await createUser({
      email: 'other-admin@example.com',
      role: 'admin',
      receivesLeads: false,
    });
    const token = await login('admin@example.com');

    const badEmail = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Bad', email: 'not-an-email', sourceKey: 'phone_call' });
    expect(badEmail.status).toBe(400);

    const lead = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Ok', phone: '5125550666', sourceKey: 'phone_call' });
    const badAssign = await request(app)
      .post(`/api/v1/leads/${lead.body.data.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assignedTo: adminId });
    expect(badAssign.status).toBe(422);
    expect(badAssign.body.error.code).toBe('INVALID_ASSIGNEE');
  });

  it('reorder assigns unique sequential order to every stage (V2-17)', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin', receivesLeads: false });
    const token = await login('admin@example.com');
    const stages = await PipelineStageModel.find({ pipeline: 'lead' }).sort({ order: 1 });
    const partial = [stages[1]!._id.toString(), stages[0]!._id.toString()];
    const res = await request(app)
      .post('/api/v1/settings/pipeline-stages/reorder')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderedIds: partial });
    expect(res.status).toBe(200);
    const after = await PipelineStageModel.find({ pipeline: 'lead' }).sort({ order: 1 });
    const orders = after.map((s) => s.order);
    expect(orders).toEqual(Array.from({ length: after.length }, (_, i) => i + 1));
    expect(after[0]!._id.toString()).toBe(partial[0]);
    expect(after[1]!._id.toString()).toBe(partial[1]);
  });
});
