import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDemoOps, writeDemoOps, DEFAULT_DEMO_PASSWORD } from '../../../scripts/lib/demo-runner.js';
import { createApp } from '../../app.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { InvoiceModel, PaymentModel } from '../invoices/invoice.model.js';
import { LeadModel } from '../leads/lead.model.js';

describe('Dashboard on the demo dataset', () => {
  let app: ReturnType<typeof createApp>;
  const range = `from=${encodeURIComponent(new Date(Date.now() - 365 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`;

  async function token(email: string): Promise<string> {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: DEFAULT_DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    await startTestDb();
    await clearCollections();
    app = createApp();
    await writeDemoOps(await prepareDemoOps());
  }, 180_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('admin dashboard matches independent queries and is non-empty', async () => {
    const t = await token('admin@demo.legacyroofing.test');
    const res = await request(app).get(`/api/v1/analytics/dashboard?${range}`).set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.isEmpty).toBe(false);
    expect(d.tiles.totalLeads).toBe(await LeadModel.countDocuments());
    expect(d.tiles.totalCustomers).toBe(20);
    expect(d.tiles.convertedLeads).toBe(7);
    expect(d.tiles.activeProjects).toBe(5); // planning, scheduled, in_progress, on_hold, quality_review
    expect(d.tiles.upcomingAppointments).toBeGreaterThan(0);
    expect(d.tiles.overdueFollowUps).toBeGreaterThan(0);
    expect(d.pipeline.reduce((s: number, p: { count: number }) => s + p.count, 0)).toBe(36);
    expect(d.salesPerformance).toHaveLength(3);
    expect(d.recentActivities.length).toBeGreaterThan(5);
    expect(d.schedule.today.length).toBeGreaterThan(0);
  });

  it('finance totals equal invoice and payment data (integer cents)', async () => {
    const t = await token('admin@demo.legacyroofing.test');
    const res = await request(app).get(`/api/v1/analytics/dashboard?${range}`).set('Authorization', `Bearer ${t}`);
    const live = await InvoiceModel.find({ status: { $nin: ['void', 'draft'] } });
    const invoiced = live.reduce((s, i) => s + i.totalCents, 0);
    const paid = live.reduce((s, i) => s + i.amountPaidCents, 0);
    const payments = await PaymentModel.find({ status: 'recorded' });
    expect(paid).toBe(payments.reduce((s, p) => s + p.amountCents, 0));
    expect(res.body.data.revenue.invoicedCents).toBe(invoiced);
    expect(res.body.data.revenue.collectedCents).toBe(paid);
    expect(res.body.data.revenue.outstandingCents).toBe(invoiced - paid);
    expect(res.body.data.tiles.outstandingInvoicesCents).toBe(invoiced - paid);
    const trendCollected = res.body.data.revenue.trend.reduce((s: number, p: { collectedCents: number }) => s + p.collectedCents, 0);
    expect(trendCollected).toBe(paid);
  });

  it('salesperson only sees their own leads, customers and schedule', async () => {
    const t = await token('maria.delgado@demo.legacyroofing.test');
    const admin = await token('admin@demo.legacyroofing.test');
    const mine = await request(app).get(`/api/v1/analytics/dashboard?${range}`).set('Authorization', `Bearer ${t}`);
    const all = await request(app).get(`/api/v1/analytics/dashboard?${range}`).set('Authorization', `Bearer ${admin}`);
    expect(mine.body.data.tiles.totalLeads).toBeLessThan(all.body.data.tiles.totalLeads);
    expect(mine.body.data.tiles.totalLeads).toBeGreaterThan(0);
    expect(mine.body.data.salesPerformance).toHaveLength(1);
    expect(mine.body.data.revenue.invoicedCents).toBeLessThan(all.body.data.revenue.invoicedCents);
  });

  it('seeding twice does not duplicate records (idempotent)', async () => {
    const before = await LeadModel.countDocuments();
    await writeDemoOps(await prepareDemoOps());
    expect(await LeadModel.countDocuments()).toBe(before);
  });
});
