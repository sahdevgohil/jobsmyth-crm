import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CompanyModel } from '../companies/company.model.js';
import { FileModel } from '../files/file.model.js';
import { FormSubmissionModel } from './form.model.js';
import type { FormDefinition } from './engine.js';

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z', 'base64').toString('base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

const def: FormDefinition = {
  sections: [
    { id: 'main', title: 'Roof covering', fields: [
      { id: 'roof_material', label: 'Roof material', type: 'dropdown', required: true, options: [{ value: 'asphalt', label: 'Asphalt shingle' }] },
      { id: 'front_slope', label: 'Front slope condition', type: 'condition_rating', required: true, photoRequiredFor: ['damaged'] },
      { id: 'policy_number', label: 'Policy number', type: 'text', sensitive: true },
      { id: 'photo_elevations', label: 'Four elevations', type: 'photos', minPhotos: 1 },
      { id: 'customer_signature', label: 'Customer acknowledgement', type: 'signature', required: true, signerNameRequired: true },
    ] },
  ],
};

describe('Inspection PDF report', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => { await startTestDb(); app = createApp(); }, 120_000);
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await clearCollections(); await seedPhase2Config(); });
  const login = async (e: string): Promise<string> => (await request(app).post('/api/v1/auth/login').send({ email: e, password: 'Password12345!' })).body.data.accessToken as string;
  const h = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function completed() {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const admin = await login('admin@example.com');
    const tpl = await request(app).post('/api/v1/forms/templates').set(h(admin)).send({ key: 'report_test', name: 'Roofing inspection', kind: 'inspection', definition: def });
    await request(app).post(`/api/v1/forms/templates/${tpl.body.data.id}/publish`).set(h(admin)).send({});
    const sub = (await request(app).post('/api/v1/forms/submissions').set(h(admin)).send({ clientId: randomUUID(), templateKey: 'report_test', answers: { roof_material: 'asphalt', front_slope: { rating: 'damaged', notes: 'Hail bruising' }, policy_number: 'POL-998877' } })).body.data;
    const up = (field: string, mime: string, b64: string, name: string) => request(app).post('/api/v1/files').set(h(admin)).send({ filename: name, mimeType: mime, category: 'photo', contentBase64: b64, formSubmissionId: sub.id, formFieldId: field, clientId: randomUUID(), tag: 'North slope' });
    await up('front_slope', 'image/jpeg', JPEG, 'a.jpg');
    await up('photo_elevations', 'image/jpeg', JPEG, 'b.jpg');
    const sig = await up('customer_signature', 'image/png', PNG, 'sig.png');
    await request(app).patch(`/api/v1/forms/submissions/${sub.id}`).set(h(admin)).send({ answers: { roof_material: 'asphalt', front_slope: { rating: 'damaged', notes: 'Hail bruising' }, policy_number: 'POL-998877', customer_signature: { fileId: sig.body.data.id, signedAt: new Date().toISOString(), signerName: 'Pat Owner' } } });
    const done = await request(app).post(`/api/v1/forms/submissions/${sub.id}/complete`).set(h(admin)).send({});
    expect(done.status).toBe(200);
    return { admin, id: sub.id as string };
  }

  it('generates a branded PDF for a completed form, stores it, and keeps sensitive answers out', async () => {
    const { admin, id } = await completed();
    const res = await request(app).get(`/api/v1/forms/submissions/${id}/report`).set(h(admin)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(3_000);
    // pdfkit writes text as hex strings (split by kerning); rebuild the visible text for assertions.
    const text = pdf.toString('latin1').match(/<([0-9a-fA-F]{2,})>/g)!.map((t) => Buffer.from(t.slice(1, -1), 'hex').toString('latin1')).join('');
    expect(text).toMatch(/Roofing inspection/);
    expect(pdf.toString('latin1')).toMatch(/Roofing inspection/);
    expect(text).toMatch(/Roof covering/);
    expect(text).toMatch(/Hail bruising/);
    expect(text).toMatch(/Pat Owner/);
    expect(text).toMatch(/not a contract or authorization to proceed/);
    expect(text).not.toMatch(/POL-998877/);
    // The generated file is stored and linked; the original submission is unchanged.
    const sub = await FormSubmissionModel.findById(id).lean();
    expect(sub!.status).toBe('completed');
    expect(sub!.reportFileId).toBeTruthy();
    const file = await FileModel.findById(sub!.reportFileId).lean();
    expect(file).toMatchObject({ mimeType: 'application/pdf', category: 'report', visibility: 'internal' });
    expect(String(file!.companyId)).toBe(String(sub!.companyId));
  });

  it('refuses reports for drafts and for other companies', async () => {
    const { admin } = await completed();
    const draft = (await request(app).post('/api/v1/forms/submissions').set(h(admin)).send({ clientId: randomUUID(), templateKey: 'report_test', answers: {} })).body.data;
    expect((await request(app).get(`/api/v1/forms/submissions/${draft.id}/report`).set(h(admin))).status).toBe(409);
    const other = await CompanyModel.create({ name: 'Other', slug: 'other' });
    await createUser({ email: 'o@example.com', role: 'admin', companyId: String(other._id) });
    const o = await login('o@example.com');
    expect((await request(app).get(`/api/v1/forms/submissions/${draft.id}/report`).set(h(o))).status).toBe(404);
  });
});
