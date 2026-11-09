import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { NotificationModel } from '../notifications/notification.model.js';
import { LookupValueModel } from '../settings/lookup-value.model.js';
import { AppointmentModel } from './appointment.model.js';

describe('Appointments routes', () => {
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
    await LookupValueModel.updateOne(
      { type: 'appointment_type', key: 'inspection' },
      { $setOnInsert: { label: 'Inspection', order: 10, isActive: true } },
      { upsert: true },
    );
    await LookupValueModel.updateOne(
      { type: 'appointment_type', key: 'retired' },
      { $setOnInsert: { label: 'Retired', order: 20, isActive: false } },
      { upsert: true },
    );
  });

  async function login(email: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password12345!' });
    return res.body.data.accessToken as string;
  }

  function body(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Roof inspection',
      typeKey: 'inspection',
      startAt: '2030-01-10T15:00:00.000Z',
      endAt: '2030-01-10T16:00:00.000Z',
      ...overrides,
    };
  }

  it('admin creates appointment and salesperson list is scoped', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesA = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const salesB = await createUser({ email: 'b@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const tokenA = await login('a@example.com');
    const forA = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body({ assignedTo: salesA }));
    expect(forA.status).toBe(201);
    expect(forA.body.data.assignedTo).toBe(salesA);
    expect(forA.body.data.status).toBe('scheduled');
    expect(forA.body.data.timeZone).toBe('America/Chicago');
    expect(forA.body.data.reminder.emailStatus).toBe('not_requested');

    const forB = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body({ title: 'Other', assignedTo: salesB }));
    expect(forB.status).toBe(201);

    const listA = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listA.status).toBe(200);
    expect(listA.body.data).toHaveLength(1);
    expect(listA.body.data[0].id).toBe(forA.body.data.id);
    expect(listA.body.meta.total).toBe(1);

    const listAdmin = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAdmin.body.data).toHaveLength(2);

    const otherGet = await request(app)
      .get(`/api/v1/appointments/${forB.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(otherGet.status).toBe(404);

    const ownGet = await request(app)
      .get(`/api/v1/appointments/${forA.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(ownGet.status).toBe(200);

    // Assignee gets an in-app notification.
    expect(
      await NotificationModel.countDocuments({ userId: salesA, type: 'appointment_assigned' }),
    ).toBe(1);

    // Salesperson may not use other users' appointments via assignedTo filter to escape scope.
    const escape = await request(app)
      .get(`/api/v1/appointments?assignedTo=${salesB}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(escape.status).toBe(200);
    expect(escape.body.data).toHaveLength(0);

    // Salesperson creating assigns self by default; cannot assign to someone else.
    const own = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(body({ startAt: '2030-01-11T15:00:00.000Z', endAt: '2030-01-11T16:00:00.000Z' }));
    expect(own.status).toBe(201);
    expect(own.body.data.assignedTo).toBe(salesA);

    const forbidden = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(body({ assignedTo: salesB }));
    expect(forbidden.status).toBe(403);
  });

  it('rejects invalid time range and unknown appointment type with 400', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const token = await login('admin@example.com');

    const bad = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ startAt: '2030-01-10T16:00:00.000Z', endAt: '2030-01-10T15:00:00.000Z' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const equal = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ endAt: '2030-01-10T15:00:00.000Z' }));
    expect(equal.status).toBe(400);

    const notIso = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ startAt: 'tomorrow' }));
    expect(notIso.status).toBe(400);

    const unknownType = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ typeKey: 'nope' }));
    expect(unknownType.status).toBe(400);

    const inactiveType = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ typeKey: 'retired' }));
    expect(inactiveType.status).toBe(400);

    expect(await AppointmentModel.countDocuments()).toBe(0);
  });

  it('returns 409 SCHEDULE_CONFLICT unless force, ignores cancelled, and re-checks on reschedule', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const sales = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const token = await login('admin@example.com');

    const first = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ assignedTo: sales }));
    expect(first.status).toBe(201);

    const overlap = body({
      title: 'Overlapping',
      assignedTo: sales,
      startAt: '2030-01-10T15:30:00.000Z',
      endAt: '2030-01-10T16:30:00.000Z',
    });
    const conflict = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(overlap);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(conflict.body.error.details[0].path).toBe(first.body.data.id);

    // Back-to-back (touching) is not a conflict.
    const adjacent = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(
        body({
          assignedTo: sales,
          startAt: '2030-01-10T16:00:00.000Z',
          endAt: '2030-01-10T17:00:00.000Z',
        }),
      );
    expect(adjacent.status).toBe(201);

    // Different assignee is fine.
    const otherUser = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...overlap, assignedTo: undefined });
    expect(otherUser.status).toBe(201);

    // Reschedule into the adjacent slot conflicts; excludes self when moving within own slot.
    const rescheduleConflict = await request(app)
      .post(`/api/v1/appointments/${first.body.data.id}/reschedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startAt: '2030-01-10T16:30:00.000Z', endAt: '2030-01-10T17:30:00.000Z' });
    expect(rescheduleConflict.status).toBe(409);

    const selfMove = await request(app)
      .post(`/api/v1/appointments/${first.body.data.id}/reschedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startAt: '2030-01-10T15:10:00.000Z', endAt: '2030-01-10T15:50:00.000Z' });
    expect(selfMove.status).toBe(200);
    expect(selfMove.body.data.startAt).toBe('2030-01-10T15:10:00.000Z');

    const badRange = await request(app)
      .post(`/api/v1/appointments/${first.body.data.id}/reschedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startAt: '2030-01-10T15:50:00.000Z', endAt: '2030-01-10T15:10:00.000Z' });
    expect(badRange.status).toBe(400);

    const freeSlot = await request(app)
      .post(`/api/v1/appointments/${first.body.data.id}/reschedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startAt: '2030-01-12T15:00:00.000Z', endAt: '2030-01-12T16:00:00.000Z' });
    expect(freeSlot.status).toBe(200);
    expect(
      await NotificationModel.countDocuments({ userId: sales, type: 'appointment_changed' }),
    ).toBe(2);

    // The original slot is now free again.
    const reuse = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ assignedTo: sales }));
    expect(reuse.status).toBe(201);

    // force=true bypasses conflict detection.
    const forced = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...overlap, force: true });
    expect(forced.status).toBe(201);
  });

  it('cancels an appointment, frees the slot, and notifies the assignee', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const sales = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const salesToken = await login('a@example.com');

    const created = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body({ assignedTo: sales }));
    const id = created.body.data.id as string;

    const cancelled = await request(app)
      .post(`/api/v1/appointments/${id}/cancel`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ reason: 'Customer postponed' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(cancelled.body.data.cancellationReason).toBe('Customer postponed');
    expect(
      await NotificationModel.countDocuments({ userId: sales, type: 'appointment_changed' }),
    ).toBe(1);

    const again = await request(app)
      .post(`/api/v1/appointments/${id}/cancel`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({});
    expect(again.status).toBe(409);

    const patchCancelled = await request(app)
      .patch(`/api/v1/appointments/${id}`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ notes: 'x' });
    expect(patchCancelled.status).toBe(409);

    const rebooked = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body({ assignedTo: sales }));
    expect(rebooked.status).toBe(201);

    const filtered = await request(app)
      .get('/api/v1/appointments?status=cancelled')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].id).toBe(id);
  });

  it('updates fields and filters list by search, range, and type', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const token = await login('admin@example.com');

    const created = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body({ title: 'Smith (Austin)', notes: 'Bring ladder' }));
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/v1/appointments/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'confirmed', location: '12 Oak St' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.status).toBe('confirmed');
    expect(patched.body.data.location).toBe('12 Oak St');

    const search = await request(app)
      .get(`/api/v1/appointments?search=${encodeURIComponent('(Austin')}`)
      .set('Authorization', `Bearer ${token}`);
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);

    const inRange = await request(app)
      .get(
        `/api/v1/appointments?from=${encodeURIComponent('2030-01-10T00:00:00.000Z')}&to=${encodeURIComponent('2030-01-10T23:59:59.000Z')}&typeKey=inspection`,
      )
      .set('Authorization', `Bearer ${token}`);
    expect(inRange.body.data).toHaveLength(1);

    const outOfRange = await request(app)
      .get(`/api/v1/appointments?from=${encodeURIComponent('2030-02-01T00:00:00.000Z')}`)
      .set('Authorization', `Bearer ${token}`);
    expect(outOfRange.body.data).toHaveLength(0);

    const invalidId = await request(app)
      .get('/api/v1/appointments/not-an-id')
      .set('Authorization', `Bearer ${token}`);
    expect(invalidId.status).toBe(404);
  });

  it('reminders report not_configured and never claim delivery', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const sales = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const salesToken = await login('a@example.com');

    const created = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body({ assignedTo: sales }));
    const id = created.body.data.id as string;

    const res = await request(app)
      .post(`/api/v1/appointments/${id}/reminders`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ email: true, sms: true });
    expect(res.status).toBe(200);
    expect(res.body.data.reminder.emailRequested).toBe(true);
    expect(res.body.data.reminder.smsRequested).toBe(true);
    expect(res.body.data.reminder.emailStatus).toBe('not_configured');
    expect(res.body.data.reminder.smsStatus).toBe('not_configured');
    expect(res.body.data.reminder.internalNotifiedAt).not.toBeNull();
    expect(
      await NotificationModel.countDocuments({ userId: sales, type: 'appointment_reminder' }),
    ).toBe(1);

    const emailOff = await request(app)
      .post(`/api/v1/appointments/${id}/reminders`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ email: false });
    expect(emailOff.body.data.reminder.emailStatus).toBe('not_requested');
    expect(emailOff.body.data.reminder.smsStatus).toBe('not_configured');
  });
});
