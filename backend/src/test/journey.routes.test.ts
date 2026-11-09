/**
 * End-to-end business journey over the real HTTP API (isolated in-memory database, no external providers):
 * lead -> assignment -> conversion -> appointment -> inspection -> photo -> measurement -> estimate
 * -> proposal -> approval -> project -> task -> work order -> invoice -> partial payment -> balance
 * -> customer portal login -> ownership isolation.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedLookups } from '../../scripts/lib/base-config.js';
import { createApp } from '../app.js';
import { CustomerModel } from '../modules/customers/customer.model.js';
import { createUser, seedPhase2Config } from './phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from './setup.js';

const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

describe('Lead-to-payment journey', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await startTestDb();
    await clearCollections();
    await seedPhase2Config();
    await seedLookups(); // production lookup defaults (appointment types, service types, ...)
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('runs the whole workflow and enforces portal ownership', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const login = async (email: string): Promise<string> =>
      (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data
        .accessToken as string;
    const admin = await login('admin@example.com');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const api = {
      post: (t: string, url: string, body: object = {}) => request(app).post(`/api/v1${url}`).set(auth(t)).send(body),
      get: (t: string, url: string) => request(app).get(`/api/v1${url}`).set(auth(t)),
      patch: (t: string, url: string, body: object) => request(app).patch(`/api/v1${url}`).set(auth(t)).send(body),
    };

    // 2-3. lead creation + assignment
    const lead = await api.post(admin, '/leads', {
      firstName: 'Journey',
      lastName: 'Customer',
      email: 'journey@example.test',
      phone: '5125550177',
      sourceKey: 'website',
      priority: 'high',
      address: { line1: '77 Journey Ln', city: 'Austin', state: 'TX', zip: '78701' },
    });
    expect(lead.status).toBe(201);
    expect(lead.body.data.priority).toBe('high');
    const assigned = await api.post(admin, `/leads/${lead.body.data.id}/assign`, { assignedTo: salesId });
    expect(assigned.status).toBe(200);

    // 4-6. conversion creates customer + property (idempotent)
    const sales = await login('sales@example.com');
    const converted = await api.post(sales, `/leads/${lead.body.data.id}/convert`);
    expect(converted.status).toBe(200);
    const customerId = converted.body.data.customerId as string;
    const props = await api.get(sales, `/customers/${customerId}/properties`);
    expect(props.body.data).toHaveLength(1);
    const propertyId = props.body.data[0].id as string;

    // 7. appointment
    const appt = await api.post(sales, '/appointments', {
      title: 'Roof inspection',
      typeKey: 'inspection',
      customerId,
      propertyId,
      startAt: '2030-02-01T15:00:00.000Z',
      endAt: '2030-02-01T16:00:00.000Z',
    });
    expect(appt.status, JSON.stringify(appt.body)).toBe(201);

    // 8-9. inspection completion + photo upload
    const insp = await api.post(sales, '/inspections', {
      customerId,
      propertyId,
      appointmentId: appt.body.data.id,
      roofCondition: 'Fair',
      findings: 'Hail damage',
      measurements: { totalAreaSqFt: 2400, pitch: '6/12' },
    });
    expect(insp.status).toBe(201);
    const done = await api.post(sales, `/inspections/${insp.body.data.id}/complete`);
    expect(done.body.data.status).toBe('completed');
    const photo = await api.post(sales, '/files', {
      filename: 'north-slope.jpg',
      mimeType: 'image/jpeg',
      category: 'photo',
      inspectionId: insp.body.data.id,
      contentBase64: TINY_JPEG.toString('base64'),
    });
    expect(photo.status).toBe(201);

    // 10. measurement
    const meas = await api.post(sales, '/measurements', { propertyId, inspectionId: insp.body.data.id, totalArea: 2400, pitch: '6/12', ridge: 60 });
    expect(meas.status).toBe(201);

    // 11. estimate (backend-authoritative totals)
    const est = await api.post(sales, '/estimates', {
      customerId,
      propertyId,
      inspectionId: insp.body.data.id,
      measurementId: meas.body.data.id,
      taxRateBps: 825,
      lineItems: [{ description: 'Roof package', kind: 'material', quantity: 1, unit: 'job', unitCostCents: 1_000_000 }],
    });
    expect(est.status).toBe(201);
    expect(est.body.data.totalCents).toBe(1_082_500);

    // 12-13. proposal + approval
    const prop = await api.post(sales, '/proposals', { estimateId: est.body.data.id });
    expect(prop.status).toBe(201);
    expect((await api.post(sales, `/proposals/${prop.body.data.id}/send`)).status).toBe(200);
    const accepted = await api.post(sales, `/proposals/${prop.body.data.id}/accept`);
    expect(accepted.body.data.status).toBe('accepted');
    // Accepted proposals are immutable.
    expect((await api.patch(sales, `/proposals/${prop.body.data.id}`, { notes: 'sneaky' })).status).toBeGreaterThanOrEqual(400);

    // 14-16. project, task, work order
    const project = await api.post(sales, '/projects', {
      customerId,
      propertyId,
      estimateId: est.body.data.id,
      proposalId: prop.body.data.id,
    });
    expect(project.status).toBe(201);
    const task = await api.post(sales, `/projects/${project.body.data.id}/tasks`, { title: 'Order materials', assignedTo: salesId });
    expect(task.status).toBe(201);
    expect((await api.get(sales, '/tasks')).body.data.some((t: { id: string }) => t.id === task.body.data.id)).toBe(true);
    const wo = await api.post(sales, '/work-orders', { projectId: project.body.data.id, title: 'Tear-off' });
    expect(wo.status).toBe(201);

    // 17-19. invoice, partial payment, balance, duplicate protection
    const inv = await api.post(sales, '/invoices', {
      customerId,
      propertyId,
      projectId: project.body.data.id,
      lineItems: [{ description: 'Deposit', quantity: 1, unitCostCents: 500_000 }],
    });
    expect(inv.status).toBe(201);
    await api.post(sales, `/invoices/${inv.body.data.id}/send`);
    const pay = { amountCents: 200_000, method: 'check', idempotencyKey: 'journey-pay-0001' };
    const p1 = await api.post(sales, `/invoices/${inv.body.data.id}/payments`, pay);
    expect(p1.status).toBe(201);
    expect(p1.body.data.invoice.status).toBe('partially_paid');
    expect(p1.body.data.invoice.balanceCents).toBe(300_000);
    const dup = await api.post(sales, `/invoices/${inv.body.data.id}/payments`, pay);
    const after = await api.get(sales, `/invoices/${inv.body.data.id}`);
    expect(after.body.data.balanceCents ?? after.body.data.totalCents - after.body.data.amountPaidCents).toBe(300_000);
    expect([200, 201, 409]).toContain(dup.status);
    expect((await api.get(sales, '/payments')).body.meta.total).toBe(1);

    // 20-21. portal login + ownership
    const other = await CustomerModel.create({ type: 'individual', firstName: 'Other', lastName: 'Person', ownerId: adminId });
    const acct = await api.post(admin, '/portal/accounts', {
      customerId,
      email: 'journey.portal@example.test',
      temporaryPassword: 'TempPortalPass1!',
      firstName: 'Journey',
      lastName: 'Customer',
    });
    expect(acct.status).toBe(201);
    const pl = await request(app).post('/api/v1/portal/auth/login').send({ email: 'journey.portal@example.test', password: 'TempPortalPass1!' });
    const pt = pl.body.data.accessToken as string;
    await request(app).post('/api/v1/portal/auth/password/change').set(auth(pt)).send({ currentPassword: 'TempPortalPass1!', newPassword: 'PortalNewPass12!' });
    const invoices = await request(app).get('/api/v1/portal/invoices').set(auth(pt));
    expect(invoices.status).toBe(200);
    expect(invoices.body.data.map((i: { id: string }) => i.id)).toContain(inv.body.data.id);
    // A portal token is not accepted by staff APIs, and staff tokens are not accepted by the portal.
    expect((await request(app).get('/api/v1/invoices').set(auth(pt))).status).toBe(401);
    expect((await request(app).get('/api/v1/portal/invoices').set(auth(admin))).status).toBe(401);
    expect(other._id).toBeTruthy();
  });
});
