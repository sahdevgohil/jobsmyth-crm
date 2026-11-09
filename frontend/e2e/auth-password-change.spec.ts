import { expect, test } from '@playwright/test';

/**
 * Forced password-change release flow.
 * Uses LOCAL recovery credentials (see backend/scripts/local-reset-admin-temp.mjs).
 * Does not print credentials.
 */
const email = process.env.E2E_EMAIL ?? 'admin123@gmail.com';
const currentPassword = process.env.E2E_PASSWORD ?? 'LocalTempPass1!';
const newPassword = process.env.E2E_NEW_PASSWORD ?? 'LocalNewPass12!';

test.describe('Forced password change', () => {
  test('login → change password → dashboard → leads → refresh stays authenticated', async ({
    page,
    isMobile,
  }) => {
    const apiCalls: { method: string; url: string; status: number }[] = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/v1/auth/')) {
        apiCalls.push({ method: res.request().method(), url, status: res.status() });
      }
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(currentPassword);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/app\/change-password/);
    await expect(page.getByText(/must set a new password/i)).toBeVisible();

    await page.getByLabel(/current password/i).fill(currentPassword);
    await page.getByLabel(/^new password$/i).fill(newPassword);
    await page.getByLabel(/confirm new password/i).fill(newPassword);

    await page.getByRole('button', { name: /update password/i }).click();

    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({
      timeout: 15_000,
    });

    const changeCall = apiCalls.find((c) => c.url.includes('/password/change') && c.method === 'POST');
    expect(changeCall?.status).toBe(204);

    // On phones the sidebar is a drawer.
    if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('link', { name: /^leads$/i }).click();
    await expect(page).toHaveURL(/\/app\/leads/);

    await page.reload();
    await expect(page).toHaveURL(/\/app\/leads/);
    await expect(page).not.toHaveURL(/change-password/);
  });
});
