import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Pipeline dashboard, end to end: one estimate is sent, accepted, started, completed, invoiced, part paid and fully paid,
 * and the dashboard is checked at every step. A second estimate is denied. Runs against the e2e API (backend/scripts/e2e-solar-server.ts)
 * on a database that has the demo seed. Amounts are asserted as changes from whatever the database already held.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4100/api/v1';
const email = process.env.DEMO_EMAIL ?? 'admin@demo.legacyroofing.test';
const password = process.env.DEMO_PASSWORD ?? 'LegacyDemo!2026';
const tag = Date.now().toString().slice(-6);
const usd = (cents: number): string => `$${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

type Summary = { totalActiveCents: number; activeJobCount: number; denied: { jobCount: number; valueCents: number }; stages: Array<{ stage: string; jobCount: number; valueCents: number }> };

test.describe('Pipeline dashboard (real API, real database)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop journey');
  let page: Page;
  let api: APIRequestContext;
  let before: Summary;
  const ids: Record<string, string> = {};

  const call = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
    const r = await api[method](`${API}${path}`, data === undefined ? undefined : { data });
    expect(r.ok(), `${method} ${path} -> ${r.status()} ${await r.text()}`).toBeTruthy();
    return (await r.json()) as { data: Record<string, unknown> & { id: string } };
  };
  const summary = async (): Promise<Summary> => ((await (await api.get(`${API}/pipeline/summary`)).json()) as { data: Summary }).data;
  const stage = (s: Summary, k: string) => s.stages.find((x) => x.stage === k)!;
  const item = (cents: number) => ({ description: 'Roof replacement', kind: 'labor', quantity: 1, unit: 'ea', unitCostCents: cents });

  test.beforeAll(async ({ browser, playwright }) => {
    page = await (await browser.newContext()).newPage();
    const anon = await playwright.request.newContext();
    const login = await anon.post(`${API}/auth/login`, { data: { email, password } });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    api = await playwright.request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    await call('post', '/pipeline/backfill'); // pick up the demo estimates and projects so "before" is accurate
    before = await summary();
  });
  test.afterAll(async () => { await page.context().close(); });

  async function open(): Promise<void> {
    await page.goto('/app/pipeline');
    await expect(page.getByRole('heading', { name: 'Legacy Construction Group — Pipeline Dashboard' })).toBeVisible();
  }
  const card = (k: string) => page.getByTestId(`stage-${k}`);

  test('setup: customer, property and two estimates, signed in as an administrator', async () => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const c = await call('post', '/customers', { type: 'individual', firstName: `Pipe${tag}`, lastName: 'Tester', email: `pipe${tag}@example.com` });
    ids.customer = c.data.id;
    ids.property = (await call('post', `/customers/${c.data.id}/properties`, { address: { line1: `${tag} Pipeline Ave`, city: 'Austin', state: 'TX', zip: '78701' } })).data.id;
    ids.est = (await call('post', '/estimates', { customerId: ids.customer, propertyId: ids.property, lineItems: [item(1_000_000)], taxRateBps: 0 })).data.id;
    ids.estDenied = (await call('post', '/estimates', { customerId: ids.customer, propertyId: ids.property, lineItems: [item(400_000)], taxRateBps: 0 })).data.id;
  });

  test('the dashboard shows six stages in order, the banner, the explanation and the real total', async () => {
    await open();
    const labels = ['Estimates Out', 'Estimates Accepted', 'Jobs Started', 'Jobs Completed', 'Invoiced', 'Invoices Completed'];
    const cards = page.locator('[data-testid^="stage-"][aria-pressed]');
    await expect(cards).toHaveCount(6);
    for (const [i, l] of labels.entries()) await expect(cards.nth(i)).toContainText(l);
    await expect(page.getByText('Every job sits in exactly one stage. When a job moves forward, its dollar amount moves with it.')).toBeVisible();
    await expect(page.getByTestId('total-pipeline')).toHaveText(usd(before.totalActiveCents));
    await expect(page.getByText(/Total active pipeline = Estimates Out/)).toBeVisible();
  });

  test('1. sent estimate appears in Estimates Out, drafts do not', async () => {
    await call('patch', `/estimates/${ids.est}`, { status: 'sent' });
    await call('patch', `/estimates/${ids.estDenied}`, { status: 'sent' });
    const s = await summary();
    expect(stage(s, 'estimates_out').valueCents).toBe(stage(before, 'estimates_out').valueCents + 1_400_000);
    await open();
    await expect(card('estimates_out')).toContainText(usd(stage(s, 'estimates_out').valueCents));
    await card('estimates_out').click();
    await page.getByLabel('Search jobs').fill(`${tag} Pipeline`);
    const row = page.locator('tbody tr', { hasText: `Pipe${tag} Tester` });
    await expect(row).toHaveCount(2);
    await expect(page.getByTestId('stage-total')).toContainText(usd(1_400_000));
  });

  test('17. denying an estimate from its page moves it to Denied and out of the active total', async () => {
    await page.goto(`/app/estimates/${ids.estDenied}`);
    await page.getByRole('button', { name: 'Mark denied' }).click();
    await page.getByLabel('Reason for denial').fill('Chose another contractor');
    await page.getByLabel('Customer note').fill('Price was lower elsewhere');
    await page.getByRole('button', { name: 'Confirm denial' }).click();
    await expect(page.getByText('Estimate marked denied.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Denied estimate' })).toContainText('Chose another contractor');
    const s = await summary();
    expect(s.denied.valueCents).toBe(before.denied.valueCents + 400_000);
    expect(stage(s, 'estimates_out').valueCents).toBe(stage(before, 'estimates_out').valueCents + 1_000_000);
    await open();
    await expect(page.getByTestId('denied-summary')).toContainText(usd(s.denied.valueCents));
    await page.getByTestId('stage-denied').click();
    await page.getByLabel('Search jobs').fill(`${tag} Pipeline`);
    const row = page.locator('tbody tr', { hasText: `Pipe${tag} Tester` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Chose another contractor');
    await expect(row).toContainText(usd(400_000));
  });

  test('2. accepting the estimate moves its amount to Estimates Accepted', async () => {
    await page.goto(`/app/estimates/${ids.est}`);
    await page.getByRole('button', { name: 'Mark accepted' }).click();
    await expect(page.getByText('Estimate accepted.')).toBeVisible();
    const s = await summary();
    expect(stage(s, 'estimates_out').valueCents).toBe(stage(before, 'estimates_out').valueCents);
    expect(stage(s, 'estimates_accepted').valueCents).toBe(stage(before, 'estimates_accepted').valueCents + 1_000_000);
    expect(s.totalActiveCents).toBe(before.totalActiveCents + 1_000_000);
    await open();
    await expect(page.getByTestId('total-pipeline')).toHaveText(usd(s.totalActiveCents));
    await expect(card('estimates_accepted')).toContainText(usd(stage(s, 'estimates_accepted').valueCents));
  });

  test('3 and 4. starting and completing the job move the amount, never duplicating it', async () => {
    ids.project = (await call('post', '/projects', { customerId: ids.customer, propertyId: ids.property, estimateId: ids.est, projectTypeKey: 'roof_replacement' })).data.id;
    for (const st of ['approved', 'scheduled', 'in_progress']) await call('post', `/projects/${ids.project}/status`, { status: st });
    let s = await summary();
    expect(stage(s, 'jobs_started').valueCents).toBe(stage(before, 'jobs_started').valueCents + 1_000_000);
    expect(stage(s, 'estimates_accepted').valueCents).toBe(stage(before, 'estimates_accepted').valueCents);
    expect(s.totalActiveCents).toBe(before.totalActiveCents + 1_000_000);
    await call('post', `/projects/${ids.project}/status`, { status: 'completed' });
    s = await summary();
    expect(stage(s, 'jobs_completed').valueCents).toBe(stage(before, 'jobs_completed').valueCents + 1_000_000);
    expect(stage(s, 'jobs_started').valueCents).toBe(stage(before, 'jobs_started').valueCents);
    expect(s.totalActiveCents).toBe(before.totalActiveCents + 1_000_000);
    await open();
    await expect(card('jobs_completed')).toContainText(usd(stage(s, 'jobs_completed').valueCents));
  });

  test('5 to 7. invoicing shows the outstanding balance, and a part payment reduces it', async () => {
    ids.invoice = (await call('post', '/invoices', { customerId: ids.customer, propertyId: ids.property, projectId: ids.project, estimateId: ids.est, dueDate: '2099-01-01T00:00:00Z', lineItems: [item(1_000_000)], taxRateBps: 0 })).data.id;
    await call('post', `/invoices/${ids.invoice}/send`);
    let s = await summary();
    expect(stage(s, 'invoiced').valueCents).toBe(stage(before, 'invoiced').valueCents + 1_000_000);
    await call('post', `/invoices/${ids.invoice}/payments`, { amountCents: 350_000, method: 'check' });
    s = await summary();
    expect(stage(s, 'invoiced').valueCents).toBe(stage(before, 'invoiced').valueCents + 650_000);
    expect(s.totalActiveCents).toBe(before.totalActiveCents + 650_000);
    await open();
    await expect(card('invoiced')).toContainText(usd(stage(s, 'invoiced').valueCents));
    await card('invoiced').click();
    await page.getByLabel('Search jobs').fill(`${tag} Pipeline`);
    const row = page.locator('tbody tr', { hasText: `Pipe${tag} Tester` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(usd(1_000_000)); // invoiced
    await expect(row).toContainText(usd(350_000)); // paid
    await expect(row).toContainText(usd(650_000)); // balance due
    await expect(page.getByTestId('stage-total')).toContainText(usd(650_000));
  });

  test('8 to 11. paying the rest completes the invoices and the job leaves the active pipeline', async () => {
    await call('post', `/invoices/${ids.invoice}/payments`, { amountCents: 650_000, method: 'ach' });
    const s = await summary();
    expect(stage(s, 'invoiced').valueCents).toBe(stage(before, 'invoiced').valueCents);
    expect(stage(s, 'invoices_completed').valueCents).toBe(stage(before, 'invoices_completed').valueCents + 1_000_000);
    expect(s.totalActiveCents).toBe(before.totalActiveCents); // back to where it started: nothing active from this job
    await open();
    await expect(page.getByTestId('total-pipeline')).toHaveText(usd(before.totalActiveCents));
    await card('invoices_completed').click();
    await page.getByLabel('Search jobs').fill(`${tag} Pipeline`);
    const row = page.locator('tbody tr', { hasText: `Pipe${tag} Tester` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(usd(1_000_000));
    await row.getByRole('button', { name: 'History' }).click();
    const steps = page.locator('tbody ol li');
    await expect(steps).toHaveCount(6);
    for (const [i, name] of ['Estimates out', 'Estimates accepted', 'Jobs started', 'Jobs completed', 'Invoiced', 'Invoices completed'].entries()) await expect(steps.nth(i)).toContainText(name);
  });

  test('filters narrow the dashboard and the as-of date shows history', async () => {
    await open();
    const before2 = await page.getByTestId('total-pipeline').innerText();
    await page.getByLabel('Payment status').selectOption('overdue');
    const overdue = ((await (await api.get(`${API}/pipeline/summary?paymentStatus=overdue`)).json()) as { data: Summary }).data;
    await expect(page.getByTestId('total-pipeline')).toHaveText(usd(overdue.totalActiveCents)); // the filter is applied by the backend
    await page.getByLabel('Payment status').selectOption('');
    await expect(page.getByTestId('total-pipeline')).toHaveText(before2);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('View as of').fill(yesterday);
    await expect(page.getByText(/Showing the pipeline as it stood on/)).toBeVisible();
    await expect(page.getByText(/Historical views use stage history/)).toBeVisible();
  });
});
