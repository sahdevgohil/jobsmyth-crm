import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { AuditLogModel } from '../audit/audit-log.model.js';

describe('Pricing settings routes', () => {
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
  });

  async function login(email: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password12345!' });
    return res.body.data.accessToken as string;
  }

  it('is admin-only and seeds an empty catalog with zero tax', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');

    const initial = await request(app)
      .get('/api/v1/settings/pricing')
      .set('Authorization', `Bearer ${admin}`);
    expect(initial.status).toBe(200);
    expect(initial.body.data.taxRateBps).toBe(0);
    expect(initial.body.data.standardLineItems).toEqual([]);

    expect(
      (await request(app).get('/api/v1/settings/pricing').set('Authorization', `Bearer ${sales}`))
        .status,
    ).toBe(403);
    const salesPatch = await request(app)
      .patch('/api/v1/settings/pricing')
      .set('Authorization', `Bearer ${sales}`)
      .send({ taxRateBps: 825 });
    expect(salesPatch.status).toBe(403);
    expect((await request(app).get('/api/v1/settings/pricing')).status).toBe(401);

    const item = {
      key: 'shingle_sq',
      label: 'Architectural shingles',
      unit: 'sq',
      unitCostCents: 4500,
      kind: 'material',
      active: true,
    };
    const patched = await request(app)
      .patch('/api/v1/settings/pricing')
      .set('Authorization', `Bearer ${admin}`)
      .send({ taxRateBps: 825, standardLineItems: [item] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.taxRateBps).toBe(825);
    expect(patched.body.data.standardLineItems).toEqual([item]);
    expect(await AuditLogModel.countDocuments({ action: 'settings.pricing_updated' })).toBe(1);

    // Partial patch leaves the catalog alone.
    const partial = await request(app)
      .patch('/api/v1/settings/pricing')
      .set('Authorization', `Bearer ${admin}`)
      .send({ taxRateBps: 0 });
    expect(partial.body.data.taxRateBps).toBe(0);
    expect(partial.body.data.standardLineItems).toHaveLength(1);

    // Validation: integer bps in range, integer cents, unique keys.
    for (const body of [
      { taxRateBps: 8.25 },
      { taxRateBps: 10001 },
      { standardLineItems: [{ ...item, unitCostCents: 12.5 }] },
      { standardLineItems: [{ ...item, key: 'Bad Key' }] },
      { standardLineItems: [item, item] },
    ]) {
      const res = await request(app)
        .patch('/api/v1/settings/pricing')
        .set('Authorization', `Bearer ${admin}`)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
