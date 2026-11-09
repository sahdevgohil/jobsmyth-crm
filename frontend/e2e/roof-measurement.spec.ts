import { expect, test, type Page } from '@playwright/test';

/**
 * Address -> Google roof data + aerial imagery -> outline and edge review -> field photo -> PDF -> estimate.
 *
 * Runs against a TEST API server whose Google calls return deterministic FIXTURES generated from a synthetic gable roof
 * (backend/scripts/e2e-solar-server.ts). This is NOT a live Google test.
 * Needs the demo seed. Point the frontend at the test API (VITE_API_URL) and set E2E_BASE_URL.
 */
const adminEmail = process.env.DEMO_EMAIL ?? 'admin@demo.legacyroofing.test';
const adminPassword = process.env.DEMO_PASSWORD ?? 'LegacyDemo!2026';
const tag = Date.now().toString().slice(-6);
// 1x1 JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function go(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    history.pushState({}, '', p);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.describe('Professional roof measurement (mock Google responses)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop journey');
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test('sign in and open Measurements', async () => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/^password$/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await go(page, '/app/measurements');
    await expect(page.getByRole('link', { name: 'Measure from address' })).toBeVisible();
  });

  test('integration page: connection is only "Connected" after a real test request', async () => {
    await go(page, '/app/measurements/usage');
    await expect(page.getByTestId('solar-state')).toHaveText(/^(Configuration required|Connected)$/);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByTestId('solar-state')).toHaveText('Connected');
    await expect(page.getByText('Fetch aerial imagery and roof outlines')).toBeVisible();
  });

  test('search an address, pick the customer, and get roof data and imagery', async () => {
    await go(page, '/app/measurements/solar/new');
    await page.getByLabel('Property address').fill(`${tag} Example Ave Austin TX`);
    await page.getByRole('button', { name: 'Look up address (Google)' }).click();
    await page.getByRole('button', { name: new RegExp(`${tag} Example Ave`) }).click();
    await page.getByPlaceholder(/search customers/i).fill('ar');
    await page.locator('section[aria-labelledby="s2"] ul').first().getByRole('button').first().click();
    await page.getByRole('button', { name: 'Get roof measurements' }).click();
    await expect(page.getByRole('heading', { name: 'Measurement', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/app\/measurements\/[0-9a-f]{24}$/);
  });

  test('summary cards, header and provenance', async () => {
    const summary = page.getByRole('region', { name: 'Measurement summary' });
    await expect(summary.getByText('1,155 sq ft').first()).toBeVisible();
    await expect(summary.getByText('11.6 SQ')).toBeVisible();
    await expect(summary.getByText('6/12')).toBeVisible();
    await expect(summary.getByText('0 sq ft', { exact: true })).toBeVisible(); // flat area
    await expect(page.getByText('Outline detected')).toBeVisible();
    await expect(page.getByText('Google Solar').first()).toBeVisible();
    await expect(page.getByText(/Demonstration data/)).toHaveCount(0);
  });

  test('aerial tab shows the real image with attribution; other tabs show vector diagrams with facet IDs', async () => {
    await expect(page.getByRole('img', { name: 'Aerial view of the property' })).toBeVisible();
    await expect(page.getByText(/Aerial imagery © Google/)).toBeVisible();
    await expect(page.getByText(/not an inspection photograph/)).toBeVisible();
    await expect(page.getByText(/Check that the red outline is the right building/)).toBeVisible();
    const natural = await page.getByRole('img', { name: 'Aerial view of the property' }).evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(natural).toBeGreaterThan(100); // a decoded picture, not a placeholder
    for (const [name, text] of [['Roof outline', 'Roof outline'], ['Facets', 'F1'], ['Area', 'square feet'], ['Pitch', '6/12'], ['Edge measurements', 'ft']] as const) {
      await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
      const svg = page.getByRole('img', { name: /diagram$/ });
      await expect(svg).toBeVisible();
      await expect(svg).toContainText(text);
    }
  });

  test('edge review: nothing is verified by default; correcting and verifying are logged and feed the totals', async () => {
    const edges = page.getByRole('region', { name: 'Edge measurements' });
    await expect(edges.getByText('Automatically derived (not verified)').first()).toBeVisible();
    await expect(edges.getByText('Field verified')).toHaveCount(0);
    await edges.getByLabel('Reason for edge changes').fill('Tape measured on site');
    const firstLength = edges.getByLabel(/^Length of E/).first();
    await firstLength.fill('41');
    await edges.getByRole('button', { name: 'Save' }).first().click();
    await expect(edges.getByText(/saved\./)).toBeVisible();
    await edges.getByRole('button', { name: 'Verify all confident edges' }).click();
    await expect(edges.getByText('Confident edges verified')).toBeVisible();
    await expect(edges.getByText('Field verified').first()).toBeVisible();
    await expect(edges.getByText('Manually entered').or(edges.getByText('Field verified (entered by staff)')).first()).toBeVisible();
  });

  test('waste selection drives the material table; edge-based materials use verified edges', async () => {
    const waste = page.getByRole('region', { name: 'Waste and materials' });
    await waste.getByRole('button', { name: 'Select 15% pitched waste' }).click();
    await expect(waste.getByRole('row', { name: /^Use for ordering/ }).first()).toContainText('Selected');
    await waste.getByRole('button', { name: 'Select 14% pitched waste' }).click();
    await expect(waste.getByText('Recommended').first()).toBeVisible();
    await expect(waste.getByText(/^Shingle/).first()).toBeVisible();
    await expect(waste.getByText(/IKO · Cambridge/)).toBeVisible();
    await expect(waste.getByText('Material calculations are estimates and must be verified before ordering')).toBeVisible();
  });

  test('field photo upload by category', async () => {
    const photos = page.getByRole('region', { name: 'Field photos' });
    await photos.getByLabel('Choose photos').setInputFiles({ name: 'front.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(photos.getByText('front.jpg uploaded.')).toBeVisible();
    await expect(photos.getByRole('heading', { name: 'Front elevation (1)' })).toBeVisible();
    await expect(photos.getByText('Not provided').first()).toBeVisible();
    await photos.getByRole('button', { name: 'Verify' }).first().click();
    await expect(photos.getByText('Verified', { exact: true })).toBeVisible();
  });

  test('corrections for counts keep their history', async () => {
    const panel = page.getByRole('region', { name: 'Manual corrections' });
    await panel.getByLabel('Pipe boots', { exact: true }).fill('4');
    await panel.getByLabel('Reason for the change').fill('Counted on site');
    await panel.getByRole('button', { name: 'Save corrections' }).click();
    await expect(page.getByText('Saved. The original provider values are kept.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Change history' }).getByText(/Counted on site/)).toBeVisible();
  });

  test('PDF is generated by the API', async () => {
    const [res, download] = await Promise.all([
      page.waitForResponse((r) => /\/measurements\/solar\/[0-9a-f]{24}\/report/.test(r.url())),
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(Number(res.headers()['content-length'])).toBeGreaterThan(20_000); // aerial image + diagrams, multi-page
    expect(res.headers()['content-disposition']).toContain('attachment');
    expect(download.suggestedFilename()).toMatch(/-Roof-Measurement-Report(-Rev\d+)?\.pdf$/); // address-based, never a generic or id-only name
  });

  test('creates a Good/Better/Best estimate with verified quantities pre-filled', async () => {
    await page.getByRole('link', { name: 'Create estimate' }).click();
    await expect(page.getByRole('region', { name: 'Measurement used' })).toContainText('revision 1');
    await expect(page.getByLabel('Roof squares')).toHaveValue('11.55');
    await expect(page.getByLabel(/^Pitch/)).toHaveValue('6/12');
    const qty = page.getByRole('region', { name: 'Measured quantities' });
    await expect(qty.getByLabel('Drip edge (ft)')).not.toHaveValue(''); // eaves + rakes, verified
    await expect(qty.getByLabel('Pipe boots')).toHaveValue('4');
    await page.getByRole('radio', { name: /better/i }).click();
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByRole('region', { name: 'Quote result' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Quote result' })).toContainText('Drip edge');
    await page.getByRole('button', { name: 'Create estimate' }).click();
    await expect(page).toHaveURL(/\/app\/estimates\/[0-9a-f]{24}/, { timeout: 15_000 });
  });
});

test.describe('Measurement pages on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');
  test('new-measurement, usage, list and detail pages have no horizontal overflow', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/^password$/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const overflow = (): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await go(page, '/app/measurements/solar/new');
    await expect(page.getByRole('heading', { name: 'Measure from address' })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await go(page, '/app/measurements/usage');
    await expect(page.getByRole('heading', { name: 'Measurement integration' })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await go(page, '/app/measurements');
    await expect(page.getByRole('heading', { name: 'Measurements' })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    // Open a measurement made by the desktop journey (or a demo one) and check the detail layout.
    await page.locator('tbody tr a').first().click();
    await expect(page.getByRole('heading', { name: 'Measurement', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Edge measurements' })).toBeVisible({ timeout: 15_000 });
    expect(await overflow()).toBeLessThanOrEqual(1);
  });
});
