import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { LeadModel } from '../leads/lead.model.js';

describe('Customer intake workflow', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => { await startTestDb(); app = createApp(); }, 120_000);
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await clearCollections(); await seedPhase2Config(); });

  const login = async (email: string): Promise<string> =>
    (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setup() {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const otherSalesId = await createUser({ email: 'sales2@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');
    await request(app).post('/api/v1/forms/templates/install-defaults').set(h(admin));
    return { admin, sales, salesId, otherSalesId };
  }
  const answers = (rep: string, extra: Record<string, unknown> = {}) => ({
    first_name: 'Dana', last_name: 'Whitfield', mobile_phone: '5125550177', email: 'dana@example.test',
    property_address: { line1: '12 Oak Ridge Dr', city: 'Austin', state: 'TX', zip: '78701', lat: 30.27, lng: -97.74 },
    owner_or_renter: 'owner', property_type: 'single_family', services: ['roofing', 'gutters'],
    reason_for_call: 'storm_damage', lead_source: 'door_knock', assigned_rep: rep, preferred_contact: 'text', best_time: 'evening',
    ...extra,
  });

  it('turns one intake into customer + property + lead, reusing the data and recording consent with wording and version', async () => {
    const { sales, salesId } = await setup();
    const r = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), answers: answers(salesId, { consent_text: true, consent_email: false }) });
    expect(r.status).toBe(201);
    const customer = await CustomerModel.findById(r.body.data.customerId).lean();
    expect(customer).toMatchObject({ firstName: 'Dana', lastName: 'Whitfield', preferredContact: 'text', bestTimeToReach: 'evening' });
    expect(String(customer!.ownerId)).toBe(salesId);
    expect(customer!.consent?.sms).toMatchObject({ granted: true, source: 'intake_form', wordingVersion: 'v1' });
    expect(customer!.consent?.sms?.wording).toMatch(/text messages/);
    expect(customer!.consent?.email).toMatchObject({ granted: false });
    expect(customer!.consent?.sms?.at).toBeInstanceOf(Date);
    const property = await PropertyModel.findById(r.body.data.propertyId).lean();
    expect(property).toMatchObject({ propertyTypeKey: 'single_family' });
    expect(property!.address.line1).toBe('12 Oak Ridge Dr');
    expect(property!.location).toMatchObject({ lat: 30.27, lng: -97.74 });
    const lead = await LeadModel.findById(r.body.data.leadId).lean();
    expect(lead).toMatchObject({ sourceKey: 'door_knocking', serviceInterestKey: 'roofing' });
    expect(r.body.data.submission.status).toBe('completed');
    expect(r.body.data.submission.customerId).toBe(r.body.data.customerId);
  });

  it('never assumes consent: unanswered consent questions store nothing', async () => {
    const { sales, salesId } = await setup();
    const r = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), answers: answers(salesId) });
    expect(r.status).toBe(201);
    const customer = await CustomerModel.findById(r.body.data.customerId).lean();
    expect(customer!.consent?.sms).toBeUndefined();
    expect(customer!.consent?.email).toBeUndefined();
  });

  it('requires the mandatory fields and shows HOA fields only for HOA properties', async () => {
    const { sales, salesId } = await setup();
    const bad = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), answers: { first_name: 'Only' } });
    expect(bad.status).toBe(422);
    const paths = (bad.body.error.details as Array<{ path: string }>).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['last_name', 'mobile_phone', 'email', 'property_address', 'owner_or_renter', 'property_type', 'services', 'reason_for_call', 'lead_source', 'assigned_rep']));
    // hoa_name on a non-HOA property is not applicable: it is discarded, not stored.
    const hidden = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), answers: answers(salesId, { hoa_name: 'Oak HOA' }) });
    expect(hidden.status).toBe(201);
    expect(hidden.body.data.submission.answers.hoa_name).toBeUndefined();
    const hoa = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), answers: answers(salesId, { property_type: 'hoa', hoa_name: 'Oak HOA', mobile_phone: '5125550166', email: 'hoa@example.test', first_name: 'Hal', last_name: 'Ortiz', property_address: { line1: '9 Elm Ct', city: 'Austin', state: 'TX', zip: '78702' } }) });
    expect(hoa.status).toBe(201);
  });

  it('is idempotent on clientId and blocks duplicates unless forced', async () => {
    const { sales, salesId } = await setup();
    const clientId = randomUUID();
    const first = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId, answers: answers(salesId) });
    const retry = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId, answers: answers(salesId) });
    expect(retry.status).toBe(200);
    expect(retry.body.data.created).toBe(false);
    expect(retry.body.data.customerId).toBe(first.body.data.customerId);
    expect(await CustomerModel.countDocuments()).toBe(1);

    const dup = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), answers: answers(salesId) });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_FOUND');
    const forced = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), force: true, answers: answers(salesId) });
    expect(forced.status).toBe(201);
    expect(await CustomerModel.countDocuments()).toBe(2);
  });

  it('a salesperson can only assign intake to themselves; admins can assign anyone', async () => {
    const { sales, admin, otherSalesId } = await setup();
    const denied = await request(app).post('/api/v1/forms/intake').set(h(sales)).send({ clientId: randomUUID(), answers: answers(otherSalesId) });
    expect(denied.status).toBe(403);
    const ok = await request(app).post('/api/v1/forms/intake').set(h(admin)).send({ clientId: randomUUID(), answers: answers(otherSalesId) });
    expect(ok.status).toBe(201);
    expect(String((await CustomerModel.findById(ok.body.data.customerId).lean())!.ownerId)).toBe(otherSalesId);
    expect((await request(app).post('/api/v1/forms/intake').set(h(admin)).send({ clientId: randomUUID(), answers: answers('aaaaaaaaaaaaaaaaaaaaaaaa', { mobile_phone: '5125550155', email: 'x@example.test' }) })).status).toBe(422);
  });
});
