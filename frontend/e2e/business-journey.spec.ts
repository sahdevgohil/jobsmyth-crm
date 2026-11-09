import { expect, test, type Page } from '@playwright/test';

/**
 * Browser-driven business journey on isolated records (unique tag per run):
 * login -> lead -> assignment -> conversion -> customer/property -> appointment -> inspection (+photo)
 * -> measurement -> estimate -> proposal -> approval -> project -> task -> work order -> invoice
 * -> partial payment -> balance -> customer portal -> ownership isolation.
 *
 * Needs a running backend + frontend and the demo admin (`npm run seed:demo -w backend`).
 * No external providers are used. Signs in once for staff and once for the portal.
 */
const adminEmail = process.env.DEMO_EMAIL ?? 'admin@demo.legacyroofing.test';
const adminPassword = process.env.DEMO_PASSWORD ?? 'LegacyDemo!2026';
const tag = Date.now().toString().slice(-7);
const first = `Pat${tag}`;
const last = 'Journey';
const fullName = `${first} ${last}`;
const portalEmail = `portal.${tag}@example.test`;
const portalTemp = 'TempPortalPass1!';
const portalNew = 'PortalNewPass12!';
const apptDay = `2027-0${1 + (Number(tag) % 9)}-${String(10 + (Number(tag) % 15))}`;

test.describe.configure({ mode: 'serial', timeout: 90_000 });

async function go(page: Page, path: string): Promise<void> {
  // In-app navigation keeps the in-memory session (a full reload would depend on the refresh cookie).
  await page.evaluate((p) => {
    history.pushState({}, '', p);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function pickCustomer(page: Page): Promise<void> {
  await page.getByPlaceholder(/search customers/i).fill(first);
  await page.getByRole('button', { name: new RegExp(fullName) }).click();
}

test.describe('Lead to payment (browser)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop journey');
  let page: Page;
  let customerUrl = '';
  let invoiceUrl = '';
  let otherInvoiceId = '';

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

  test('lead creation, assignment and conversion', async () => {
    await go(page, '/app/leads/new');
    await page.getByLabel('First name').fill(first);
    await page.getByLabel('Last name').fill(last);
    await page.getByLabel('Phone').fill('5125550188');
    await page.getByLabel('Email').fill(`pat.${tag}@example.test`);
    await page.getByLabel('Priority').selectOption('high');
    await page.getByLabel('Address').fill(`${tag} Journey Ln`);
    await page.getByLabel('City').fill('Austin');
    await page.getByLabel('ZIP').fill('78701');
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Save lead' }).click();
    // Possible-duplicate confirm dialogs are accepted automatically.
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();

    // Assignment (admin): reassign to a salesperson.
    const assign = page.getByLabel('Reassign lead');
    await expect(assign).toBeVisible();
    const current = await assign.inputValue();
    const values = await assign.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(values.length).toBeGreaterThan(1);
    await assign.selectOption(values.find((v) => v !== current) as string);
    await page.getByRole('button', { name: 'Assign' }).click();

    // Conversion.
    await page.getByRole('button', { name: 'Convert' }).click();
    await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f]{24}/);
    customerUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
  });

  test('customer workspace shows the property and related lead', async () => {
    await page.getByRole('tab', { name: /^Properties/ }).click();
    await expect(page.getByText(`${tag} Journey Ln`)).toBeVisible();
    await page.getByRole('tab', { name: /^Leads/ }).click();
    await expect(page.getByRole('link', { name: new RegExp(fullName) })).toBeVisible();
  });

  test('appointment, inspection with photo, measurement', async () => {
    await go(page, `/app/appointments/new?date=${apptDay}`);
    await pickCustomer(page);
    await page.getByLabel('Property').selectOption({ index: 1 });
    await page.getByLabel('Title').fill(`Roof inspection ${tag}`);
    await page.getByRole('button', { name: 'Create appointment' }).click();
    await expect(page.getByRole('heading', { name: `Roof inspection ${tag}` })).toBeVisible();

    await page.getByRole('link', { name: 'Start inspection' }).click();
    await page.getByLabel('Property').selectOption({ index: 1 }).catch(() => undefined);
    await page.getByRole('button', { name: 'Create inspection' }).click();
    await expect(page.getByRole('heading', { name: /inspection/i }).first()).toBeVisible();
    await page.getByLabel('Total area (sq ft)').fill('2400');
    await page.getByLabel('Pitch').fill('6/12');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Photo upload (validation + secure storage).
    await page.getByLabel('Choose file').setInputFiles({
      name: 'north-slope.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]),
    });
    await expect(page.getByText('north-slope.jpg')).toBeVisible();
    // A disallowed type is rejected client-side before upload.
    await page.getByLabel('Choose file').setInputFiles({ name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await expect(page.getByRole('alert')).toContainText(/unsupported file type/i);

    await page.getByRole('button', { name: 'Mark completed' }).click();
    await expect(page.getByText(/completed/i).first()).toBeVisible();

    await go(page, '/app/measurements/new');
    await pickCustomer(page);
    await page.getByLabel('Property').selectOption({ index: 1 });
    await page.getByLabel('Total area').fill('2400');
    await page.getByLabel('Pitch').fill('6/12');
    await page.getByRole('button', { name: 'Save measurement' }).click();
    await expect(page).toHaveURL(/\/app\/measurements\/[0-9a-f]{24}/);
  });

  test('estimate, proposal creation and approval', async () => {
    await go(page, '/app/estimates/new');
    await pickCustomer(page);
    await page.getByLabel('Property').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.locator('input[id$="-desc"]').first().fill('Roof replacement package');
    await page.locator('input[id$="-unitDollars"]').first().fill('10000');
    await page.getByLabel('Tax rate (%)').fill('8.25');
    await page.getByRole('button', { name: 'Create estimate' }).click();
    await expect(page).toHaveURL(/\/app\/estimates\/[0-9a-f]{24}/);
    // Server-calculated total: 10,000.00 + 8.25% tax.
    await expect(page.getByText('$10,825.00').first()).toBeVisible();

    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page).toHaveURL(/\/app\/proposals\/[0-9a-f]{24}/);
    await page.getByRole('button', { name: 'Send proposal' }).click();
    await expect(page.getByText(/not claimed as delivered|not_configured|not configured/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page.getByText(/accepted/i).first()).toBeVisible();
  });

  test('project, task and work order', async () => {
    await page.getByRole('link', { name: 'Create project from proposal' }).click();
    // The form opens prefilled with the customer, property and accepted proposal.
    await expect(page.getByLabel('Accepted proposal (optional)')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f]{24}/);
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await page.getByLabel('New task').fill('Order materials');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('Order materials')).toBeVisible();
    await page.getByRole('tab', { name: 'Work orders' }).click();
    await page.getByLabel('New work order').fill('Tear-off and disposal');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Tear-off and disposal')).toBeVisible();
  });

  test('invoice and partial payment with correct balance', async () => {
    await page.getByRole('link', { name: 'Create invoice' }).click();
    await page.getByLabel('Amount (USD)').fill('1000.00');
    await page.getByLabel('Line description').fill('Deposit');
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f]{24}/);
    invoiceUrl = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Send invoice' }).click();
    await expect(page.getByText(/Sent\./)).toBeVisible();

    await page.getByLabel('Amount (USD)').fill('400.00');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Manual payment recorded.')).toBeVisible();
    await expect(page.getByText('Balance due').locator('..')).toContainText('$600.00');
    await expect(page.getByText('Partially paid')).toBeVisible();
  });

  test('customer portal account, login and ownership isolation', async ({ browser }) => {
    await go(page, customerUrl);
    await page.getByLabel('Portal email').fill(portalEmail);
    await page.getByLabel('Temporary password').fill(portalTemp);
    await page.getByRole('button', { name: 'Create portal account' }).click();
    await expect(page.getByText(portalEmail)).toBeVisible();
    await expect(page.getByText(/Temporary/)).toBeVisible();

    // Find a seeded invoice that belongs to somebody else.
    await go(page, '/app/invoices');
    const href = await page.getByRole('link', { name: /^INV-\d{4}-D\d+/ }).first().getAttribute('href');
    otherInvoiceId = (href ?? '').split('/').pop() ?? '';
    expect(otherInvoiceId).toMatch(/^[0-9a-f]{24}$/);

    const portal = await (await browser.newContext()).newPage();
    await portal.goto('/portal/login');
    await portal.getByLabel(/email/i).fill(portalEmail);
    await portal.getByLabel(/^password$/i).fill(portalTemp);
    await portal.getByRole('button', { name: /sign in/i }).click();
    await expect(portal).toHaveURL(/change-password/);
    await portal.getByLabel(/current password/i).fill(portalTemp);
    await portal.getByLabel(/^new password/i).fill(portalNew);
    await portal.getByRole('button', { name: /update password|change password|save/i }).click();
    await expect(portal).not.toHaveURL(/change-password/);
    await expect(portal.getByRole('heading', { name: /welcome|portal|dashboard/i }).first()).toBeVisible();

    await portal.getByRole('navigation').getByRole('link', { name: 'Invoices' }).click();
    await expect(portal.getByText(/INV-\d{4}-/).first()).toBeVisible({ timeout: 15_000 });
    // Strict ownership, checked with a real portal token against the API.
    const apiBase = process.env.E2E_API_URL ?? 'http://localhost:4300/api/v1';
    const login = await portal.context().request.post(`${apiBase}/portal/auth/login`, { data: { email: portalEmail, password: portalNew } });
    expect(login.ok()).toBe(true);
    const token = (await login.json()).data.accessToken as string;
    const headers = { Authorization: `Bearer ${token}` };
    const ownId = invoiceUrl.split('/').pop() as string;
    expect((await portal.context().request.get(`${apiBase}/portal/invoices/${ownId}`, { headers })).status()).toBe(200);
    expect((await portal.context().request.get(`${apiBase}/portal/invoices/${otherInvoiceId}`, { headers })).status()).toBe(404);
    const mine = await (await portal.context().request.get(`${apiBase}/portal/invoices`, { headers })).json();
    expect((mine.data as Array<{ id: string }>).map((i) => i.id)).toEqual([ownId]);
    // A portal token is never accepted by the staff API.
    expect((await portal.context().request.get(`${apiBase}/invoices`, { headers })).status()).toBe(401);
    await portal.context().close();
    expect(invoiceUrl).toMatch(/\/app\/invoices\//);
  });
});
