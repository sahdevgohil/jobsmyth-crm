import { expect, test } from '@playwright/test';

/**
 * W-2 website intake (API path). Requires a running API with seeded lookups/stages
 * and WEBSITE_LEAD_INTAKE_SECRET matching E2E_INTAKE_SECRET.
 *
 * Skip locally when env is unset so unit CI stays green without staging.
 */
const apiBase = process.env.E2E_API_URL;
const secret = process.env.E2E_INTAKE_SECRET ?? 'test-website-intake-secret!!';

test.describe('W-2 website lead intake', () => {
  test.skip(!apiBase, 'Set E2E_API_URL to run against a live API');

  test('idempotent intake creates one website lead', async ({ request }) => {
    const submissionId = `e2e-${Date.now()}`;
    const first = await request.post(`${apiBase}/api/v1/public/website-leads`, {
      headers: { 'X-Website-Lead-Secret': secret },
      data: {
        submissionId,
        firstName: 'E2E',
        phone: '5125550987',
      },
    });
    expect(first.ok()).toBeTruthy();
    const firstBody = await first.json();
    expect(firstBody.data.created).toBe(true);

    const second = await request.post(`${apiBase}/api/v1/public/website-leads`, {
      headers: { 'X-Website-Lead-Secret': secret },
      data: {
        submissionId,
        firstName: 'E2E',
        phone: '5125550987',
      },
    });
    expect(second.ok()).toBeTruthy();
    const secondBody = await second.json();
    expect(secondBody.data.created).toBe(false);
    expect(secondBody.data.leadId).toBe(firstBody.data.leadId);
  });
});
