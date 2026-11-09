import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createPasswordHash } from './auth.service.js';
import { UserModel } from '../users/user.model.js';
import { asCookieArray } from '../../test/cookies.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { hashToken } from '../../utils/crypto.js';
import { RefreshSessionModel } from './refresh-session.model.js';

const agentOrigin = 'http://localhost:5173';

describe('AUTH routes', () => {
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

  async function createUser(overrides: {
    email?: string;
    role?: 'admin' | 'salesperson';
    isActive?: boolean;
    password?: string;
    mustChangePassword?: boolean;
  } = {}) {
    const password = overrides.password ?? 'Password12345!';
    const user = await UserModel.create({
      email: overrides.email ?? 'admin@example.com',
      firstName: 'Ada',
      lastName: 'Admin',
      role: overrides.role ?? 'admin',
      isActive: overrides.isActive ?? true,
      receivesLeads: false,
      mustChangePassword: overrides.mustChangePassword ?? false,
      passwordHash: await createPasswordHash(password),
    });
    return { user, password };
  }

  it('logs in successfully and returns access token without passwordHash', async () => {
    const { password } = await createUser();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user.email).toBe('admin@example.com');
    expect(res.body.data.user.permissions).toContain('users:manage');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects invalid credentials', async () => {
    await createUser();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password!!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects deactivated users on login', async () => {
    const { password } = await createUser({ isActive: false });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and detects reuse (AC-AUTH-3)', async () => {
    const { password } = await createUser();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });
    const firstCookie = asCookieArray(login.headers['set-cookie']);
    expect(firstCookie[0]).toBeTruthy();

    const refresh1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', agentOrigin)
      .set('Cookie', firstCookie);
    expect(refresh1.status).toBe(200);
    expect(refresh1.body.data.accessToken).toBeTypeOf('string');
    const secondCookie = asCookieArray(refresh1.headers['set-cookie']);

    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', agentOrigin)
      .set('Cookie', firstCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');

    const afterReuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', agentOrigin)
      .set('Cookie', secondCookie);
    expect(afterReuse.status).toBe(401);
  });

  it('revokes sessions when user is deactivated so refresh fails (AC-AUTH-1)', async () => {
    const { user, password } = await createUser({
      email: 'sales@example.com',
      role: 'salesperson',
    });
    const admin = await createUser({ email: 'boss@example.com', role: 'admin' });

    const salesLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sales@example.com', password });
    const salesCookie = asCookieArray(salesLogin.headers['set-cookie']);

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'boss@example.com', password: admin.password });

    const deactivate = await request(app)
      .post(`/api/v1/users/${user._id.toString()}/deactivate`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`);
    expect(deactivate.status).toBe(200);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', agentOrigin)
      .set('Cookie', salesCookie);
    expect(refresh.status).toBe(401);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sales@example.com', password });
    expect(relogin.status).toBe(401);
  });

  it('returns 403 when salesperson hits admin-only endpoint (AC-AUTH-2)', async () => {
    const { password } = await createUser({
      email: 'sales@example.com',
      role: 'salesperson',
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sales@example.com', password });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rate limits login after 10 attempts (AC-AUTH-5)', async () => {
    await createUser();
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.50')
        .send({ email: 'admin@example.com', password: 'definitely-wrong!!' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('changes password and revokes other sessions', async () => {
    const { password } = await createUser();
    const login1 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });
    const login2 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });
    const cookie2 = asCookieArray(login2.headers['set-cookie']);

    const change = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${login1.body.data.accessToken}`)
      .set('Cookie', asCookieArray(login1.headers['set-cookie']))
      .send({ currentPassword: password, newPassword: 'NewPassword12345!' });
    expect(change.status).toBe(204);

    const refreshOther = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', agentOrigin)
      .set('Cookie', cookie2);
    expect(refreshOther.status).toBe(401);
  });

  it('stores refresh token hashed', async () => {
    const { password } = await createUser();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });
    const cookieHeader = asCookieArray(login.headers['set-cookie'])[0] ?? '';
    const match = /refreshToken=([^;]+)/.exec(cookieHeader);
    expect(match?.[1]).toBeTruthy();
    const raw = match?.[1] ?? '';
    const session = await RefreshSessionModel.findOne({ tokenHash: hashToken(raw) });
    expect(session).toBeTruthy();
    expect(session?.tokenHash).not.toBe(raw);
  });

  it('forgot password never reveals whether email exists and disables email delivery', async () => {
    const missing = await request(app)
      .post('/api/v1/auth/password/forgot')
      .set('X-Forwarded-For', '203.0.113.60')
      .send({ email: 'nobody@example.com' });
    expect(missing.status).toBe(200);
    expect(missing.body.data.emailDeliveryEnabled).toBe(false);

    await createUser({ email: 'exists@example.com' });
    const exists = await request(app)
      .post('/api/v1/auth/password/forgot')
      .set('X-Forwarded-For', '203.0.113.61')
      .send({ email: 'exists@example.com' });
    expect(exists.status).toBe(200);
    expect(exists.body.data.emailDeliveryEnabled).toBe(false);
    expect(exists.body.data.message).toBe(missing.body.data.message);
  });

  it('stores Argon2id password hashes (AC-AUTH-4)', async () => {
    const { user } = await createUser({ email: 'hash@example.com' });
    const stored = await UserModel.findById(user._id).lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('handles concurrent refresh without forking multiple active sessions (V-01)', async () => {
    const { password } = await createUser({ email: 'race@example.com' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'race@example.com', password });
    const cookie = asCookieArray(login.headers['set-cookie']);

    const [a, b] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').set('Origin', agentOrigin).set('Cookie', cookie),
      request(app).post('/api/v1/auth/refresh').set('Origin', agentOrigin).set('Cookie', cookie),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(401);

    const familyId = (await RefreshSessionModel.findOne({}).lean())?.familyId;
    expect(familyId).toBeTruthy();
    const active = await RefreshSessionModel.countDocuments({
      familyId,
      revokedAt: { $exists: false },
    });
    expect(active).toBeLessThanOrEqual(1);
  });

  it('blocks APIs until password is changed (V-02 / AUTH-007)', async () => {
    const { password, user } = await createUser({
      email: 'temp@example.com',
      mustChangePassword: true,
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'temp@example.com', password });
    const token = login.body.data.accessToken as string;
    expect(login.body.data.user.mustChangePassword).toBe(true);

    const blocked = await request(app)
      .get('/api/v1/settings/company')
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);

    const wrongCurrent = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPassword1!', newPassword: 'ChangedPass123!' });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.error.code).toBe('INVALID_PASSWORD');

    const tooShort = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'short' });
    expect(tooShort.status).toBe(400);

    const change = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'ChangedPass123!' });
    expect(change.status).toBe(204);

    const { UserModel } = await import('../users/user.model.js');
    const stored = await UserModel.findById(user._id);
    expect(stored?.mustChangePassword).toBe(false);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);

    const meAfter = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.data.mustChangePassword).toBe(false);

    const allowed = await request(app)
      .get('/api/v1/settings/company')
      .set('Authorization', `Bearer ${token}`);
    expect(allowed.status).toBe(200);
  });

  it('rate limits forgot-password including successful 200 responses (V-03)', async () => {
    await createUser({ email: 'forgot@example.com' });
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/password/forgot')
        .set('X-Forwarded-For', '203.0.113.70')
        .send({ email: 'forgot@example.com' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('acceptInvite revokes existing refresh sessions (V-04)', async () => {
    const tempPassword = 'TempPassword12!';
    const { user } = await createUser({
      email: 'invitee@example.com',
      password: tempPassword,
      mustChangePassword: true,
    });
    const { createInviteToken } = await import('./auth.service.js');
    const inviteToken = await createInviteToken(user._id);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'invitee@example.com', password: tempPassword });
    const cookie = asCookieArray(login.headers['set-cookie']);
    expect(login.status).toBe(200);

    const accept = await request(app)
      .post('/api/v1/auth/invites/accept')
      .set('X-Forwarded-For', '203.0.113.80')
      .send({ token: inviteToken, newPassword: 'InviteAccepted12!' });
    expect(accept.status).toBe(204);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', agentOrigin)
      .set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('logout revokes the refresh session (AUTH-001)', async () => {
    const { password } = await createUser({ email: 'logout@example.com' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'logout@example.com', password });
    const cookie = asCookieArray(login.headers['set-cookie']);

    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', agentOrigin)
      .set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('GET /auth/me returns user and permissions (AUTH-013)', async () => {
    const { password } = await createUser({ email: 'me@example.com' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.90')
      .send({ email: 'me@example.com', password });
    expect(login.status).toBe(200);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('me@example.com');
    expect(me.body.data.permissions).toEqual(expect.arrayContaining(['users:manage']));
  });
});
