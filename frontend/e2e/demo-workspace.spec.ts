import { expect, test, type Page } from '@playwright/test';

/**
 * Requires the demo dataset (`npm run seed:demo -w backend`) and a running backend + frontend.
 * Credentials default to the documented development-only demo admin.
 * Signs in once per project: the API's login rate limiter (kept on purpose) allows few attempts.
 */
const email = process.env.DEMO_EMAIL ?? 'admin@demo.legacyroofing.test';
const password = process.env.DEMO_PASSWORD ?? 'LegacyDemo!2026';

test.describe.configure({ mode: 'serial' });

test.describe('Demo workspace', () => {
  let page: Page;
  const errors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('dashboard shows real seeded metrics', async () => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Revenue overview')).toBeVisible();
    await expect(page.getByText('Lead pipeline')).toBeVisible();
    await expect(page.getByText('Sales performance')).toBeVisible();
    await expect(page.getByText('Recent activity')).toBeVisible();
    const total = await page.getByText('Total leads', { exact: true }).locator('xpath=../..').innerText();
    expect(total).not.toMatch(/\n0\n/);
  });

  test('layout has no horizontal overflow', async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });

  test('kanban: dragging a lead moves it through the real stage-change API', async ({}, info) => {
    test.skip(info.project.name.includes('mobile'), 'desktop drag and drop');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Leads', exact: true }).click();
    await page.getByRole('link', { name: 'Pipeline board' }).click();
    const count = async (stage: string): Promise<number> =>
      Number((await page.getByRole('region', { name: `${stage} stage` }).locator('h2 span').innerText()).trim());
    const newBefore = await count('New');
    const contactedBefore = await count('Contacted');
    const card = page.getByRole('region', { name: 'New stage' }).locator('li[draggable="true"]').first();
    await card.dragTo(page.getByRole('region', { name: 'Contacted stage' }));
    await expect.poll(() => count('Contacted')).toBe(contactedBefore + 1);
    expect(await count('New')).toBe(newBefore - 1);
    // Put it back so the demo data is unchanged.
    await page.getByRole('region', { name: 'Contacted stage' }).locator('li[draggable="true"]').last().dragTo(page.getByRole('region', { name: 'New stage' }));
    await expect.poll(() => count('New')).toBe(newBefore);
  });

  test('every operations page opens without runtime errors', async ({}, info) => {
    test.skip(info.project.name.includes('mobile'), 'sidebar is a drawer on mobile');
    for (const [link, heading] of [
      ['Leads', 'Leads'],
      ['Properties', 'Properties'],
      ['Tasks', 'Tasks'],
      ['Work orders', 'Work orders'],
      ['Subcontractors', 'Subcontractors'],
      ['Invoices', 'Invoices'],
      ['Payments', 'Payments'],
      ['Integrations', 'Integrations'],
    ] as const) {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    // Integrations must never claim a live connection.
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
