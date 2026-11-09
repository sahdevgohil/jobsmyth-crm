import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';

describe('Measurements routes', () => {
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

  it('creates a manual measurement with honest provider defaults', async () => {
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');
    const { customerId, propertyId } = await createCustomer(salesId);

    const res = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${token}`)
      .send({ propertyId, totalArea: 2450.5, facets: 8, pitch: '6/12', ridge: 60, eave: 180 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      propertyId,
      customerId,
      inspectionId: null,
      source: 'manual',
      provider: 'none',
      providerStatus: 'manual_only',
      units: 'sq_ft',
      totalArea: 2450.5,
      facets: 8,
      pitch: '6/12',
      ridge: 60,
      eave: 180,
      hip: null,
      importedFilename: null,
      createdBy: salesId,
    });

    const get = await request(app)
      .get(`/api/v1/measurements/${res.body.data.id as string}`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);

    const patched = await request(app)
      .patch(`/api/v1/measurements/${res.body.data.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valley: 24, notes: 'Re-measured' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.valley).toBe(24);
    expect(patched.body.data.totalArea).toBe(2450.5);
  });

  it('never lets a client claim a connected provider', async () => {
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');
    const { propertyId } = await createCustomer(salesId);

    const res = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${token}`)
      .send({ propertyId, provider: 'roofr', providerStatus: 'connected' });
    expect(res.status).toBe(400);

    const ok = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${token}`)
      .send({ propertyId, provider: 'roofr' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.provider).toBe('roofr');
    expect(ok.body.data.providerStatus).toBe('manual_only');
  });

  it('imports manually entered data from a file with source=import', async () => {
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');
    const { propertyId } = await createCustomer(salesId);

    const missingName = await request(app)
      .post('/api/v1/measurements/import')
      .set('Authorization', `Bearer ${token}`)
      .send({ propertyId, totalArea: 100 });
    expect(missingName.status).toBe(400);

    const res = await request(app)
      .post('/api/v1/measurements/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        propertyId,
        provider: 'roofr',
        importedFilename: 'roofr-report-742.pdf',
        totalArea: 3100,
        units: 'sq_ft',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe('import');
    expect(res.body.data.importedFilename).toBe('roofr-report-742.pdf');
    expect(res.body.data.providerStatus).toBe('manual_only');
  });

  it('scopes salesperson access to owned customers or assigned inspections', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesA = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const salesB = await createUser({ email: 'b@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    const a = await createCustomer(salesA, '1 Alpha Rd');
    const b = await createCustomer(salesB, '2 Beta Rd');

    const forA = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ propertyId: a.propertyId, totalArea: 1000 });
    const forB = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ propertyId: b.propertyId, totalArea: 2000 });
    expect(forA.status).toBe(201);
    expect(forB.status).toBe(201);

    // A cannot create against B's property.
    const foreign = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ propertyId: b.propertyId, totalArea: 1 });
    expect(foreign.status).toBe(400);

    // Admin creates a measurement on B's property linked to an inspection assigned to A.
    const inspection = await request(app)
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: b.customerId, propertyId: b.propertyId, assignedTo: salesA });
    expect(inspection.status).toBe(201);
    const linked = await request(app)
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        propertyId: b.propertyId,
        inspectionId: inspection.body.data.id,
        totalArea: 3000,
      });
    expect(linked.status).toBe(201);
    expect(linked.body.data.customerId).toBe(b.customerId);

    const listA = await request(app)
      .get('/api/v1/measurements')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.data.map((m: { id: string }) => m.id).sort()).toEqual(
      [forA.body.data.id, linked.body.data.id].sort(),
    );
    const listB = await request(app)
      .get('/api/v1/measurements')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.data.map((m: { id: string }) => m.id).sort()).toEqual(
      [forB.body.data.id, linked.body.data.id].sort(),
    );
    const listAdmin = await request(app)
      .get('/api/v1/measurements')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAdmin.body.meta.total).toBe(3);

    const crossGet = await request(app)
      .get(`/api/v1/measurements/${forB.body.data.id as string}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossGet.status).toBe(404);
    const crossPatch = await request(app)
      .patch(`/api/v1/measurements/${forB.body.data.id as string}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ notes: 'x' });
    expect(crossPatch.status).toBe(404);

    expect((await request(app).get('/api/v1/measurements')).status).toBe(401);
  });

  it('reports every provider integration as not_configured', async () => {
    await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('a@example.com');

    const res = await request(app)
      .get('/api/v1/measurements/integrations/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.providers.map((p: { id: string }) => p.id)).toEqual([
      'roofr',
      'eagleview',
      'hover',
    ]);
    for (const provider of res.body.data.providers as Array<{ status: string; message: string }>) {
      expect(provider.status).toBe('not_configured');
      expect(provider.message.length).toBeGreaterThan(0);
    }
  });
});
