import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { NotificationModel } from '../notifications/notification.model.js';
import { CompanySettingsModel } from '../settings/company-settings.model.js';

describe('Inspections routes', () => {
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
    await CompanySettingsModel.updateOne({}, { $set: { displayName: 'Legacy Test Roofing' } });
  });

  async function login(email: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password12345!' });
    return res.body.data.accessToken as string;
  }

  async function createCustomer(ownerId: string, line1 = '742 Evergreen Terrace') {
    const customer = await CustomerModel.create({
      type: 'individual',
      firstName: 'Homer',
      lastName: 'Simpson',
      ownerId,
    });
    const property = await PropertyModel.create({
      customerId: customer._id,
      address: { line1, city: 'Austin', state: 'TX', zip: '78701' },
    });
    return { customerId: customer._id.toString(), propertyId: property._id.toString() };
  }

  it('creates, starts, completes an inspection and renders the printable report', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const token = await login('a@example.com');
    const { customerId, propertyId } = await createCustomer(salesId);

    const created = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        propertyId,
        findings: 'Missing shingles <b>north</b> slope',
        roofCondition: 'Fair',
        measurements: { totalAreaSqFt: 2400, pitch: '6/12' },
      });
    expect(created.status).toBe(201);
    const inspection = created.body.data;
    expect(inspection.status).toBe('draft');
    expect(inspection.typeKey).toBe('standard');
    expect(inspection.assignedTo).toBe(salesId);
    expect(inspection.measurements.totalAreaSqFt).toBe(2400);
    expect(inspection.reportGeneratedAt).toBeNull();
    const id = inspection.id as string;

    const started = await request(app)
      .patch(`/api/v1/inspections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'in_progress',
        recommendations: 'Replace north slope',
        damageObservations: 'Hail bruising',
        measurements: { notes: 'Measured on site' },
      });
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('in_progress');
    expect(started.body.data.measurements).toEqual({
      totalAreaSqFt: 2400,
      pitch: '6/12',
      notes: 'Measured on site',
    });

    const completed = await request(app)
      .post(`/api/v1/inspections/${id}/complete`)
      .set('Authorization', `Bearer ${token}`);
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('completed');
    expect(completed.body.data.reportGeneratedAt).not.toBeNull();
    expect(
      await NotificationModel.countDocuments({ userId: salesId, type: 'inspection_completed' }),
    ).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'inspection.complete', entityId: id })).toBe(1);

    const again = await request(app)
      .post(`/api/v1/inspections/${id}/complete`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(409);

    // Completed is read-only for salespeople; only an admin may reopen.
    const edit = await request(app)
      .patch(`/api/v1/inspections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ findings: 'changed' });
    expect(edit.status).toBe(409);
    const salesReopen = await request(app)
      .patch(`/api/v1/inspections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });
    expect(salesReopen.status).toBe(403);
    const reopened = await request(app)
      .patch(`/api/v1/inspections/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'in_progress', findings: 'Updated findings' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('in_progress');
    expect(reopened.body.data.findings).toBe('Updated findings');
    // reportGeneratedAt is kept on reopen / re-complete.
    const firstGenerated = completed.body.data.reportGeneratedAt;
    const recompleted = await request(app)
      .post(`/api/v1/inspections/${id}/complete`)
      .set('Authorization', `Bearer ${token}`);
    expect(recompleted.body.data.reportGeneratedAt).toBe(firstGenerated);

    const report = await request(app)
      .get(`/api/v1/inspections/${id}/report`)
      .set('Authorization', `Bearer ${token}`);
    expect(report.status).toBe(200);
    expect(report.headers['content-type']).toContain('text/html');
    expect(report.text).toContain('742 Evergreen Terrace');
    expect(report.text).toContain('Legacy Test Roofing');
    expect(report.text).toContain('Homer Simpson');
    expect(report.text).toContain('Updated findings');
    expect(report.text).toContain('Replace north slope');
    expect(report.text).toContain('2400 sq ft');

    // Findings text is HTML-escaped.
    const reopenedAgain = await request(app)
      .patch(`/api/v1/inspections/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'in_progress', findings: 'Missing shingles <b>north</b> slope' });
    expect(reopenedAgain.status).toBe(200);
    const escaped = await request(app)
      .get(`/api/v1/inspections/${id}/report`)
      .set('Authorization', `Bearer ${token}`);
    expect(escaped.text).toContain('Missing shingles &lt;b&gt;north&lt;/b&gt; slope');
    expect(escaped.text).not.toContain('<b>north</b>');
  });

  it('lists photo metadata for the inspection in the report', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const token = await login('admin@example.com');
    const adminOwner = await createUser({ email: 'owner@example.com', role: 'salesperson' });
    const { customerId, propertyId } = await createCustomer(adminOwner);

    const created = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, propertyId });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const upload = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .send({
        filename: 'north-slope.jpg',
        mimeType: 'image/jpeg',
        category: 'photo',
        contentBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
        caption: 'Hail damage north slope',
        inspectionId: id,
      });
    expect(upload.status).toBe(201);
    // Customer/property are inherited from the inspection.
    expect(upload.body.data.customerId).toBe(customerId);
    expect(upload.body.data.propertyId).toBe(propertyId);

    const report = await request(app)
      .get(`/api/v1/inspections/${id}/report`)
      .set('Authorization', `Bearer ${token}`);
    expect(report.status).toBe(200);
    expect(report.text).toContain('north-slope.jpg');
    expect(report.text).toContain('Hail damage north slope');

    // Files on a completed inspection are locked against deletion.
    await request(app)
      .post(`/api/v1/inspections/${id}/complete`)
      .set('Authorization', `Bearer ${token}`);
    const locked = await request(app)
      .delete(`/api/v1/files/${upload.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(locked.status).toBe(409);
  });

  it('validates the property/customer relationship and assignee rules', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesA = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const salesB = await createUser({ email: 'b@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const tokenA = await login('a@example.com');
    const a = await createCustomer(salesA);
    const other = await createCustomer(salesA, '1 Other Way');

    const mismatch = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ customerId: a.customerId, propertyId: other.propertyId });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.details[0].path).toBe('propertyId');

    const missing = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ customerId: a.customerId, propertyId: '64b000000000000000000000' });
    expect(missing.status).toBe(400);

    const assignOther = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ customerId: a.customerId, propertyId: a.propertyId, assignedTo: salesB });
    expect(assignOther.status).toBe(403);

    const adminAssigns = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: a.customerId, propertyId: a.propertyId, assignedTo: salesB });
    expect(adminAssigns.status).toBe(201);
    expect(adminAssigns.body.data.assignedTo).toBe(salesB);

    const badStatus = await request(app)
      .patch(`/api/v1/inspections/${adminAssigns.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'completed' });
    expect(badStatus.status).toBe(400);
  });

  it('scopes salesperson access to assigned inspections or owned customers; supports cancel', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesA = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const salesB = await createUser({ email: 'b@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    const a = await createCustomer(salesA, '1 Alpha Rd');
    const b = await createCustomer(salesB, '2 Beta Rd');

    const forA = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ customerId: a.customerId, propertyId: a.propertyId });
    const forB = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ customerId: b.customerId, propertyId: b.propertyId });
    // Admin assigns an inspection on B's customer to A: A sees it via assignment, B via ownership.
    const crossAssigned = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: b.customerId, propertyId: b.propertyId, assignedTo: salesA });
    expect(crossAssigned.status).toBe(201);

    // A cannot create for B's customer.
    const foreignCustomer = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ customerId: b.customerId, propertyId: b.propertyId });
    expect(foreignCustomer.status).toBe(400);

    const listA = await request(app)
      .get('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.data.map((i: { id: string }) => i.id).sort()).toEqual(
      [forA.body.data.id, crossAssigned.body.data.id].sort(),
    );
    const listB = await request(app)
      .get('/api/v1/inspections')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.data.map((i: { id: string }) => i.id).sort()).toEqual(
      [forB.body.data.id, crossAssigned.body.data.id].sort(),
    );
    const listAdmin = await request(app)
      .get('/api/v1/inspections?status=draft')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAdmin.body.data).toHaveLength(3);
    expect(listAdmin.body.meta.total).toBe(3);

    const crossGet = await request(app)
      .get(`/api/v1/inspections/${forB.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossGet.status).toBe(404);
    const crossReport = await request(app)
      .get(`/api/v1/inspections/${forB.body.data.id}/report`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossReport.status).toBe(404);
    const crossComplete = await request(app)
      .post(`/api/v1/inspections/${forB.body.data.id}/complete`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossComplete.status).toBe(404);
    const crossPatch = await request(app)
      .patch(`/api/v1/inspections/${forB.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ notes: 'x' });
    expect(crossPatch.status).toBe(404);

    const cancelled = await request(app)
      .post(`/api/v1/inspections/${forA.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    const cancelAgain = await request(app)
      .post(`/api/v1/inspections/${forA.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(cancelAgain.status).toBe(409);
    const editCancelled = await request(app)
      .patch(`/api/v1/inspections/${forA.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'in_progress' });
    expect(editCancelled.status).toBe(409);
    const completeCancelled = await request(app)
      .post(`/api/v1/inspections/${forA.body.data.id}/complete`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(completeCancelled.status).toBe(409);

    const noAuth = await request(app).get('/api/v1/inspections');
    expect(noAuth.status).toBe(401);
  });
});
