import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createPasswordHash } from '../auth/auth.service.js';
import { UserModel } from './user.model.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';

describe('Users routes', () => {
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

  async function adminToken(): Promise<string> {
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
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Password12345!' });
    return login.body.data.accessToken as string;
  }

  it('creates a salesperson with mustChangePassword', async () => {
    const token = await adminToken();
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'sales@example.com',
        firstName: 'Sam',
        lastName: 'Sales',
        role: 'salesperson',
        temporaryPassword: 'TempPassword12!',
        receivesLeads: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('salesperson');
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect(res.body.data.emailDeliveryEnabled).toBe(false);
    expect(res.body.data.inviteToken).toBeTypeOf('string');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });
});
