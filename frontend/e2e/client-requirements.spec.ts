import { expect, test, type Page } from '@playwright/test';

/**
 * Client-requirements journey (browser): form templates -> price catalog -> customer intake (with consent)
 * -> remodeling inspection (area based) -> OFFLINE edit and automatic sync -> exterior-service (gutter) inspection
 * -> Good/Better/Best quote -> estimate -> internal cost and gross margin.
 *
 * Needs a running backend + frontend and the demo admin (`npm run seed:demo -w backend`).
 */
const adminEmail = process.env.DEMO_EMAIL ?? 'admin@demo.legacyroofing.test';
const adminPassword = process.env.DEMO_PASSWORD ?? 'LegacyDemo!2026';
const tag = Date.now().toString().slice(-7);
const first = `Casey${tag}`;
const last = 'Fieldtest';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function go(page: Page, path: string): Promise<void> {
  // In-app navigation keeps the in-memory session.
  await page.evaluate((p) => {
    history.pushState({}, '', p);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.describe('Client requirements journey', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop journey; mobile layout is checked separately');
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test('staff login', async () => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/^password$/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('default form templates are installed and the builder opens', async () => {
    await go(page, '/app/forms');
    await expect(page.getByRole('heading', { name: 'Form templates' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Roofing inspection/ })).toBeVisible();
    await page.getByRole('link', { name: /Remodeling inspection/ }).click();
    await expect(page.getByRole('heading', { name: /Edit: Remodeling inspection/ })).toBeVisible();
    await expect(page.getByText('Version history')).toBeVisible();
  });

  test('price catalog is a visible DRAFT and subcontractor rates stay internal', async () => {
    await go(page, '/app/price-catalog');
    await expect(page.getByRole('heading', { name: 'Customer price catalog' })).toBeVisible();
    await expect(page.getByText(/Draft, unapproved prices/)).toBeVisible();
    await expect(page.getByText('Good', { exact: true }).first()).toBeVisible();
    await go(page, '/app/rate-cards');
    await expect(page.getByText(/Internal cost document/)).toBeVisible();
  });

  test('customer intake creates customer, property and lead, and stores consent', async () => {
    await go(page, '/app/intake');
    await expect(page.getByRole('heading', { name: 'Customer intake' })).toBeVisible();
    await page.getByLabel(/^First name/).fill(first);
    await page.getByLabel(/^Last name/).fill(last);
    await page.getByLabel(/^Mobile phone/).fill(`512555${tag.slice(-4)}`);
    await page.getByLabel(/^Email/).fill(`casey.${tag}@example.test`);
    await page.getByRole('button', { name: 'Next section' }).click();
    await page.getByLabel('Property address street').fill(`${tag} Fieldtest Way`);
    await page.getByLabel('Property address city').fill('Austin');
    await page.getByLabel('Property address ZIP').fill('78704');
    await page.getByLabel(/^Owner or renter/).selectOption({ label: 'Owner' });
    await page.getByLabel(/^Property type/).selectOption({ label: 'Single-family' });
    await page.getByRole('button', { name: 'Next section' }).click();
    await page.getByRole('group', { name: /Services interested in/ }).getByRole('button', { name: 'Roofing' }).click();
    await page.getByLabel(/^Reason for call/).selectOption({ label: 'Storm damage' });
    await page.getByLabel(/^Lead source/).selectOption({ label: 'Door knock' });
    await page.getByLabel('Assigned representative').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Next section' }).click();
    await page.getByRole('group', { name: /consents to text/ }).getByRole('button', { name: 'Yes' }).click();
    await page.getByRole('button', { name: 'Save intake' }).click();
    await expect(page.getByRole('heading', { name: 'Intake saved' })).toBeVisible();
    await page.getByRole('link', { name: 'Open customer' }).click();
    await expect(page.getByText(`${first} ${last}`).first()).toBeVisible();
  });

  test('remodeling inspection: area based form, saved, then edited OFFLINE and synced automatically', async () => {
    await go(page, '/app/field');
    await expect(page.getByRole('heading', { name: 'Field mode' })).toBeVisible();
    await page.getByRole('button', { name: /Remodeling inspection/ }).click();
    await expect(page.getByRole('heading', { name: 'Remodeling inspection' }).first()).toBeVisible();
    await page.getByRole('combobox', { name: /^Area/ }).selectOption({ label: 'Kitchen' });
    await page.getByRole('button', { name: 'Next section' }).click();
    await page.getByRole('textbox', { name: /^Customer goals/ }).fill('Open the kitchen to the dining room.');
    await page.getByRole('button', { name: /Save (& sync|on device)/ }).click();
    await expect(page.getByText('Synced', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // Lose the connection: the edit must stay on the device.
    await page.context().setOffline(true);
    await page.getByRole('textbox', { name: /^Must-haves/ }).fill('Island with seating; keep the gas range location.');
    await page.getByRole('button', { name: /Save (& sync|on device)/ }).click();
    await expect(page.getByText(/Offline/).first()).toBeVisible();
    await expect(page.getByText(/All changes saved on this device/)).toBeVisible();

    // Connection returns: the queued edit syncs without the user doing anything else.
    await page.context().setOffline(false);
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await page.getByRole('link', { name: 'All field forms' }).click();
    await expect(page.getByText('Synced', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('exterior-service inspection (gutters) and completion is blocked until required items exist', async () => {
    await go(page, '/app/field');
    await page.getByRole('button', { name: /Gutter inspection/ }).click();
    await expect(page.getByRole('heading', { name: 'Gutter inspection' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Complete form' }).click();
    await expect(page.getByText('Finish these before completing:')).toBeVisible();
  });

  test('roofing inspection exposes the required photo checklist', async () => {
    await go(page, '/app/field');
    await page.getByRole('button', { name: /^Roofing inspection/ }).click();
    await expect(page.getByRole('heading', { name: 'Roofing inspection' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Complete form' }).click();
    await expect(page.getByText('Finish these before completing:')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: /Four elevations/ })).toBeVisible();
  });

  test('Good/Better/Best quote becomes an estimate with internal cost and gross margin', async () => {
    await go(page, '/app/quote');
    await expect(page.getByRole('heading', { name: 'Good / Better / Best quote' })).toBeVisible();
    await page.getByRole('radio', { name: /better/i }).click();
    await page.getByLabel('Roof squares').fill('25');
    await page.getByLabel(/^Pitch/).fill('8/12');
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByRole('region', { name: 'Quote result' })).toBeVisible();
    await expect(page.getByText(/Tax/).first()).toBeVisible();
    await page.getByPlaceholder(/search customers/i).fill(first);
    await page.getByRole('button', { name: new RegExp(`${first} ${last}`) }).click();
    await page.getByRole('combobox').last().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Create estimate' }).click();
    await expect(page.getByRole('heading', { name: 'Internal costs and margin' })).toBeVisible({ timeout: 15_000 });
    const cost = page.getByRole('region', { name: 'Internal costs and margin' });
    await cost.getByRole('button', { name: 'Add cost line' }).click();
    await cost.getByLabel('Cost type').selectOption('other');
    await cost.getByLabel('Description').fill('Crew labor (manual)');
    await cost.getByLabel('Quantity').fill('25');
    await cost.getByLabel('Unit cost ($)').fill('85');
    await cost.getByRole('button', { name: 'Save costs' }).click();
    await expect(page.getByText('Costs saved.')).toBeVisible();
    await expect(page.getByText('Gross margin', { exact: true })).toBeVisible();
    await expect(page.getByText(/not markup/)).toBeVisible();
  });
});

test.describe('Field mode on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');
  test('field page has no horizontal overflow and large touch targets', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/^password$/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await go(page, '/app/field');
    await expect(page.getByRole('heading', { name: 'Field mode' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
