import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { PipelineJobModel } from './pipeline.model.js';

describe('Pipeline dashboard: stages, money and history (real API, real database)', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => { await startTestDb(); app = createApp(); }, 120_000);
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await clearCollections(); await seedPhase2Config(); });

  const login = async (email: string): Promise<string> => (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password12345!' })).body.data.accessToken as string;
  const hdr = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = '/api/v1';

  async function setup() {
    await createUser({ email: 'admin@example.com', role: 'admin' });
    const salesId = await createUser({ email: 'sales@example.com', role: 'salesperson', firstName: 'Sam', lastName: 'Seller' });
    const otherId = await createUser({ email: 'other@example.com', role: 'salesperson' });
    const admin = await login('admin@example.com');
    const sales = await login('sales@example.com');
    const other = await login('other@example.com');
    const customer = await CustomerModel.create({ type: 'individual', firstName: 'Pat', lastName: 'Owner', ownerId: salesId });
    const property = await PropertyModel.create({ customerId: customer._id, address: { line1: '500 Example Ave', city: 'Austin', state: 'TX', zip: '78701' } });
    return { admin, sales, other, salesId, otherId, customerId: String(customer._id), propertyId: String(property._id) };
  }

  const money = (cents: number) => ({ description: 'Roof replacement', kind: 'labor', quantity: 1, unit: 'ea', unitCostCents: cents });
  async function estimate(t: string, ids: { customerId: string; propertyId: string }, cents: number): Promise<string> {
    const r = await request(app).post(`${api}/estimates`).set(hdr(t)).send({ customerId: ids.customerId, propertyId: ids.propertyId, lineItems: [money(cents)], taxRateBps: 0 });
    expect(r.status).toBe(201);
    return r.body.data.id as string;
  }
  const send = (t: string, id: string) => request(app).patch(`${api}/estimates/${id}`).set(hdr(t)).send({ status: 'sent' });
  const summary = async (t: string, q = '') => (await request(app).get(`${api}/pipeline/summary${q}`).set(hdr(t))).body.data as {
    stages: Array<{ stage: string; jobCount: number; valueCents: number; percentOfActive: number | null }>; totalActiveCents: number; activeJobCount: number; denied: { jobCount: number; valueCents: number }; limitations: string[];
  };
  const stage = (s: Awaited<ReturnType<typeof summary>>, name: string) => s.stages.find((x) => x.stage === name)!;

  it('moves one job, and its dollars, through all six stages without ever double counting', async () => {
    const ctx = await setup();
    const est = await estimate(ctx.sales, ctx, 1_000_000);

    // a draft estimate is not a pipeline job
    expect((await summary(ctx.sales)).activeJobCount).toBe(0);

    // 1. Estimates Out
    expect((await send(ctx.sales, est)).status).toBe(200);
    let s = await summary(ctx.sales);
    expect(stage(s, 'estimates_out')).toMatchObject({ jobCount: 1, valueCents: 1_000_000 });
    expect(s.totalActiveCents).toBe(1_000_000);

    // 2. Estimates Accepted
    expect((await request(app).post(`${api}/estimates/${est}/accept`).set(hdr(ctx.sales))).status).toBe(200);
    s = await summary(ctx.sales);
    expect(stage(s, 'estimates_out').jobCount).toBe(0);
    expect(stage(s, 'estimates_accepted')).toMatchObject({ jobCount: 1, valueCents: 1_000_000 });
    expect(s.totalActiveCents).toBe(1_000_000);

    // project created from the accepted estimate: still Estimates Accepted, still one job
    const project = (await request(app).post(`${api}/projects`).set(hdr(ctx.admin)).send({ customerId: ctx.customerId, propertyId: ctx.propertyId, estimateId: est, projectTypeKey: 'roof_replacement' })).body.data;
    expect(await PipelineJobModel.countDocuments({})).toBe(1);
    expect(stage(await summary(ctx.sales), 'estimates_accepted').jobCount).toBe(1);

    const setStatus = (status: string) => request(app).post(`${api}/projects/${project.id}/status`).set(hdr(ctx.admin)).send({ status });
    for (const st of ['approved', 'scheduled']) expect((await setStatus(st)).status).toBe(200);
    expect(stage(await summary(ctx.sales), 'estimates_accepted').jobCount).toBe(1); // scheduled is not started

    // 3. Jobs Started
    expect((await setStatus('in_progress')).status).toBe(200);
    s = await summary(ctx.sales);
    expect(stage(s, 'jobs_started')).toMatchObject({ jobCount: 1, valueCents: 1_000_000 });
    expect(stage(s, 'estimates_accepted').jobCount).toBe(0);

    // a change order raises the contract; the value follows the job
    const job = (await request(app).get(`${api}/pipeline/jobs?stage=jobs_started`).set(hdr(ctx.sales))).body.data[0];
    expect((await request(app).post(`${api}/pipeline/jobs/${job.id}/change-orders`).set(hdr(ctx.sales)).send({ description: 'Extra decking', amountCents: 50_000 })).status).toBe(403); // admin only
    expect((await request(app).post(`${api}/pipeline/jobs/${job.id}/change-orders`).set(hdr(ctx.admin)).send({ description: 'Extra decking', amountCents: 50_000 })).status).toBe(201);
    expect(stage(await summary(ctx.sales), 'jobs_started').valueCents).toBe(1_050_000);

    // 4. Jobs Completed
    expect((await setStatus('completed')).status).toBe(200);
    s = await summary(ctx.sales);
    expect(stage(s, 'jobs_completed')).toMatchObject({ jobCount: 1, valueCents: 1_050_000 });

    // 5. Invoiced: an invoice for the contract. The stage value is the outstanding balance.
    const inv = (await request(app).post(`${api}/invoices`).set(hdr(ctx.sales)).send({ customerId: ctx.customerId, propertyId: ctx.propertyId, projectId: project.id, estimateId: est, dueDate: '2099-01-01T00:00:00Z', lineItems: [money(1_050_000)], taxRateBps: 0 })).body.data;
    expect(stage(await summary(ctx.sales), 'jobs_completed').jobCount).toBe(1); // a draft invoice does not move the job
    expect((await request(app).post(`${api}/invoices/${inv.id}/send`).set(hdr(ctx.admin))).status).toBe(200);
    s = await summary(ctx.sales);
    expect(stage(s, 'invoiced')).toMatchObject({ jobCount: 1, valueCents: 1_050_000 });
    expect(stage(s, 'jobs_completed').jobCount).toBe(0);

    // partial payment: the stage shows what is still owed
    const pay = (amountCents: number) => request(app).post(`${api}/invoices/${inv.id}/payments`).set(hdr(ctx.admin)).send({ amountCents, method: 'check' });
    expect((await pay(400_000)).status).toBe(201);
    s = await summary(ctx.sales);
    expect(stage(s, 'invoiced')).toMatchObject({ jobCount: 1, valueCents: 650_000 });
    expect(s.totalActiveCents).toBe(650_000);
    const row = (await request(app).get(`${api}/pipeline/jobs?stage=invoiced`).set(hdr(ctx.sales))).body;
    expect(row.data[0]).toMatchObject({ invoicedCents: 1_050_000, paidCents: 400_000, outstandingCents: 650_000, paymentStatus: 'partial' });
    expect(row.totals).toMatchObject({ jobCount: 1, valueCents: 650_000 });

    // 6. Invoices Completed: paid in full, leaves the active pipeline
    expect((await pay(650_000)).status).toBe(201);
    s = await summary(ctx.sales);
    expect(stage(s, 'invoiced').jobCount).toBe(0);
    expect(stage(s, 'invoices_completed')).toMatchObject({ jobCount: 1, valueCents: 1_050_000 });
    expect(stage(s, 'invoices_completed').percentOfActive).toBeNull();
    expect(s.totalActiveCents).toBe(0);
    expect(s.activeJobCount).toBe(0);

    // the job record keeps every move
    const hist = (await request(app).get(`${api}/pipeline/jobs/${job.id}`).set(hdr(ctx.sales))).body.data;
    expect(hist.history.map((h: { to: string }) => h.to)).toEqual(['estimates_out', 'estimates_accepted', 'jobs_started', 'jobs_completed', 'invoiced', 'invoices_completed']);
    expect(hist.history.every((h: { by: string; at: string }) => h.by && h.at)).toBe(true);
    expect(hist.history[0]).toMatchObject({ from: 'none', auto: true });
    expect(await AuditLogModel.countDocuments({ action: 'pipeline.stage_changed' })).toBe(6);
  });

  it('a payment on only one of two invoices does not complete the job', async () => {
    const ctx = await setup();
    const est = await estimate(ctx.sales, ctx, 200_000);
    await send(ctx.sales, est);
    await request(app).post(`${api}/estimates/${est}/accept`).set(hdr(ctx.sales));
    const project = (await request(app).post(`${api}/projects`).set(hdr(ctx.admin)).send({ customerId: ctx.customerId, propertyId: ctx.propertyId, estimateId: est })).body.data;
    for (const st of ['approved', 'scheduled', 'in_progress', 'completed']) await request(app).post(`${api}/projects/${project.id}/status`).set(hdr(ctx.admin)).send({ status: st });
    const mk = async (cents: number) => (await request(app).post(`${api}/invoices`).set(hdr(ctx.sales)).send({ customerId: ctx.customerId, projectId: project.id, estimateId: est, lineItems: [money(cents)], taxRateBps: 0 })).body.data.id as string;
    const [a, b] = [await mk(100_000), await mk(100_000)];
    await request(app).post(`${api}/invoices/${a}/send`).set(hdr(ctx.admin));
    await request(app).post(`${api}/invoices/${b}/send`).set(hdr(ctx.admin));
    await request(app).post(`${api}/invoices/${a}/payments`).set(hdr(ctx.admin)).send({ amountCents: 100_000, method: 'ach' });
    const s = await summary(ctx.sales);
    expect(stage(s, 'invoiced')).toMatchObject({ jobCount: 1, valueCents: 100_000 });
    expect(stage(s, 'invoices_completed').jobCount).toBe(0);
  });

  it('denied estimates are kept, shown separately, excluded from totals, and can be reopened', async () => {
    const ctx = await setup();
    const keep = await estimate(ctx.sales, ctx, 300_000);
    const lose = await estimate(ctx.sales, ctx, 700_000);
    await send(ctx.sales, keep);
    await send(ctx.sales, lose);
    expect((await request(app).post(`${api}/estimates/${lose}/deny`).set(hdr(ctx.sales)).send({ reason: '' })).status).toBe(400); // a reason is required
    const denied = await request(app).post(`${api}/estimates/${lose}/deny`).set(hdr(ctx.sales)).send({ reason: 'Went with another contractor', note: 'Price was 10% lower' });
    expect(denied.status).toBe(200);
    expect(denied.body.data).toMatchObject({ status: 'denied', denialReason: 'Went with another contractor', denialNote: 'Price was 10% lower' });
    expect(denied.body.data.deniedAt).toBeTruthy();
    expect(denied.body.data.statusHistory.at(-1)).toMatchObject({ from: 'sent', to: 'denied' });

    let s = await summary(ctx.sales);
    expect(s.totalActiveCents).toBe(300_000);
    expect(stage(s, 'estimates_out')).toMatchObject({ jobCount: 1, valueCents: 300_000 });
    expect(s.denied).toEqual({ jobCount: 1, valueCents: 700_000 });
    const list = (await request(app).get(`${api}/pipeline/jobs?stage=denied`).set(hdr(ctx.sales))).body;
    expect(list.data).toHaveLength(1);
    expect(list.data[0].denial).toMatchObject({ reason: 'Went with another contractor' });
    expect(await AuditLogModel.countDocuments({ action: 'estimate.denied' })).toBe(1);
    expect((await request(app).post(`${api}/estimates/${lose}/deny`).set(hdr(ctx.sales)).send({ reason: 'again' })).status).toBe(409);

    expect((await request(app).post(`${api}/estimates/${lose}/reopen`).set(hdr(ctx.sales)).send({ reason: 'Customer called back' })).status).toBe(200);
    s = await summary(ctx.sales);
    expect(s.denied.jobCount).toBe(0);
    expect(s.totalActiveCents).toBe(1_000_000);
    expect(await PipelineJobModel.countDocuments({})).toBe(2); // reopening reuses the job, no duplicate
  });

  it('a cancelled project leaves the pipeline', async () => {
    const ctx = await setup();
    const est = await estimate(ctx.sales, ctx, 500_000);
    await send(ctx.sales, est);
    await request(app).post(`${api}/estimates/${est}/accept`).set(hdr(ctx.sales));
    const project = (await request(app).post(`${api}/projects`).set(hdr(ctx.admin)).send({ customerId: ctx.customerId, propertyId: ctx.propertyId, estimateId: est })).body.data;
    expect((await summary(ctx.sales)).totalActiveCents).toBe(500_000);
    await request(app).post(`${api}/projects/${project.id}/status`).set(hdr(ctx.admin)).send({ status: 'cancelled' });
    const s = await summary(ctx.sales);
    expect(s.totalActiveCents).toBe(0);
    expect(s.activeJobCount).toBe(0);
  });

  it('manual moves: administrators only, reason required for exceptions, concurrent moves cannot double move', async () => {
    const ctx = await setup();
    const est = await estimate(ctx.sales, ctx, 100_000);
    await send(ctx.sales, est);
    const job = (await request(app).get(`${api}/pipeline/jobs?stage=estimates_out`).set(hdr(ctx.sales))).body.data[0];
    const move = (t: string, toStage: string, reason = '') => request(app).post(`${api}/pipeline/jobs/${job.id}/move`).set(hdr(t)).send({ toStage, reason });
    expect((await move(ctx.sales, 'estimates_accepted')).status).toBe(403); // salespeople have no manage permission
    const jump = await move(ctx.admin, 'jobs_completed');
    expect(jump.status).toBe(422);
    expect(jump.body.error.code).toBe('REASON_REQUIRED');
    expect((await move(ctx.admin, 'invoices_completed', 'Paid by cash outside the CRM')).status).toBe(200); // exception, recorded
    const hist = (await request(app).get(`${api}/pipeline/jobs/${job.id}`).set(hdr(ctx.admin))).body.data.history;
    expect(hist.at(-1)).toMatchObject({ to: 'invoices_completed', exception: true, auto: false, reason: 'Paid by cash outside the CRM' });
    expect((await move(ctx.admin, 'invoices_completed', 'again')).status).toBe(409);

    // two administrators race to move the job back: exactly one wins
    const results = await Promise.all([move(ctx.admin, 'invoiced', 'Race A'), move(ctx.admin, 'invoiced', 'Race B')]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const after = (await request(app).get(`${api}/pipeline/jobs/${job.id}`).set(hdr(ctx.admin))).body.data.history;
    expect(after.filter((h: { to: string }) => h.to === 'invoiced')).toHaveLength(1);
  });

  it('historical view uses stage history, not the current stage', async () => {
    const ctx = await setup();
    const est = await estimate(ctx.sales, ctx, 100_000);
    await send(ctx.sales, est);
    await request(app).post(`${api}/estimates/${est}/accept`).set(hdr(ctx.sales));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const before = await summary(ctx.sales, `?asOf=${yesterday}`);
    expect(before.activeJobCount).toBe(0);
    expect(before.limitations.join(' ')).toContain('Historical views');
    const now = await summary(ctx.sales, `?asOf=${tomorrow}`);
    expect(stage(now, 'estimates_accepted')).toMatchObject({ jobCount: 1, valueCents: 100_000 });
    // move the job back in time: it was Estimates Out at that moment
    const doc = await PipelineJobModel.findOne({});
    const t0 = new Date('2026-01-01T00:00:00Z');
    await PipelineJobModel.updateOne({ _id: doc!._id }, { $set: { 'history.0.at': t0, 'history.1.at': new Date('2026-01-10T00:00:00Z') } });
    expect(stage(await summary(ctx.sales, '?asOf=2026-01-05'), 'estimates_out').jobCount).toBe(1);
    expect(stage(await summary(ctx.sales, '?asOf=2026-01-12'), 'estimates_accepted').jobCount).toBe(1);
    expect(stage(await summary(ctx.sales, '?asOf=2026-01-12'), 'estimates_out').jobCount).toBe(0);
  });

  it('salespeople see only their customers; filters narrow the totals; drill-down reconciles with the card', async () => {
    const ctx = await setup();
    const est = await estimate(ctx.sales, ctx, 250_000);
    await send(ctx.sales, est);
    const otherCustomer = await CustomerModel.create({ type: 'individual', firstName: 'Zed', lastName: 'Other', ownerId: ctx.otherId });
    const otherProp = await PropertyModel.create({ customerId: otherCustomer._id, address: { line1: '1 Elsewhere Rd', city: 'Dallas', state: 'TX', zip: '75001' } });
    const est2 = await estimate(ctx.other, { customerId: String(otherCustomer._id), propertyId: String(otherProp._id) }, 400_000);
    await send(ctx.other, est2);

    expect((await summary(ctx.sales)).totalActiveCents).toBe(250_000);
    expect((await summary(ctx.other)).totalActiveCents).toBe(400_000);
    const all = await summary(ctx.admin);
    expect(all.totalActiveCents).toBe(650_000);
    expect((await summary(ctx.admin, `?salespersonId=${ctx.salesId}`)).totalActiveCents).toBe(250_000);
    expect((await summary(ctx.admin, '?paymentStatus=paid')).activeJobCount).toBe(0);

    const drill = (await request(app).get(`${api}/pipeline/jobs?stage=estimates_out&sort=value&dir=desc`).set(hdr(ctx.admin))).body;
    expect(drill.data.map((j: { valueCents: number }) => j.valueCents)).toEqual([400_000, 250_000]);
    expect(drill.totals.valueCents).toBe(stage(all, 'estimates_out').valueCents); // table total equals the card
    expect(drill.data[0]).toMatchObject({ customer: { name: 'Zed Other' }, property: { address: '1 Elsewhere Rd, Dallas, TX 75001' }, stageLabel: 'Estimates Out' });
    expect(drill.data[0].salesperson).toBeTruthy();
    const search = (await request(app).get(`${api}/pipeline/jobs?stage=estimates_out&search=elsewhere`).set(hdr(ctx.admin))).body;
    expect(search.data).toHaveLength(1);
    const page = (await request(app).get(`${api}/pipeline/jobs?stage=estimates_out&page=2&pageSize=1`).set(hdr(ctx.admin))).body;
    expect(page.meta).toMatchObject({ page: 2, total: 2 });
    expect((await request(app).get(`${api}/pipeline/summary`)).status).toBe(401);
    expect((await request(app).get(`${api}/pipeline/summary?bogus=1`).set(hdr(ctx.admin))).status).toBe(400);
  });

  it('backfill builds jobs for records that predate the pipeline, with approximate history, and is repeatable', async () => {
    const ctx = await setup();
    const est = await estimate(ctx.sales, ctx, 125_000);
    await send(ctx.sales, est);
    await PipelineJobModel.deleteMany({}); // as if the estimate was sent before this feature existed
    expect((await summary(ctx.admin)).activeJobCount).toBe(0);
    expect((await request(app).post(`${api}/pipeline/backfill`).set(hdr(ctx.sales))).status).toBe(403);
    const r1 = await request(app).post(`${api}/pipeline/backfill`).set(hdr(ctx.admin));
    expect(r1.status).toBe(200);
    expect(r1.body.data.jobs).toBe(1);
    const again = await request(app).post(`${api}/pipeline/backfill`).set(hdr(ctx.admin));
    expect(again.body.data.jobs).toBe(1);
    const s = await summary(ctx.admin);
    expect(stage(s, 'estimates_out')).toMatchObject({ jobCount: 1, valueCents: 125_000 });
    expect(s.limitations.join(' ')).toContain('approximate');
  });
});
