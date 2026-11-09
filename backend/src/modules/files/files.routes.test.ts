import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { getStorageAdapter } from '../../services/storage/local-storage.adapter.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { FileModel } from './file.model.js';

// Smallest valid-looking JPEG header bytes; content is opaque to the API.
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

describe('Files routes', () => {
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

  async function login(email: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password12345!' });
    return res.body.data.accessToken as string;
  }

  async function createCustomer(ownerId: string) {
    const customer = await CustomerModel.create({
      type: 'individual',
      firstName: 'Pat',
      lastName: 'Owner',
      ownerId,
    });
    const property = await PropertyModel.create({
      customerId: customer._id,
      address: { line1: '12 Oak St', city: 'Austin', state: 'TX', zip: '78701' },
    });
    return { customerId: customer._id.toString(), propertyId: property._id.toString() };
  }

  function uploadBody(overrides: Record<string, unknown> = {}) {
    return {
      filename: 'roof front.jpg',
      mimeType: 'image/jpeg',
      category: 'photo',
      contentBase64: TINY_JPEG.toString('base64'),
      ...overrides,
    };
  }

  it('uploads a base64 jpeg, lists it, and downloads the same bytes', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const token = await login('admin@example.com');
    const { customerId } = await createCustomer(adminId);

    const created = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .send(uploadBody({ customerId, caption: 'Front slope' }));
    expect(created.status).toBe(201);
    const file = created.body.data;
    expect(file.originalFilename).toBe('roof front.jpg');
    expect(file.sizeBytes).toBe(TINY_JPEG.length);
    expect(file.visibility).toBe('internal');
    expect(file.customerId).toBe(customerId);
    expect(file.caption).toBe('Front slope');
    expect(file.uploadedBy).toBe(adminId);
    // No storage location or public URL leaks to clients.
    expect(file.storageKey).toBeUndefined();
    expect(file.downloadPath).toBe(`/api/v1/files/${file.id}/download`);

    // Object exists in storage under <companyId>/yyyy/mm/<uuid>-<sanitized> (company-prefixed since multi-company support).
    const stored = await FileModel.findById(file.id);
    expect(stored?.storageKey).toMatch(/^[0-9a-f]{24}\/\d{4}\/\d{2}\/[0-9a-f-]{36}-roof_front\.jpg$/);
    expect(await getStorageAdapter().getObject(stored!.storageKey)).not.toBeNull();
    expect(getStorageAdapter().getStatus()).toEqual({
      provider: 'local',
      configured: true,
      mode: 'local_dev',
    });

    const list = await request(app)
      .get(`/api/v1/files?customerId=${customerId}&category=photo`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);

    const meta = await request(app)
      .get(`/api/v1/files/${file.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(meta.status).toBe(200);
    expect(meta.body.data.id).toBe(file.id);

    const download = await request(app)
      .get(`/api/v1/files/${file.id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/jpeg');
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="roof front\.jpg"/);
    expect(Buffer.from(download.body as Buffer).equals(TINY_JPEG)).toBe(true);

    expect(await AuditLogModel.countDocuments({ action: 'file.uploaded', entityId: file.id })).toBe(1);

    const noAuth = await request(app).get(`/api/v1/files/${file.id}/download`);
    expect(noAuth.status).toBe(401);
  });

  it('rejects disallowed mime types, invalid base64, and oversized files', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const token = await login('admin@example.com');

    const badMime = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .send(uploadBody({ mimeType: 'application/x-msdownload', filename: 'x.exe' }));
    expect(badMime.status).toBe(415);
    expect(badMime.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const svg = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .send(uploadBody({ mimeType: 'image/svg+xml', filename: 'x.svg' }));
    expect(svg.status).toBe(415);

    const badBase64 = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .send(uploadBody({ contentBase64: 'not*valid*base64!' }));
    expect(badBase64.status).toBe(400);

    const tooBig = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .send(uploadBody({ contentBase64: Buffer.alloc(8_000_001, 1).toString('base64') }));
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe('FILE_TOO_LARGE');

    // Exactly at the limit is accepted (and proves the larger JSON limit applies on this router).
    const atLimit = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .send(
        uploadBody({
          mimeType: 'text/plain',
          category: 'document',
          filename: 'big.txt',
          contentBase64: Buffer.alloc(8_000_000, 97).toString('base64'),
        }),
      );
    expect(atLimit.status).toBe(201);
    expect(atLimit.body.data.sizeBytes).toBe(8_000_000);

    expect(await FileModel.countDocuments()).toBe(1);
  });

  it('applies the global 1mb JSON limit to other routes', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const token = await login('admin@example.com');
    const res = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x'.repeat(1_200_000) });
    expect(res.status).toBe(413);
  });

  it('scopes files for salespeople and restricts links to their own records', async () => {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesA = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const salesB = await createUser({ email: 'b@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    const a = await createCustomer(salesA);
    const b = await createCustomer(salesB);

    const own = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(uploadBody({ customerId: a.customerId, propertyId: a.propertyId }));
    expect(own.status).toBe(201);

    // Cannot attach to another salesperson's customer.
    const foreign = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(uploadBody({ customerId: b.customerId }));
    expect(foreign.status).toBe(400);

    // Admin attaches a file to B's customer; B sees it (owner), A does not.
    const forB = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(uploadBody({ customerId: b.customerId, filename: 'b.jpg' }));
    expect(forB.status).toBe(201);

    const listA = await request(app)
      .get('/api/v1/files')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.data.map((f: { id: string }) => f.id)).toEqual([own.body.data.id]);

    const listB = await request(app)
      .get('/api/v1/files')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.data.map((f: { id: string }) => f.id)).toEqual([forB.body.data.id]);

    const listAdmin = await request(app)
      .get('/api/v1/files')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAdmin.body.data).toHaveLength(2);

    const crossGet = await request(app)
      .get(`/api/v1/files/${forB.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossGet.status).toBe(404);
    const crossDownload = await request(app)
      .get(`/api/v1/files/${forB.body.data.id}/download`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossDownload.status).toBe(404);

    const invalidId = await request(app)
      .get('/api/v1/files/not-an-id')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(invalidId.status).toBe(404);
  });

  it('deletes files (admin only), removing the object and auditing; locks customer-visible files', async () => {
    const adminId = await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'a@example.com', role: 'salesperson' });
    const adminToken = await login('admin@example.com');
    const salesToken = await login('a@example.com');
    const { customerId } = await createCustomer(salesId);

    const internal = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${salesToken}`)
      .send(uploadBody({ customerId }));
    const shared = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(uploadBody({ customerId, visibility: 'customer', filename: 'shared.jpg' }));
    expect(shared.body.data.visibility).toBe('customer');

    // Salespeople lack files:delete.
    const forbidden = await request(app)
      .delete(`/api/v1/files/${internal.body.data.id}`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(forbidden.status).toBe(403);

    const locked = await request(app)
      .delete(`/api/v1/files/${shared.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('FILE_LOCKED');

    const stored = await FileModel.findById(internal.body.data.id);
    const removed = await request(app)
      .delete(`/api/v1/files/${internal.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(204);
    expect(await FileModel.findById(internal.body.data.id)).toBeNull();
    expect(await getStorageAdapter().getObject(stored!.storageKey)).toBeNull();
    expect(
      await AuditLogModel.countDocuments({
        action: 'file.deleted',
        entityId: internal.body.data.id,
        actorId: adminId,
      }),
    ).toBe(1);

    const gone = await request(app)
      .get(`/api/v1/files/${internal.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);
  });
});
