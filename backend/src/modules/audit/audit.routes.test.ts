import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createPasswordHash } from '../auth/auth.service.js';
import { UserModel } from '../users/user.model.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { AuditLogModel } from './audit-log.model.js';
import { recordAudit } from '../../services/audit.js';

describe('Audit routes and immutability', () => {
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

  async function loginAs(role: 'admin' | 'salesperson', email: string) {
    await UserModel.create({
      email,
      firstName: 'Test',
      lastName: 'User',
      role,
      isActive: true,
      receivesLeads: false,
      mustChangePassword: false,
      passwordHash: await createPasswordHash('Password12345!'),
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password12345!' });
    return login.body.data.accessToken as string;
  }

  it('allows admin to list audit logs and forbids salesperson (AUD-004)', async () => {
    await recordAudit({
      actorType: 'system',
      action: 'test.event',
      entityType: 'user',
      entityId: 'seed',
    });
    const adminToken = await loginAs('admin', 'audit-admin@example.com');
    const salesToken = await loginAs('salesperson', 'audit-sales@example.com');

    const adminList = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.length).toBeGreaterThan(0);

    const salesList = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${salesToken}`);
    expect(salesList.status).toBe(403);
  });

  it('rejects update and delete on audit log model (append-only)', async () => {
    await recordAudit({
      actorType: 'system',
      action: 'test.immutable',
      entityType: 'user',
      entityId: 'x',
    });
    const row = await AuditLogModel.findOne({ action: 'test.immutable' });
    expect(row).toBeTruthy();

    await expect(AuditLogModel.updateOne({ _id: row!._id }, { $set: { action: 'hacked' } })).rejects.toThrow(
      /cannot be modified or deleted/i,
    );
    await expect(AuditLogModel.deleteOne({ _id: row!._id })).rejects.toThrow(
      /cannot be modified or deleted/i,
    );
  });
});
