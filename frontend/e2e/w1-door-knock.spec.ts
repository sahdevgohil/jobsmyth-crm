import { expect, test } from '@playwright/test';

/**
 * W-1 door-knock lead on mobile viewport (Pixel 5 project also runs this file).
 * Requires E2E_BASE_URL (SPA), E2E_EMAIL, E2E_PASSWORD for a salesperson who can create leads.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('W-1 door-knock lead', () => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD to run UI E2E');

  test('salesperson creates a door-knock lead', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app/);

    await page.goto('/app/leads/new');
    await page.getByLabel(/first name/i).fill('Door');
    await page.getByLabel(/^phone$/i).fill('5125550444');
    await page.getByLabel(/source/i).selectOption({ label: 'Door knocking' });
    await page.getByRole('button', { name: /save lead/i }).click();
    await expect(page).toHaveURL(/\/app\/leads\//);
    await expect(page.getByText(/Door/i).first()).toBeVisible();
  });
});
