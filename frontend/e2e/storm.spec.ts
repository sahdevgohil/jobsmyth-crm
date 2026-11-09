import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Hail & wind intelligence, end to end. NOAA is never contacted: the e2e API serves the real sample SPC and NCEI files
 * (backend/src/modules/storm/fixtures) and returns one fixed geocode point (Waupun, WI). This proves the workflow works,
 * not that NOAA is reachable from any particular server.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4100/api/v1';
const adminEmail = process.env.DEMO_EMAIL ?? 'admin@demo.legacyroofing.test';
const salesEmail = process.env.DEMO_SALES_EMAIL ?? 'maria.delgado@demo.legacyroofing.test';
const password = process.env.DEMO_PASSWORD ?? 'LegacyDemo!2026';
const tag = Date.now().toString().slice(-6);
const ADDRESS = 'W1234 Test Rd, Waupun, WI 53963';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('Hail & wind intelligence (mock NOAA files and geocoder)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop journey');
  let page: Page;
  let api: APIRequestContext;
  let salesApi: APIRequestContext;
  const ids: Record<string, string> = {};
  const call = async (ctx: APIRequestContext, method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
    const r = await ctx[method](`${API}${path}`, data === undefined ? undefined : { data });
    expect(r.ok(), `${method} ${path} -> ${r.status()} ${await r.text()}`).toBeTruthy();
    return (await r.json()) as { data: Record<string, any> & { id: string } };
  };

  test.beforeAll(async ({ browser, playwright }) => {
    page = await (await browser.newContext()).newPage();
    const tok = async (email: string) => {
      const anon = await playwright.request.newContext();
      return ((await (await anon.post(`${API}/auth/login`, { data: { email, password } })).json()) as { data: { accessToken: string } }).data.accessToken;
    };
    api = await playwright.request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${await tok(adminEmail)}` } });
    salesApi = await playwright.request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${await tok(salesEmail)}` } });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('1 and 2. an administrator imports SPC and NCEI sample data and sees honest progress', async () => {
    await signIn(page, adminEmail);
    await page.goto('/app/storm/imports');
    await expect(page.getByRole('heading', { name: 'Storm data imports' })).toBeVisible();
    await page.getByLabel('SPC from').fill('2024-05-20');
    await page.getByLabel('SPC to').fill('2024-05-20');
    await page.getByRole('button', { name: 'Import range' }).click();
    await expect(page.getByText('SPC import started.')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toContainText('Completed', { timeout: 60_000 });
    await page.getByLabel('Backfill from year').fill('2024');
    await page.getByLabel('Backfill to year').fill('2024');
    await page.getByRole('button', { name: 'Run backfill' }).click();
    await expect(page.getByText('Backfill started.')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toContainText('NCEI', { ignoreCase: true, timeout: 60_000 });
    await expect(page.locator('tbody tr').first()).toContainText('Completed', { timeout: 60_000 });
    // only one year was imported, so the page must NOT say the historical backfill is complete
    await expect(page.getByTestId('ncei-backfill-state')).toContainText('Backfill is NOT complete');
    await expect(page.getByTestId('source-spc')).toContainText('report days imported');
  });

  test('3 to 7. address search with radius, filters and a date of loss', async () => {
    await page.goto('/app/storm');
    await page.getByLabel('Property address').fill(ADDRESS);
    await page.getByLabel('Radius').selectOption('5');
    await page.getByLabel('Date of loss').fill('2024-05-20');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId('storm-results')).toBeVisible();
    await expect(page.getByText('street-address estimate').first()).toBeVisible();
    expect(Number(await page.getByTestId('hail-count').innerText())).toBeGreaterThan(0);
    await expect(page.getByText('1.25 in hail').first()).toBeVisible();
    await expect(page.getByText(/does not show that the property was struck or damaged/).first()).toBeVisible();
    // date-of-loss strip: three days, only the middle one is the loss day
    await expect(page.getByTestId('day-loss')).toContainText('Date of loss');
    await expect(page.getByTestId('day-other')).toHaveCount(2);
    await expect(page.getByText('Day before')).toBeVisible();
    await expect(page.getByText('Day after')).toBeVisible();
    // filters: wind only
    await page.getByLabel('Event type').selectOption('wind');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(async () => Number(await page.getByTestId('hail-count').innerText())).toBe(0);
    // 1 mile is narrower than 5 miles
    await page.getByLabel('Event type').selectOption('hail,wind');
    await page.getByLabel('Radius').selectOption('1');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText(/within 1 mile/).first()).toBeVisible();
  });

  test('8. the storm map loads reports for the visible area with a legend', async () => {
    await page.goto('/app/storm/map');
    await expect(page.getByRole('application', { name: 'Map of hail and wind reports' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Map legend' })).toContainText('Hail report');
    await expect(page.getByRole('list', { name: 'Map legend' })).toContainText('Wind report');
    await page.getByLabel('Go to address').fill(ADDRESS);
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page.getByTestId('map-count')).toContainText(/reports in view/, { timeout: 30_000 });
    await expect.poll(async () => page.locator('.leaflet-marker-icon').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('9 and 10. a manager draws a work zone on the map and assigns a salesperson', async () => {
    await page.goto('/app/storm/zones');
    await page.getByLabel('Zone name').fill(`Waupun ${tag}`);
    await page.getByLabel('Assign to').selectOption({ label: 'Maria Delgado' });
    const map = page.getByRole('application', { name: 'Map for drawing a zone' });
    await expect(map).toBeVisible();
    // centre the zone on the sample reports with the real API, then check the dashboard; the click on the map proves drawing works
    await map.click({ position: { x: 200, y: 150 } });
    await expect(page.getByText(/Centre set/)).toBeVisible();
    await page.getByLabel('Zone radius').fill('20');
    await page.getByRole('button', { name: 'Create zone' }).click();
    await expect(page.getByText(`Zone "Waupun ${tag}" created.`)).toBeVisible();
    // an exact zone on the sample reports for the ranking assertions (the map click above lands somewhere arbitrary)
    const z = await call(api, 'post', '/storm/zones', { name: `Waupun sample ${tag}`, kind: 'radius', center: { lat: 43.63, lng: -88.77 }, radiusMiles: 60, assignedUserId: (await call(salesApi, 'get', '/auth/me')).data.id });
    ids.zone = z.data.id;
    await page.reload();
    await page.getByLabel('Rank by').selectOption('hail');
    const row = page.getByTestId('zone-row').filter({ hasText: `Waupun sample ${tag}` });
    await expect(row).toContainText('in');
    await expect(page.getByTestId('rank-explanation')).toContainText('largest hail');
    await page.getByLabel('Rank by').selectOption('score');
    await row.getByRole('button', { name: `Waupun sample ${tag}` }).click();
    await expect(page.getByText('How the score is calculated.')).toBeVisible();
    await expect(page.getByText(/Assignment history/)).toBeVisible();
  });

  test('11 to 13. a customer record shows storm history and the past-customer follow-up', async () => {
    const c = await call(salesApi, 'post', '/customers', { type: 'individual', firstName: `Storm${tag}`, lastName: 'Customer' });
    ids.customer = c.data.id;
    ids.property = (await call(salesApi, 'post', `/customers/${c.data.id}/properties`, { address: { line1: 'W1234 Test Rd', city: 'Waupun', state: 'WI', zip: '53963' } })).data.id;
    ids.project = (await call(api, 'post', '/projects', { customerId: ids.customer, propertyId: ids.property, projectTypeKey: 'roof_replacement' })).data.id;
    for (const st of ['approved', 'scheduled', 'in_progress', 'completed']) await call(api, 'post', `/projects/${ids.project}/status`, { status: st });
    await call(api, 'patch', `/projects/${ids.project}`, { actualEndAt: '2024-05-01T15:00:00Z' }); // finished before the sample storm
    await page.goto(`/app/customers/${ids.customer}`);
    await page.getByRole('button', { name: /Storm history/ }).or(page.getByRole('tab', { name: /Storm history/ })).first().click();
    await expect(page.getByRole('region', { name: 'Storm history' })).toBeVisible();
    await expect(page.getByTestId('storm-summary')).toContainText(/hail and \d+ wind reports within 3 miles/, { timeout: 30_000 });
    await expect(page.getByText('1.25 in hail').first()).toBeVisible();
    // scan completed jobs for past customers
    await page.goto('/app/storm/alerts');
    await page.getByRole('button', { name: 'Scan completed jobs' }).click();
    await expect(page.getByText(/Scan done: \d+ new flag/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Past customer follow-ups' })).toContainText(`Storm${tag} Customer`);
    await expect(page.getByText('follow-up may be appropriate').first()).toBeVisible();
    await page.getByRole('row', { name: new RegExp(`Storm${tag} Customer`) }).first().getByRole('button', { name: 'Call reminder' }).click();
    await expect(page.getByText('Call reminder created')).toBeVisible();
  });

  test('14 and 15. a new qualifying event raises one territory alert, and syncing again does not repeat it', async () => {
    const rule = await call(api, 'post', '/storm/alerts/rules', { name: `Waupun hail ${tag}`, zoneId: ids.zone, hailMinInches: 1, notifyAssignee: true, channels: { inApp: true, email: true } });
    expect(rule.data.channels.email).toBe(true);
    const count = async () => ((await (await salesApi.get(`${API}/notifications?page=1&pageSize=100`)).json()) as { data: Array<{ type: string }> }).data.filter((n) => n.type === 'storm_alert').length;
    const before = await count();
    await call(api, 'post', '/storm/imports/daily', {}); // the e2e API serves the sample rows as "today's" reports
    await expect.poll(async () => (await call(api, 'get', '/storm/imports')).data.running, { timeout: 60_000 }).toBeNull();
    const after = await count();
    expect(after).toBeGreaterThan(before);
    await call(api, 'post', '/storm/imports/daily', {});
    await expect.poll(async () => (await call(api, 'get', '/storm/imports')).data.running, { timeout: 60_000 }).toBeNull();
    expect(await count()).toBe(after); // no duplicate alerts
    await call(api, 'post', '/storm/alerts/evaluate-recent');
    expect(await count()).toBe(after);
    // history shows what really happened per channel
    await page.goto('/app/storm/alerts');
    await expect(page.getByRole('region', { name: 'Alert history' })).toContainText(`Waupun hail ${tag}`);
    await expect(page.getByRole('region', { name: 'Alert history' })).toContainText('not configured');
    // the representative sees it in the app too
    const sales = await page.context().browser()!.newContext();
    const sp = await sales.newPage();
    await signIn(sp, salesEmail);
    await sp.goto('/app/storm/alerts');
    await expect(sp.getByRole('region', { name: 'Alert history' })).toContainText(`Waupun hail ${tag}`);
    await expect(sp.getByRole('region', { name: 'Alert rules' })).toHaveCount(0); // rules are for managers
    await expect(sp.getByRole('link', { name: 'Storm data imports' })).toHaveCount(0);
    await sales.close();
  });
});
