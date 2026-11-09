import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? 'admin123@gmail.com';
const password = process.env.E2E_PASSWORD ?? 'LocalNewPass12!';

test.describe('CRM smoke after auth', () => {
  test('dashboard, leads, customers, calendar open', async ({ page, isMobile }) => {
    // On phones the sidebar is a drawer: open it before using navigation links.
    const openNav = async (): Promise<void> => {
      if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
    };
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await openNav();
    await page.getByRole('link', { name: /^leads$/i }).click();
    await expect(page).toHaveURL(/\/app\/leads/);

    await openNav();
    await page.getByRole('link', { name: /^customers$/i }).click();
    await expect(page).toHaveURL(/\/app\/customers/);

    await openNav();
    await page.getByRole('link', { name: /^calendar$/i }).click();
    await expect(page).toHaveURL(/\/app\/appointments/);

    await page.reload();
    await expect(page).not.toHaveURL(/change-password|login/);
  });
});
