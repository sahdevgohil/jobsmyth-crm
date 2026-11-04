import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createPasswordHash } from '../auth/auth.service.js';
import { UserModel } from '../users/user.model.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';

describe('Settings routes', () => {
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

  async function tokens() {
    await UserModel.create({
      email: 'admin@example.com',
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'admin',
      isActive: true,
      receivesLeads: false,
      mustChangePassword: false,
      passwordHash: await createPasswordHash('Password12345!'),
    });
    await UserModel.create({
      email: 'sales@example.com',
      firstName: 'Sam',
      lastName: 'Sales',
      role: 'salesperson',
      isActive: true,
      receivesLeads: true,
      mustChangePassword: false,
      passwordHash: await createPasswordHash('Password12345!'),
    });
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Password12345!' });
    const salesLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sales@example.com', password: 'Password12345!' });
    return {
      admin: adminLogin.body.data.accessToken as string,
      sales: salesLogin.body.data.accessToken as string,
    };
  }

  it('allows admin to update company settings', async () => {
    const { admin } = await tokens();
    const res = await request(app)
      .patch('/api/v1/settings/company')
      .set('Authorization', `Bearer ${admin}`)
      .send({ displayName: 'Legacy Roofing', timezone: 'America/Chicago' });
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Legacy Roofing');
  });

  it('forbids salesperson from updating settings', async () => {
    const { sales } = await tokens();
    const res = await request(app)
      .patch('/api/v1/settings/company')
      .set('Authorization', `Bearer ${sales}`)
      .send({ displayName: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('creates and deactivates lookups without deleting', async () => {
    const { admin } = await tokens();
    const created = await request(app)
      .post('/api/v1/settings/lookups/lead_source')
      .set('Authorization', `Bearer ${admin}`)
      .send({ key: 'referral_partner', label: 'Referral partner', order: 60 });
    expect(created.status).toBe(201);

    const deactivated = await request(app)
      .patch(`/api/v1/settings/lookups/lead_source/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);

    const list = await request(app)
      .get('/api/v1/settings/lookups/lead_source')
      .set('Authorization', `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((l: { key: string }) => l.key === 'referral_partner')).toBe(true);
  });
});
