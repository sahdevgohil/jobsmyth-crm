import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';

describe('Materials routes', () => {
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

  it('supports material catalogue CRUD and requirements', async () => {
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const token = await login('sales@example.com');

    const created = await request(app)
      .post('/api/v1/materials')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'GAF Timberline HDZ',
        sku: 'GAF-HDZ',
        unit: 'sq',
        costCents: 12500,
        supplier: 'ABC Supply',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.costCents).toBe(12500);

    const list = await request(app)
      .get('/api/v1/materials?search=Timberline')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const req = await request(app)
      .post('/api/v1/material-requirements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        materialId: created.body.data.id,
        quantity: 32,
        unit: 'sq',
      });
    expect(req.status).toBe(201);
    expect(req.body.data.status).toBe('needed');

    const deactivated = await request(app)
      .patch(`/api/v1/materials/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.active).toBe(false);
  });
});
