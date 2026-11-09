import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { CustomerModel } from '../customers/customer.model.js';

describe('Communications routes', () => {
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

  it('creates internal note and email with honest not_configured status', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const customer = await CustomerModel.create({
      type: 'individual',
      firstName: 'Pat',
      lastName: 'Customer',
      email: 'pat@example.com',
      ownerId: adminId,
      createdBy: adminId,
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Password12345!' });
    const token = login.body.data.accessToken as string;

    const note = await request(app)
      .post('/api/v1/communications/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: customer._id.toString(),
        body: 'Private staff note',
        subject: 'Internal',
      });
    expect(note.status).toBe(201);
    expect(note.body.data.channel).toBe('internal_note');
    expect(note.body.data.customerVisible).toBe(false);
    expect(note.body.data.deliveryStatus).toBe('received');
    expect(note.body.data.provider).toBe('none');

    const email = await request(app)
      .post('/api/v1/communications/email')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: customer._id.toString(),
        recipient: 'pat@example.com',
        subject: 'Hello',
        body: 'Checking in',
      });
    expect(email.status).toBe(201);
    expect(email.body.data.channel).toBe('email');
    expect(email.body.data.deliveryStatus).toBe('not_configured');
    expect(email.body.data.provider).toBe('none');
    expect(email.body.data.customerVisible).toBe(true);
    expect(['sent', 'delivered', 'queued']).not.toContain(email.body.data.deliveryStatus);

    const list = await request(app)
      .get(`/api/v1/communications?customerId=${customer._id.toString()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
  });
});
