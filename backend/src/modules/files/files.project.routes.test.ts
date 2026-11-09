import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { ProjectModel } from '../projects/project.model.js';

const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

describe('Project documents and customer visibility', () => {
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

  const login = async (email: string): Promise<string> =>
    (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;

  async function seedProject(ownerId: string, tag: string) {
    const customer = await CustomerModel.create({ type: 'individual', firstName: tag, lastName: 'Owner', ownerId });
    const property = await PropertyModel.create({ customerId: customer._id, address: { line1: `1 ${tag} St`, city: 'Austin', state: 'TX', zip: '78701' } });
    const project = await ProjectModel.create({ number: `PRJ-T-${tag}`, customerId: customer._id, propertyId: property._id, createdBy: ownerId });
    return { customer, property, project };
  }
  const body = (extra: Record<string, unknown>) => ({
    filename: 'plan.jpg', mimeType: 'image/jpeg', category: 'document', contentBase64: TINY_JPEG.toString('base64'), ...extra,
  });

  it('attaches a document to a project, inherits its customer, lists by project and never exposes storage paths', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const admin = await login('admin@example.com');
    const { customer, project } = await seedProject(adminId, 'A');

    const up = await request(app).post('/api/v1/files').set('Authorization', `Bearer ${admin}`).send(body({ projectId: String(project._id), caption: 'Signed scope' }));
    expect(up.status).toBe(201);
    expect(up.body.data.projectId).toBe(String(project._id));
    expect(up.body.data.customerId).toBe(String(customer._id));
    expect(JSON.stringify(up.body)).not.toMatch(/storageKey|storage\/|FILE_STORAGE|[A-Z]:\\/);

    const list = await request(app).get(`/api/v1/files?projectId=${project._id}`).set('Authorization', `Bearer ${admin}`);
    expect(list.body.data).toHaveLength(1);
    const dl = await request(app).get(`/api/v1/files/${up.body.data.id}/download`).set('Authorization', `Bearer ${admin}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('a salesperson cannot attach files to, list or download files of a project they do not own', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    await createUser({ email: 'sales@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');
    const { project } = await seedProject(adminId, 'B');

    const denied = await request(app).post('/api/v1/files').set('Authorization', `Bearer ${sales}`).send(body({ projectId: String(project._id) }));
    expect(denied.status).toBe(400);

    const up = await request(app).post('/api/v1/files').set('Authorization', `Bearer ${admin}`).send(body({ projectId: String(project._id) }));
    const list = await request(app).get(`/api/v1/files?projectId=${project._id}`).set('Authorization', `Bearer ${sales}`);
    expect(list.body.data).toHaveLength(0);
    const dl = await request(app).get(`/api/v1/files/${up.body.data.id}/download`).set('Authorization', `Bearer ${sales}`);
    expect(dl.status).toBe(404);
  });

  it('rejects disallowed types (415) and oversize payloads (413)', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const admin = await login('admin@example.com');
    const { project } = await seedProject(adminId, 'C');
    const exe = await request(app).post('/api/v1/files').set('Authorization', `Bearer ${admin}`).send(body({ projectId: String(project._id), mimeType: 'application/x-msdownload', filename: 'x.exe' }));
    expect(exe.status).toBe(415);
    const big = Buffer.alloc(8_100_000, 1).toString('base64');
    const tooBig = await request(app).post('/api/v1/files').set('Authorization', `Bearer ${admin}`).send(body({ projectId: String(project._id), contentBase64: big }));
    expect(tooBig.status).toBe(413);
  });

  it('only customer-visible files of the portal customer appear in the portal', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const admin = await login('admin@example.com');
    const mine = await seedProject(adminId, 'D');
    const other = await seedProject(adminId, 'E');
    const upload = (projectId: string, visibility: string, filename: string) =>
      request(app).post('/api/v1/files').set('Authorization', `Bearer ${admin}`).send(body({ projectId, visibility, filename }));
    await upload(String(mine.project._id), 'customer', 'shared.jpg');
    await upload(String(mine.project._id), 'internal', 'internal.jpg');
    await upload(String(other.project._id), 'customer', 'someone-else.jpg');

    await request(app).post('/api/v1/portal/accounts').set('Authorization', `Bearer ${admin}`).send({ customerId: String(mine.customer._id), email: 'd.portal@example.test', temporaryPassword: 'TempPortalPass1!', firstName: 'D', lastName: 'Owner' });
    const pl = await request(app).post('/api/v1/portal/auth/login').send({ email: 'd.portal@example.test', password: 'TempPortalPass1!' });
    const pt = pl.body.data.accessToken as string;
    await request(app).post('/api/v1/portal/auth/password/change').set('Authorization', `Bearer ${pt}`).send({ currentPassword: 'TempPortalPass1!', newPassword: 'PortalNewPass12!' });

    const files = await request(app).get('/api/v1/portal/files').set('Authorization', `Bearer ${pt}`);
    expect(files.status).toBe(200);
    const names = (files.body.data as Array<{ originalFilename: string }>).map((f) => f.originalFilename);
    expect(names).toEqual(['shared.jpg']);
  });
});
