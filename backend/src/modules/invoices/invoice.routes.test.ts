import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';

describe('Invoices and payments', () => {
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

  it('creates invoice with backend totals, partial payment, and honest QBO/email status', async () => {
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const token = await login('sales@example.com');
    const customer = await CustomerModel.create({
      type: 'individual',
      firstName: 'Ann',
      lastName: 'Buyer',
      email: 'ann@example.com',
      ownerId: salesId,
    });
    const property = await PropertyModel.create({
      customerId: customer._id,
      address: { line1: '22 Cedar', city: 'Austin', state: 'TX', zip: '78703' },
    });

    const created = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: customer._id.toString(),
        propertyId: property._id.toString(),
        lineItems: [
          {
            description: 'Roofing labor',
            kind: 'labor',
            quantity: 10,
            unit: 'hr',
            unitCostCents: 7500,
          },
        ],
        discountCents: 5000,
        taxRateBps: 0,
        idempotencyKey: 'inv-create-key-001',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.subtotalCents).toBe(75000);
    expect(created.body.data.totalCents).toBe(70000);
    expect(created.body.data.status).toBe('draft');

    const replay = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: customer._id.toString(),
        propertyId: property._id.toString(),
        lineItems: [
          {
            description: 'Roofing labor',
            kind: 'labor',
            quantity: 10,
            unit: 'hr',
            unitCostCents: 7500,
          },
        ],
        discountCents: 5000,
        taxRateBps: 0,
        idempotencyKey: 'inv-create-key-001',
      });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(created.body.data.id);

    const sent = await request(app)
      .post(`/api/v1/invoices/${created.body.data.id}/send`)
      .set('Authorization', `Bearer ${token}`);
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe('sent');
    expect(sent.body.meta.emailDelivery).toBe('not_configured');
    expect(sent.body.meta.qbo).toBe('not_configured');

    const pay = await request(app)
      .post(`/api/v1/invoices/${created.body.data.id}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amountCents: 30000,
        method: 'check',
        source: 'manual',
        idempotencyKey: 'pay-key-001234',
      });
    expect(pay.status).toBe(201);
    expect(pay.body.data.invoice.status).toBe('partially_paid');
    expect(pay.body.data.invoice.balanceCents).toBe(40000);
    expect(pay.body.data.payment.source).toBe('manual');

    const over = await request(app)
      .post(`/api/v1/invoices/${created.body.data.id}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountCents: 50000, method: 'card' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('OVERPAYMENT');

    const summary = await request(app)
      .get('/api/v1/invoices/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.collectedCents).toBe(30000);
    expect(summary.body.data.qbo.status).toBe('not_configured');
  });
});
