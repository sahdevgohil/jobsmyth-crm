import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';

describe('Proposals routes', () => {
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

  async function seedEstimate(token: string, ownerId: string) {
    const customer = await CustomerModel.create({
      type: 'individual',
      firstName: 'Pat',
      lastName: 'Owner',
      email: 'pat@example.com',
      ownerId,
    });
    const property = await PropertyModel.create({
      customerId: customer._id,
      address: { line1: '100 Main', city: 'Austin', state: 'TX', zip: '78701' },
    });
    const estimate = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: customer._id.toString(),
        propertyId: property._id.toString(),
        lineItems: [
          {
            description: 'Roof package',
            kind: 'material',
            quantity: 1,
            unit: 'job',
            unitCostCents: 100000,
          },
        ],
        discountCents: 0,
        taxRateBps: 0,
      });
    expect(estimate.status).toBe(201);
    return estimate.body.data as { id: string; totalCents: number; number: string };
  }

  it('creates proposal from estimate with locked snapshot totals', async () => {
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const token = await login('sales@example.com');
    const estimate = await seedEstimate(token, salesId);

    const created = await request(app)
      .post('/api/v1/proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        estimateId: estimate.id,
        termsAndConditions: 'Net 30',
        paymentSchedule: [{ label: 'Deposit', percentBps: 5000 }],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.number).toMatch(/^PROP-\d{4}-0001$/);
    expect(created.body.data.totalCents).toBe(estimate.totalCents);
    expect(created.body.data.status).toBe('draft');
    expect(created.body.data.paymentSchedule[0].percentBps).toBe(5000);

    const sent = await request(app)
      .post(`/api/v1/proposals/${created.body.data.id}/send`)
      .set('Authorization', `Bearer ${token}`);
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe('sent');
    expect(sent.body.meta.emailDelivery).toBe('not_configured');

    const locked = await request(app)
      .patch(`/api/v1/proposals/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'should fail' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('PROPOSAL_LOCKED');
  });

  it('signature request returns not_configured without faking a signed document', async () => {
    const salesId = await createUser({ email: 'sales2@example.com', role: 'salesperson' });
    const token = await login('sales2@example.com');
    const estimate = await seedEstimate(token, salesId);
    const created = await request(app)
      .post('/api/v1/proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({ estimateId: estimate.id });
    expect(created.status).toBe(201);

    const sig = await request(app)
      .post(`/api/v1/proposals/${created.body.data.id}/signature-request`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientEmail: 'customer@example.com' });
    expect(sig.status).toBe(200);
    expect(sig.body.data.signature.status).toBe('not_configured');
    expect(sig.body.data.signature.provider).toBe('none');
    expect(sig.body.data.signature.signedAt).toBeNull();

    const providers = await request(app)
      .get('/api/v1/proposals/signature-providers')
      .set('Authorization', `Bearer ${token}`);
    expect(providers.status).toBe(200);
    expect(providers.body.data.providers.every((p: { status: string }) => p.status === 'not_configured')).toBe(
      true,
    );
  });

  it('accept and reject update status; preview returns HTML', async () => {
    const salesId = await createUser({ email: 'sales3@example.com', role: 'salesperson' });
    const token = await login('sales3@example.com');
    const estimate = await seedEstimate(token, salesId);
    const created = await request(app)
      .post('/api/v1/proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({ estimateId: estimate.id });

    await request(app)
      .post(`/api/v1/proposals/${created.body.data.id}/send`)
      .set('Authorization', `Bearer ${token}`);

    const accepted = await request(app)
      .post(`/api/v1/proposals/${created.body.data.id}/accept`)
      .set('Authorization', `Bearer ${token}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('accepted');

    const dup = await request(app)
      .post(`/api/v1/proposals/${created.body.data.id}/duplicate`)
      .set('Authorization', `Bearer ${token}`);
    expect(dup.status).toBe(201);
    expect(dup.body.data.status).toBe('draft');
    expect(dup.body.data.version).toBe(2);

    const preview = await request(app)
      .get(`/api/v1/proposals/${dup.body.data.id}/preview`)
      .set('Authorization', `Bearer ${token}`);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain(dup.body.data.number);
    expect(preview.text).toContain('100 Main');
  });
});
