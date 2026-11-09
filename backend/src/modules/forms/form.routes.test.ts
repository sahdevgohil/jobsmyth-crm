import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CompanyModel } from '../companies/company.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { FileModel } from '../files/file.model.js';
import type { FormDefinition } from './engine.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString('base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

const def = (extraField = false): FormDefinition => ({
  sections: [
    {
      id: 'main', title: 'Main',
      fields: [
        { id: 'job_type', label: 'Job type', type: 'dropdown', required: true, options: [{ value: 'insurance', label: 'Insurance' }, { value: 'retail', label: 'Retail' }] },
        { id: 'roof_slope', label: 'Slope', type: 'condition_rating', required: true, photoRequiredFor: ['damaged'] },
        { id: 'photo_front', label: 'Front elevation', type: 'photos', minPhotos: 2 },
        ...(extraField ? [{ id: 'extra_note', label: 'Extra note', type: 'text' as const }] : []),
        { id: 'signature', label: 'Acknowledgement', type: 'signature', required: true, signerNameRequired: true },
      ],
    },
    {
      id: 'insurance', title: 'Insurance', visibleWhen: { field: 'job_type', op: 'eq', value: 'insurance' },
      fields: [{ id: 'policy_number', label: 'Policy number', type: 'text', required: true, sensitive: true }],
    },
  ],
});

describe('Dynamic forms API', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => { await startTestDb(); app = createApp(); }, 120_000);
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await clearCollections(); await seedPhase2Config(); });

  const login = async (email: string): Promise<string> =>
    (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setup() {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');
    const tpl = await request(app).post('/api/v1/forms/templates').set(h(admin)).send({ key: 'test_inspection', name: 'Test inspection', kind: 'inspection', definition: def() });
    expect(tpl.status).toBe(201);
    const pub = await request(app).post(`/api/v1/forms/templates/${tpl.body.data.id}/publish`).set(h(admin)).send({ changeNote: 'v1' });
    expect(pub.body.data.publishedVersion).toBe(1);
    return { adminId, salesId, admin, sales, templateId: tpl.body.data.id as string };
  }

  it('installs the client default templates (intake, roofing, remodeling and service inspections) as published v1', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const admin = await login('admin@example.com');
    const r = await request(app).post('/api/v1/forms/templates/install-defaults').set(h(admin));
    expect(r.status).toBe(200);
    expect(r.body.data.created).toEqual(expect.arrayContaining(['customer_intake', 'roofing_job_details', 'roofing_inspection', 'remodeling_inspection', 'gutter_inspection', 'siding_inspection', 'windows_doors_inspection', 'exterior_paint_inspection', 'fencing_inspection', 'decks_patios_inspection', 'solar_skylights_inspection']));
    const again = await request(app).post('/api/v1/forms/templates/install-defaults').set(h(admin));
    expect(again.body.data.created).toEqual([]);
    const list = await request(app).get('/api/v1/forms/templates').set(h(admin));
    expect(list.body.data).toHaveLength(11);
    expect(list.body.data.every((t: { publishedVersion: number }) => t.publishedVersion === 1)).toBe(true);
  });

  it('only form managers can create, edit or publish; salespeople can read', async () => {
    const { sales, templateId } = await setup();
    expect((await request(app).post('/api/v1/forms/templates').set(h(sales)).send({ key: 'x_form', name: 'X', kind: 'other', definition: def() })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/forms/templates/${templateId}`).set(h(sales)).send({ name: 'Hacked' })).status).toBe(403);
    expect((await request(app).post(`/api/v1/forms/templates/${templateId}/publish`).set(h(sales)).send({})).status).toBe(403);
    expect((await request(app).get('/api/v1/forms/templates').set(h(sales))).status).toBe(200);
    expect((await request(app).get('/api/v1/forms/templates')).status).toBe(401);
  });

  it('rejects invalid definitions and keeps intake core fields', async () => {
    const { admin } = await setup();
    const bad = await request(app).post('/api/v1/forms/templates').set(h(admin)).send({ key: 'bad_form', name: 'Bad', kind: 'other', definition: { sections: [{ id: 's', title: 'S', fields: [{ id: 'a', label: 'A', type: 'dropdown' }] }] } });
    expect(bad.status).toBe(422);
    const intake = await request(app).post('/api/v1/forms/templates').set(h(admin)).send({ key: 'my_intake', name: 'Intake', kind: 'intake', definition: def() });
    expect(intake.status).toBe(422);
    expect(JSON.stringify(intake.body)).toMatch(/Missing required intake field/);
  });

  it('versioning: editing a template never changes a submission created on an older version', async () => {
    const { admin, sales, templateId } = await setup();
    const id1 = randomUUID();
    const first = await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: id1, templateKey: 'test_inspection', answers: { job_type: 'retail' } });
    expect(first.status).toBe(201);
    expect(first.body.data.templateVersion).toBe(1);

    const edit = await request(app).patch(`/api/v1/forms/templates/${templateId}`).set(h(admin)).send({ definition: def(true) });
    expect(edit.status).toBe(200);
    expect(edit.body.data.hasUnpublishedChanges).toBe(true);
    // Not yet published: new submissions still use v1.
    const mid = await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: {} });
    expect(mid.body.data.templateVersion).toBe(1);
    expect((await request(app).post(`/api/v1/forms/templates/${templateId}/publish`).set(h(admin)).send({ changeNote: 'added extra note' })).body.data.publishedVersion).toBe(2);

    const second = await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: { extra_note: 'hello' } });
    expect(second.body.data.templateVersion).toBe(2);
    // The new field is unknown to v1.
    const stale = await request(app).patch(`/api/v1/forms/submissions/${first.body.data.id}`).set(h(sales)).send({ answers: { extra_note: 'x' } });
    expect(stale.status).toBe(422);
    const reread = await request(app).get(`/api/v1/forms/submissions/${first.body.data.id}`).set(h(sales));
    expect(reread.body.data.templateVersion).toBe(1);
    const versions = await request(app).get(`/api/v1/forms/templates/${templateId}/versions`).set(h(admin));
    expect(versions.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('enforces required fields, conditional sections and required photos on completion', async () => {
    const { sales } = await setup();
    const created = await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: { job_type: 'insurance', roof_slope: { rating: 'damaged' } } });
    const id = created.body.data.id as string;
    const early = await request(app).post(`/api/v1/forms/submissions/${id}/complete`).set(h(sales)).send({});
    expect(early.status).toBe(422);
    const paths = (early.body.error.details as Array<{ path: string }>).map((d) => d.path).sort();
    expect(paths).toEqual(['photo_front', 'policy_number', 'roof_slope', 'signature']);

    // Upload required photos (2 elevations + 1 for the damaged rating) and the signature image.
    const photo = (field: string, cid = randomUUID()) => request(app).post('/api/v1/files').set(h(sales)).send({ filename: 'p.jpg', mimeType: 'image/jpeg', category: 'photo', contentBase64: JPEG, formSubmissionId: id, formFieldId: field, clientId: cid, tag: 'front', gps: { lat: 30.27, lng: -97.74 }, capturedAt: new Date().toISOString() });
    expect((await photo('photo_front')).status).toBe(201);
    expect((await photo('photo_front')).status).toBe(201);
    expect((await photo('roof_slope')).status).toBe(201);
    const sigFile = await request(app).post('/api/v1/files').set(h(sales)).send({ filename: 'sig.png', mimeType: 'image/png', category: 'document', contentBase64: PNG, formSubmissionId: id, formFieldId: 'signature', clientId: randomUUID() });
    expect(sigFile.status).toBe(201);

    const patch = await request(app).patch(`/api/v1/forms/submissions/${id}`).set(h(sales)).send({ expectedRevision: 1, answers: { job_type: 'insurance', roof_slope: { rating: 'damaged' }, policy_number: 'POL-998877', signature: { fileId: sigFile.body.data.id, signedAt: new Date().toISOString(), signerName: 'Pat Owner' } } });
    expect(patch.status).toBe(200);
    const done = await request(app).post(`/api/v1/forms/submissions/${id}/complete`).set(h(sales)).send({});
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('completed');
    // Completed forms are immutable and reject new files.
    expect((await request(app).patch(`/api/v1/forms/submissions/${id}`).set(h(sales)).send({ answers: {} })).status).toBe(409);
    expect((await photo('photo_front')).status).toBe(409);
  });

  it('a retried photo upload with the same clientId is stored once', async () => {
    const { sales } = await setup();
    const sub = (await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: {} })).body.data;
    const cid = randomUUID();
    const send = () => request(app).post('/api/v1/files').set(h(sales)).send({ filename: 'p.jpg', mimeType: 'image/jpeg', category: 'photo', contentBase64: JPEG, formSubmissionId: sub.id, formFieldId: 'photo_front', clientId: cid });
    const [a, b] = [await send(), await send()];
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await FileModel.countDocuments({ formSubmissionId: sub.id })).toBe(1);
    // Invalid field → rejected.
    expect((await request(app).post('/api/v1/files').set(h(sales)).send({ filename: 'p.jpg', mimeType: 'image/jpeg', category: 'photo', contentBase64: JPEG, formSubmissionId: sub.id, formFieldId: 'job_type' })).status).toBe(422);
  });

  it('masks sensitive answers for users without intake:sensitive and never lets masks overwrite real data', async () => {
    const { admin, sales } = await setup();
    const created = await request(app).post('/api/v1/forms/submissions').set(h(admin)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: { job_type: 'insurance', policy_number: 'POL-1' }, assignedTo: undefined });
    expect(created.status).toBe(201);
    // Sales cannot see an admin's submission at all (scope).
    expect((await request(app).get(`/api/v1/forms/submissions/${created.body.data.id}`).set(h(sales))).status).toBe(404);
    const own = await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: { job_type: 'insurance', policy_number: 'POL-2' } });
    const got = await request(app).get(`/api/v1/forms/submissions/${own.body.data.id}`).set(h(sales));
    expect(got.body.data.answers.policy_number).toBe('[restricted]');
    const echoed = await request(app).patch(`/api/v1/forms/submissions/${own.body.data.id}`).set(h(sales)).send({ answers: got.body.data.answers });
    expect(echoed.status).toBe(200);
    const asAdmin = await request(app).get(`/api/v1/forms/submissions/${own.body.data.id}`).set(h(admin));
    expect(asAdmin.body.data.answers.policy_number).toBe('POL-2');
    // Lists never contain answers.
    const list = await request(app).get('/api/v1/forms/submissions').set(h(admin));
    expect(JSON.stringify(list.body)).not.toContain('POL-2');
  });

  it('offline sync is idempotent, detects conflicts and never overwrites newer server data', async () => {
    const { sales } = await setup();
    const clientId = randomUUID();
    const payload = (answers: object, extra: object = {}) => ({ clientId, templateKey: 'test_inspection', templateVersion: 1, answers, ...extra });
    const sync = (body: object) => request(app).post('/api/v1/forms/sync').set(h(sales)).send(body);

    const a = await sync(payload({ job_type: 'retail' }));
    expect(a.body.data.status).toBe('created');
    const again = await sync(payload({ job_type: 'retail' }));
    expect(again.body.data.status).toBe('unchanged'); // lost-response retry
    expect(await (await import('./form.model.js')).FormSubmissionModel.countDocuments({ clientId })).toBe(1);

    const upd = await sync(payload({ job_type: 'retail', roof_slope: { rating: 'good' } }, { baseRevision: 1 }));
    expect(upd.body.data.status).toBe('updated');
    expect(upd.body.data.submission.revision).toBe(2);

    // A second device edits from the stale revision 1 → conflict, server value preserved.
    const stale = await sync(payload({ job_type: 'insurance' }, { baseRevision: 1 }));
    expect(stale.body.data.status).toBe('conflict');
    expect(stale.body.data.submission.answers.job_type).toBe('retail');

    const bad = await sync(payload({ job_type: 'nonsense' }, { baseRevision: 2 }));
    expect(bad.body.data.status).toBe('invalid');
    expect(bad.body.data.issues[0].fieldId).toBe('job_type');
  });

  it('isolates companies: another company cannot list, read, submit to or sync against this company forms', async () => {
    const { admin, sales } = await setup();
    const other = await CompanyModel.create({ name: 'Other Roofing Co', slug: 'other' });
    await createUser({ email: 'other-admin@example.com', role: 'admin', companyId: String(other._id) });
    const otherAdmin = await login('other-admin@example.com');

    expect((await request(app).get('/api/v1/forms/templates').set(h(otherAdmin))).body.data).toEqual([]);
    const sub = await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: {} });
    expect((await request(app).get(`/api/v1/forms/submissions/${sub.body.data.id}`).set(h(otherAdmin))).status).toBe(404);
    expect((await request(app).get('/api/v1/forms/submissions').set(h(otherAdmin))).body.data).toEqual([]);
    expect((await request(app).post('/api/v1/forms/submissions').set(h(otherAdmin)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: {} })).status).toBe(404);
    expect((await request(app).post('/api/v1/forms/sync').set(h(otherAdmin)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: {} })).status).toBe(404);
    const tplId = (await request(app).get('/api/v1/forms/templates').set(h(admin))).body.data[0].id as string;
    expect((await request(app).get(`/api/v1/forms/templates/${tplId}`).set(h(otherAdmin))).status).toBe(404);
    expect((await request(app).patch(`/api/v1/forms/templates/${tplId}`).set(h(otherAdmin)).send({ name: 'x' })).status).toBe(404);
    // The same stable key may exist independently in the other company.
    const own = await request(app).post('/api/v1/forms/templates').set(h(otherAdmin)).send({ key: 'test_inspection', name: 'Their own', kind: 'inspection', definition: def() });
    expect(own.status).toBe(201);
    // A same-clientId submission in another company is a different record.
    await request(app).post(`/api/v1/forms/templates/${own.body.data.id}/publish`).set(h(otherAdmin)).send({});
    const cid = randomUUID();
    const a = await request(app).post('/api/v1/forms/submissions').set(h(sales)).send({ clientId: cid, templateKey: 'test_inspection', answers: {} });
    const b = await request(app).post('/api/v1/forms/submissions').set(h(otherAdmin)).send({ clientId: cid, templateKey: 'test_inspection', answers: {} });
    expect(a.body.data.id).not.toBe(b.body.data.id);
    // Linking a customer from another company is refused like a missing record.
    const ownerId = await createUser({ email: 'owner@example.com', role: 'salesperson' });
    const customer = await CustomerModel.create({ type: 'individual', firstName: 'A', lastName: 'B', ownerId });
    const property = await PropertyModel.create({ customerId: customer._id, address: { line1: '1 St', zip: '78701' } });
    void property;
    const linked = await request(app).post('/api/v1/forms/submissions').set(h(otherAdmin)).send({ clientId: randomUUID(), templateKey: 'test_inspection', answers: {}, links: { customerId: String(customer._id) } });
    expect(linked.status).toBe(404);
  });
});
