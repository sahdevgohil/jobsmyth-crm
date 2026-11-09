import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createUser, seedPhase2Config } from '../../test/phase2-fixtures.js';
import { clearCollections, startTestDb, stopTestDb } from '../../test/setup.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { CompanyModel } from '../companies/company.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { PropertyModel } from '../customers/property.model.js';
import { EstimateModel } from '../estimates/estimate.model.js';
import { grossMarginBps } from './pricing.service.js';

describe('Pricing catalogs, quotes, costs and margin', () => {
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
    await request(app).post('/api/v1/pricing/install-defaults').set(h(admin));
    const catalogs = (await request(app).get('/api/v1/pricing/catalogs').set(h(admin))).body.data as Array<{ id: string; status: string }>;
    const customer = await CustomerModel.create({ type: 'individual', firstName: 'Pat', lastName: 'Owner', ownerId: salesId });
    const property = await PropertyModel.create({ customerId: customer._id, address: { line1: '1 Main', city: 'Austin', state: 'TX', zip: '78701' } });
    return { adminId, salesId, admin, sales, catalogId: catalogs[0]!.id, customerId: String(customer._id), propertyId: String(property._id) };
  }
  const quoteInput = { package: 'better' as const, squares: 25, pitch: '8/12', stories: 2, quantities: { drip_edge_lf: 180, ridge_lf: 60, pipe_boots: 4, leak_barrier_sq: 3 }, permitCents: 25_000 };

  it('installs the client price sheet and subcontractor list as DRAFT / unapproved, idempotently', async () => {
    const { admin, catalogId } = await setup();
    const again = await request(app).post('/api/v1/pricing/install-defaults').set(h(admin));
    expect(again.body.data).toEqual({ catalogCreated: false, rateCardCreated: false });
    const cat = (await request(app).get(`/api/v1/pricing/catalogs/${catalogId}`).set(h(admin))).body.data;
    expect(cat.status).toBe('draft');
    expect(cat.usableForProposals).toBe(false);
    expect(cat.taxRateBps).toBeNull();
    const better = cat.packages.find((p: { key: string }) => p.key === 'better');
    expect(better).toMatchObject({ perSquareLowCents: 52_500, perSquareHighCents: 57_500, workmanshipWarrantyYears: 10, workmanshipWarrantyIsPlaceholder: true, manufacturerWarrantyEligibilityConfirmed: false });
    const shingles = cat.items.find((i: { key: string }) => i.key === 'field_shingles');
    expect(shingles.rates).toEqual({ good: 28_500, better: 33_500, best: 42_000 });
    const cards = (await request(app).get('/api/v1/pricing/rate-cards').set(h(admin))).body.data;
    expect(cards[0].status).toBe('draft');
    expect(cards[0].rates).toHaveLength(33); // 7 shingle pitches + 2 fortified + 1 permit + 6 other shingle + 8 flat + 2 misc + 5 labor items + 2 labor rates
    expect(cards[0].inclusionsNote).toMatch(/materials delivered on the ground and hand loading/);
  });

  it('permissions: sales can read customer prices but not manage, approve, or see any internal cost data', async () => {
    const { sales, admin, catalogId } = await setup();
    expect((await request(app).get('/api/v1/pricing/catalogs').set(h(sales))).status).toBe(200);
    expect((await request(app).patch(`/api/v1/pricing/catalogs/${catalogId}`).set(h(sales)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).post(`/api/v1/pricing/catalogs/${catalogId}/approve`).set(h(sales))).status).toBe(403);
    expect((await request(app).get('/api/v1/pricing/rate-cards').set(h(sales))).status).toBe(403);
    expect((await request(app).put('/api/v1/pricing/estimates/aaaaaaaaaaaaaaaaaaaaaaaa/costs').set(h(sales)).send({ lines: [] })).status).toBe(403);
    expect((await request(app).get('/api/v1/pricing/catalogs')).status).toBe(401);
    // Customer-facing catalog JSON contains no subcontractor rate names.
    const body = JSON.stringify((await request(app).get('/api/v1/pricing/catalogs').set(h(sales))).body);
    expect(body).not.toMatch(/Lifetime Shingles|DensDeck|Sub-Contractor/);
    void admin;
  });

  it('quotes in integer cents, flags draft pricing, and blocks proposals from unapproved catalogs', async () => {
    const { sales, admin, catalogId, customerId, propertyId } = await setup();
    const q = await request(app).post('/api/v1/pricing/quote').set(h(sales)).send({ catalogId, input: quoteInput });
    expect(q.status).toBe(200);
    expect(q.body.data.draftWarning).toMatch(/not approved/);
    expect(q.body.data.rangeLowCents).toBe(25 * 52_500);
    expect(Number.isInteger(q.body.data.totalCents)).toBe(true);
    // steep 7-9 (25 SQ × $35) + two-story (25 SQ × $15) + permit at cost present
    const keys = q.body.data.lines.map((l: { key: string }) => l.key);
    expect(keys).toEqual(expect.arrayContaining(['steep_7_9', 'two_story', 'permit_fees']));

    const est = await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, quote: quoteInput });
    expect(est.status).toBe(201);
    expect(est.body.data.estimate.subtotalCents).toBe(q.body.data.subtotalCents);
    const blocked = await request(app).post('/api/v1/proposals').set(h(sales)).send({ estimateId: est.body.data.estimate.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PRICING_NOT_APPROVED');

    // Approval is admin-only; once approved, a re-priced estimate can become a proposal.
    expect((await request(app).post(`/api/v1/pricing/catalogs/${catalogId}/approve`).set(h(admin))).body.data.status).toBe('approved');
    const est2 = await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, quote: quoteInput });
    expect((await request(app).post('/api/v1/proposals').set(h(sales)).send({ estimateId: est2.body.data.estimate.id })).status).toBe(201);
    // The estimate priced earlier from the draft stays blocked even though the catalog is now approved (snapshot status).
    expect((await request(app).post('/api/v1/proposals').set(h(sales)).send({ estimateId: est.body.data.estimate.id })).status).toBe(409);
  });

  it('price snapshots: editing/approving a new catalog version never changes an issued estimate; expired quotes are blocked', async () => {
    const { sales, admin, catalogId, customerId, propertyId } = await setup();
    await request(app).post(`/api/v1/pricing/catalogs/${catalogId}/approve`).set(h(admin));
    const est = (await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, quote: quoteInput })).body.data.estimate;
    const before = (await request(app).get(`/api/v1/estimates/${est.id}`).set(h(sales))).body.data;

    // Raise every field-shingle rate: approved catalogs are immutable, so a new draft version is created.
    const cat = (await request(app).get(`/api/v1/pricing/catalogs/${catalogId}`).set(h(admin))).body.data;
    const items = cat.items.map((i: { key: string; rates: Record<string, number> }) => (i.key === 'field_shingles' ? { ...i, rates: { good: 30_000, better: 36_000, best: 45_000 } } : i));
    const edited = await request(app).patch(`/api/v1/pricing/catalogs/${catalogId}`).set(h(admin)).send({ items });
    expect(edited.status).toBe(200);
    expect(edited.body.data.id).not.toBe(catalogId);
    expect(edited.body.data.version).toBe(2);
    expect(edited.body.data.status).toBe('draft');
    expect((await request(app).get(`/api/v1/pricing/catalogs/${catalogId}`).set(h(admin))).body.data.items.find((i: { key: string }) => i.key === 'field_shingles').rates.better).toBe(33_500);
    await request(app).post(`/api/v1/pricing/catalogs/${edited.body.data.id}/approve`).set(h(admin));
    const after = (await request(app).get(`/api/v1/estimates/${est.id}`).set(h(sales))).body.data;
    expect(after.lineItems).toEqual(before.lineItems);
    expect(after.totalCents).toBe(before.totalCents);
    // The old version is retired, the new one approved.
    const list = (await request(app).get('/api/v1/pricing/catalogs').set(h(admin))).body.data as Array<{ status: string }>;
    expect(list.map((c) => c.status).sort()).toEqual(['approved', 'retired']);

    // Expiry
    await EstimateModel.updateOne({ _id: est.id }, { $set: { 'pricingSource.priceValidUntil': new Date(Date.now() - 86_400_000).toISOString() } });
    const exp = await request(app).post('/api/v1/proposals').set(h(sales)).send({ estimateId: est.id });
    expect(exp.status).toBe(409);
    expect(exp.body.error.code).toBe('PRICE_EXPIRED');
  });

  it('cost sheet: subcontractor costs from the rate card, gross margin (not markup), overrides audited, ranges enforced', async () => {
    const { sales, admin, catalogId, customerId, propertyId } = await setup();
    const est = (await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, quote: { ...quoteInput, discountCents: 50_000 } })).body.data.estimate;
    const card = (await request(app).get('/api/v1/pricing/rate-cards').set(h(admin))).body.data[0] as { id: string };
    const lines = [
      { kind: 'subcontractor', quantity: 25, rateCardId: card.id, rateKey: 'shingle_8_12' }, // $85/SQ
      { kind: 'subcontractor', quantity: 25, rateCardId: card.id, rateKey: 'other_two_story' }, // $5/SQ
      { kind: 'material', description: 'Shingles', unit: 'SQ', quantity: 27, unitCostCents: 9_500 },
      { kind: 'other', description: 'Dumpster', unit: 'ea', quantity: 1, unitCostCents: 45_000 },
    ];
    const saved = await request(app).put(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(admin)).send({ lines });
    expect(saved.status).toBe(200);
    const d = saved.body.data;
    expect(d.subcontractorCostCents).toBe(25 * 8_500 + 25 * 500);
    expect(d.materialCostCents).toBe(27 * 9_500);
    expect(d.totalCostCents).toBe(d.subcontractorCostCents + d.materialCostCents + 45_000);
    const selling = est.subtotalCents - 50_000; // revenue = subtotal - discount (tax excluded)
    expect(d.sellingPriceCents).toBe(selling);
    expect(d.grossProfitCents).toBe(selling - d.totalCostCents);
    expect(d.marginBps).toBe(Math.round(((selling - d.totalCostCents) * 10_000) / selling));
    // Gross margin differs from markup (profit / cost).
    expect(d.marginBps).not.toBe(Math.round((d.grossProfitCents * 10_000) / d.totalCostCents));
    expect(grossMarginBps(0, 100)).toBeNull();
    expect(grossMarginBps(10_000, 7_500)).toBe(2_500);

    // Override a catalog rate: reason required, then audited.
    const noReason = await request(app).put(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(admin)).send({ lines: [{ kind: 'subcontractor', quantity: 25, rateCardId: card.id, rateKey: 'shingle_8_12', unitCostCents: 9_000 }] });
    expect(noReason.status).toBe(422);
    const ok = await request(app).put(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(admin)).send({ lines: [{ kind: 'subcontractor', quantity: 25, rateCardId: card.id, rateKey: 'shingle_8_12', unitCostCents: 9_000, overridden: true, overrideReason: 'Hail repair premium' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.lines[0].overridden).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'cost.rate_override' })).toBe(1);
    // Range rate (demo fireplace $300–$500) must stay inside the source range.
    const range = (cents: number) => request(app).put(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(admin)).send({ lines: [{ kind: 'subcontractor', quantity: 1, rateCardId: card.id, rateKey: 'labor_demo_fireplace', unitCostCents: cents }] });
    expect((await range(60_000)).status).toBe(422);
    expect((await range(40_000)).status).toBe(200);
    // Readable again by admin; never by sales.
    expect((await request(app).get(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(admin))).status).toBe(200);
    expect((await request(app).get(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(sales))).status).toBe(403);
  });

  it('internal costs never appear in estimate, proposal or portal responses', async () => {
    const { sales, admin, catalogId, customerId, propertyId } = await setup();
    await request(app).post(`/api/v1/pricing/catalogs/${catalogId}/approve`).set(h(admin));
    const est = (await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, quote: quoteInput })).body.data.estimate;
    const card = (await request(app).get('/api/v1/pricing/rate-cards').set(h(admin))).body.data[0] as { id: string };
    await request(app).put(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(admin)).send({ lines: [{ kind: 'subcontractor', quantity: 25, rateCardId: card.id, rateKey: 'shingle_8_12' }] });
    const prop = await request(app).post('/api/v1/proposals').set(h(sales)).send({ estimateId: est.id });
    for (const res of [await request(app).get(`/api/v1/estimates/${est.id}`).set(h(sales)), await request(app).get(`/api/v1/estimates/${est.id}/preview`).set(h(sales)), prop]) {
      const text = JSON.stringify(res.body) + (res.text ?? '');
      expect(text).not.toMatch(/subcontractorCost|grossProfit|marginBps|shingle_8_12|Lifetime Shingles|totalCostCents/);
    }
  });

  it('isolates companies: other companies cannot see catalogs, rate cards or cost sheets', async () => {
    const { admin, catalogId, customerId, propertyId, sales } = await setup();
    const est = (await request(app).post('/api/v1/pricing/estimates').set(h(sales)).send({ catalogId, customerId, propertyId, quote: quoteInput })).body.data.estimate;
    const other = await CompanyModel.create({ name: 'Other Co', slug: 'other' });
    await createUser({ email: 'o@example.com', role: 'admin', companyId: String(other._id) });
    const o = await login('o@example.com');
    expect((await request(app).get('/api/v1/pricing/catalogs').set(h(o))).body.data).toEqual([]);
    expect((await request(app).get(`/api/v1/pricing/catalogs/${catalogId}`).set(h(o))).status).toBe(404);
    expect((await request(app).get('/api/v1/pricing/rate-cards').set(h(o))).body.data).toEqual([]);
    expect((await request(app).get(`/api/v1/pricing/estimates/${est.id}/costs`).set(h(o))).status).toBe(404);
    expect((await request(app).post(`/api/v1/pricing/catalogs/${catalogId}/approve`).set(h(o))).status).toBe(404);
    expect((await request(app).post('/api/v1/pricing/quote').set(h(o)).send({ catalogId, input: quoteInput })).status).toBe(404);
    void admin;
  });
});
