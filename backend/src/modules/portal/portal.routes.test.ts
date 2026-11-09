import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { ProposalModel } from '../proposals/proposal.model.js';

describe('Portal routes', () => {
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

  async function seedTwoCustomersWithProposals() {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const customerA = await CustomerModel.create({
      type: 'individual',
      firstName: 'Alice',
      lastName: 'A',
      email: 'alice@example.com',
      ownerId: adminId,
      createdBy: adminId,
    });
    const customerB = await CustomerModel.create({
      type: 'individual',
      firstName: 'Bob',
      lastName: 'B',
      email: 'bob@example.com',
      ownerId: adminId,
      createdBy: adminId,
    });
    const propA = await PropertyModel.create({
      customerId: customerA._id,
      address: { line1: '1 A St', city: 'Austin', state: 'TX', zip: '78701' },
      createdBy: adminId,
    });
    const propB = await PropertyModel.create({
      customerId: customerB._id,
      address: { line1: '2 B St', city: 'Austin', state: 'TX', zip: '78702' },
      createdBy: adminId,
    });

    const proposalA = await ProposalModel.create({
      number: 'PROP-A',
      customerId: customerA._id,
      propertyId: propA._id,
      estimateId: propA._id,
      status: 'sent',
      lineItems: [],
      createdBy: adminId,
    });
    const proposalB = await ProposalModel.create({
      number: 'PROP-B',
      customerId: customerB._id,
      propertyId: propB._id,
      estimateId: propB._id,
      status: 'sent',
      lineItems: [],
      createdBy: adminId,
    });

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Password12345!' });
    const adminToken = adminLogin.body.data.accessToken as string;

    const accountA = await request(app)
      .post('/api/v1/portal/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customerA._id.toString(),
        email: 'alice.portal@example.com',
        temporaryPassword: 'TempPortalPass1!',
        firstName: 'Alice',
        lastName: 'A',
      });
    expect(accountA.status).toBe(201);

    return {
      adminToken,
      customerA,
      customerB,
      proposalA,
      proposalB,
      portalEmail: 'alice.portal@example.com',
      portalPassword: 'TempPortalPass1!',
    };
  }

  it('logs in with mustChangePassword gate and scopes proposals by ownership', async () => {
    const seeded = await seedTwoCustomersWithProposals();

    const login = await request(app).post('/api/v1/portal/auth/login').send({
      email: seeded.portalEmail,
      password: seeded.portalPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.data.account.mustChangePassword).toBe(true);
    expect(login.body.data.accessToken).toBeTypeOf('string');
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');
    const portalToken = login.body.data.accessToken as string;

    const blocked = await request(app)
      .get('/api/v1/portal/proposals')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(app)
      .post('/api/v1/portal/auth/password/change')
      .set('Authorization', `Bearer ${portalToken}`)
      .send({
        currentPassword: seeded.portalPassword,
        newPassword: 'PortalNewPass12!',
      });
    expect(changed.status).toBe(204);

    const me = await request(app)
      .get('/api/v1/portal/auth/me')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(false);

    const own = await request(app)
      .get(`/api/v1/portal/proposals/${seeded.proposalA._id.toString()}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(own.status).toBe(200);
    expect(own.body.data.number).toBe('PROP-A');
    expect(own.body.data.notes).toBeUndefined();

    const other = await request(app)
      .get(`/api/v1/portal/proposals/${seeded.proposalB._id.toString()}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(other.status).toBe(404);

    const list = await request(app)
      .get('/api/v1/portal/proposals')
      .set('Authorization', `Bearer ${portalToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].number).toBe('PROP-A');
  });
});
