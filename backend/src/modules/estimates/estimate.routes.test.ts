import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { CompanySettingsModel } from '../settings/company-settings.model.js';

const LINE_ITEMS = [
  {
    description: 'Architectural shingles',
    kind: 'material',
    quantity: 30,
    unit: 'sq',
    unitCostCents: 4500, // 135_000
  },
  {
    description: 'Tear-off & install labor',
    kind: 'labor',
    quantity: 8,
    unit: 'hr',
    unitCostCents: 6000, // 48_000
  },
];

describe('Estimates routes', () => {
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

  it('calculates all totals on the backend in integer cents', async () => {
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');
    const { customerId, propertyId } = await createCustomer(salesId);

    const res = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        propertyId,
        lineItems: LINE_ITEMS,
        discountCents: 3000,
        taxRateBps: 825,
        notes: 'Thanks <b>so much</b>',
      });
    expect(res.status).toBe(201);
    const estimate = res.body.data;
    expect(estimate.number).toMatch(/^EST-\d{4}-0001$/);
    expect(estimate.status).toBe('draft');
    expect(estimate.version).toBe(1);
    expect(estimate.lineItems.map((l: { amountCents: number }) => l.amountCents)).toEqual([
      135_000, 48_000,
    ]);
    expect(estimate.lineItems[0].id).toEqual(expect.any(String));
    expect(estimate.lineItems[0].laborCostCents).toBe(0);
    expect(estimate.subtotalCents).toBe(183_000);
    expect(estimate.discountCents).toBe(3000);
    expect(estimate.taxRateBps).toBe(825);
    expect(estimate.taxCents).toBe(14_850); // (183_000 - 3_000) * 8.25%
    expect(estimate.totalCents).toBe(194_850);
    expect(Number.isInteger(estimate.totalCents)).toBe(true);

    // Editing recalculates from scratch.
    const patched = await request(app)
      .patch(`/api/v1/estimates/${estimate.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ discountCents: 0, taxRateBps: 0, lineItems: [LINE_ITEMS[0]] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.subtotalCents).toBe(135_000);
    expect(patched.body.data.taxCents).toBe(0);
    expect(patched.body.data.totalCents).toBe(135_000);

    const second = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, propertyId });
    expect(second.status).toBe(201);
    expect(second.body.data.number).toMatch(/^EST-\d{4}-0002$/);
    expect(second.body.data.totalCents).toBe(0);
  });

  it('rejects client-supplied totals that disagree with the backend calculation', async () => {
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');
    const { customerId, propertyId } = await createCustomer(salesId);

    const wrongTotal = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        propertyId,
        lineItems: LINE_ITEMS,
        discountCents: 3000,
        taxRateBps: 825,
        totalCents: 1,
      });
    expect(wrongTotal.status).toBe(422);
    expect(wrongTotal.body.error.code).toBe('TOTAL_MISMATCH');
    expect(wrongTotal.body.error.details[0].path).toBe('totalCents');

    const wrongLine = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        propertyId,
        lineItems: [{ ...LINE_ITEMS[0], amountCents: 5 }],
      });
    expect(wrongLine.status).toBe(422);
    expect(wrongLine.body.error.details[0].path).toBe('lineItems.0.amountCents');

    // Nothing was persisted by the rejected requests.
    const list = await request(app)
      .get('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);

    // Matching client figures are accepted.
    const matching = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        propertyId,
        lineItems: LINE_ITEMS,
        discountCents: 3000,
        taxRateBps: 825,
        subtotalCents: 183_000,
        taxCents: 14_850,
        totalCents: 194_850,
      });
    expect(matching.status).toBe(201);

    // A mismatch on update is rejected too, and leaves the estimate untouched.
    const badUpdate = await request(app)
      .patch(`/api/v1/estimates/${matching.body.data.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ discountCents: 0, totalCents: 194_850 });
    expect(badUpdate.status).toBe(422);
    const after = await request(app)
      .get(`/api/v1/estimates/${matching.body.data.id as string}`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.data.totalCents).toBe(194_850);

    const overDiscount = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, propertyId, lineItems: LINE_ITEMS, discountCents: 999_999 });
    expect(overDiscount.status).toBe(422);
    expect(overDiscount.body.error.code).toBe('INVALID_DISCOUNT');

    const floatCents = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, propertyId, lineItems: [{ ...LINE_ITEMS[0], unitCostCents: 10.5 }] });
    expect(floatCents.status).toBe(400);
  });

  it('copies the tax rate from pricing settings at create time and lets it be edited', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const token = await login('a@example.com');
    const { customerId, propertyId } = await createCustomer(salesId);

    const before = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, propertyId });
    expect(before.body.data.taxRateBps).toBe(0);

    await request(app)
      .patch('/api/v1/settings/pricing')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        taxRateBps: 500,
        standardLineItems: [
          { key: 'shingle_sq', label: 'Shingles', unit: 'sq', unitCostCents: 4500, kind: 'material', active: true },
          { key: 'old_item', label: 'Old', unit: 'ea', unitCostCents: 1, kind: 'other', active: false },
        ],
      })
      .expect(200);

    const catalog = await request(app)
      .get('/api/v1/estimates/catalog')
      .set('Authorization', `Bearer ${token}`);
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.taxRateBps).toBe(500);
    expect(catalog.body.data.standardLineItems.map((i: { key: string }) => i.key)).toEqual([
      'shingle_sq',
    ]);

    const created = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, propertyId, lineItems: [LINE_ITEMS[0]] });
    expect(created.body.data.taxRateBps).toBe(500);
    expect(created.body.data.taxCents).toBe(6750);
    expect(created.body.data.totalCents).toBe(141_750);

    // The estimate keeps its copied rate when settings later change.
    await request(app)
      .patch('/api/v1/settings/pricing')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ taxRateBps: 900 })
      .expect(200);
    const reread = await request(app)
      .get(`/api/v1/estimates/${created.body.data.id as string}`)
      .set('Authorization', `Bearer ${token}`);
    expect(reread.body.data.taxRateBps).toBe(500);

    const edited = await request(app)
      .patch(`/api/v1/estimates/${created.body.data.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ taxRateBps: 825 });
    expect(edited.body.data.taxCents).toBe(11_138); // 135_000 * 8.25% = 11_137.5 -> 11_138
    expect(edited.body.data.totalCents).toBe(146_138);
  });

  it('locks non-draft estimates, duplicates as copy/version, and voids', async () => {
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');
    const { customerId, propertyId } = await createCustomer(salesId);

    const created = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, propertyId, lineItems: LINE_ITEMS, discountCents: 3000, taxRateBps: 825 });
    const id = created.body.data.id as string;

    const sent = await request(app)
      .patch(`/api/v1/estimates/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'sent' });
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe('sent');

    const locked = await request(app)
      .patch(`/api/v1/estimates/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'nope' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('ESTIMATE_LOCKED');

    const version = await request(app)
      .post(`/api/v1/estimates/${id}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'version' });
    expect(version.status).toBe(201);
    expect(version.body.data).toMatchObject({
      status: 'draft',
      version: 2,
      parentEstimateId: id,
      subtotalCents: 183_000,
      taxCents: 14_850,
      totalCents: 194_850,
    });
    expect(version.body.data.number).not.toBe(created.body.data.number);

    const copy = await request(app)
      .post(`/api/v1/estimates/${id}/duplicate`)
      .set('Authorization', `Bearer ${token}`);
    expect(copy.status).toBe(201);
    expect(copy.body.data.version).toBe(1);
    expect(copy.body.data.parentEstimateId).toBe(id);
    expect(copy.body.data.lineItems[0].id).not.toBe(created.body.data.lineItems[0].id);

    const voided = await request(app)
      .post(`/api/v1/estimates/${id}/void`)
      .set('Authorization', `Bearer ${token}`);
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe('void');
    const again = await request(app)
      .post(`/api/v1/estimates/${id}/void`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(409);
  });

  it('renders an escaped printable HTML preview with backend totals', async () => {
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');
    const { customerId, propertyId } = await createCustomer(salesId);

    const created = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        propertyId,
        lineItems: LINE_ITEMS,
        discountCents: 3000,
        taxRateBps: 825,
        notes: 'Thanks <b>so much</b>',
      });
    const preview = await request(app)
      .get(`/api/v1/estimates/${created.body.data.id as string}/preview`)
      .set('Authorization', `Bearer ${token}`);
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toContain('text/html');
    expect(preview.text).toContain('Legacy Test Roofing');
    expect(preview.text).toContain(created.body.data.number);
    expect(preview.text).toContain('742 Evergreen Terrace');
    expect(preview.text).toContain('Homer Simpson');
    expect(preview.text).toContain('$1,830.00');
    expect(preview.text).toContain('$1,948.50');
    expect(preview.text).toContain('8.25%');
    expect(preview.text).toContain('Thanks &lt;b&gt;so much&lt;/b&gt;');
    expect(preview.text).not.toContain('<b>so much</b>');
  });

  it('scopes salesperson access, validates links, and requires auth', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesA = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const salesB = await createUser({ email: 'b@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    const a = await createCustomer(salesA, '1 Alpha Rd');
    const b = await createCustomer(salesB, '2 Beta Rd');

    const forA = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...a, lineItems: [LINE_ITEMS[0]] });
    const forB = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ ...b, lineItems: [LINE_ITEMS[0]] });
    expect(forA.status).toBe(201);
    expect(forB.status).toBe(201);

    const foreign = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(b);
    expect(foreign.status).toBe(400);

    const mismatch = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ customerId: a.customerId, propertyId: b.propertyId });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.details[0].path).toBe('propertyId');

    // A measurement on another property cannot be linked.
    const bMeasurement = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ propertyId: b.propertyId, totalArea: 100 });
    const badLink = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...a, measurementId: bMeasurement.body.data.id });
    expect(badLink.status).toBe(400);
    expect(badLink.body.error.details[0].path).toBe('measurementId');

    const aMeasurement = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ propertyId: a.propertyId, totalArea: 100 });
    const linked = await request(app)
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...a, measurementId: aMeasurement.body.data.id });
    expect(linked.status).toBe(201);
    expect(linked.body.data.measurementId).toBe(aMeasurement.body.data.id);

    const listA = await request(app)
      .get('/api/v1/estimates')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.data.map((e: { id: string }) => e.id).sort()).toEqual(
      [forA.body.data.id, linked.body.data.id].sort(),
    );
    const listAdmin = await request(app)
      .get('/api/v1/estimates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAdmin.body.meta.total).toBe(3);

    for (const [method, path] of [
      ['get', `/api/v1/estimates/${forB.body.data.id as string}`],
      ['get', `/api/v1/estimates/${forB.body.data.id as string}/preview`],
      ['patch', `/api/v1/estimates/${forB.body.data.id as string}`],
      ['post', `/api/v1/estimates/${forB.body.data.id as string}/duplicate`],
      ['post', `/api/v1/estimates/${forB.body.data.id as string}/void`],
    ] as const) {
      const res = await request(app)[method](path)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(method === 'patch' ? { notes: 'x' } : {});
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    expect((await request(app).get('/api/v1/estimates')).status).toBe(401);
  });
});
