import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SolarUsagePage } from './SolarUsagePage';

const calls: string[] = [];
let connected = false;
let testResult: { ok: boolean; code: string; httpStatus: number | null; message: string; fix: string | null } = { ok: true, code: 'OK', httpStatus: 200, message: 'Connected. Google returned roof data.', fix: null };

vi.mock('@/services/http', () => ({
  apiFetch: async (path: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/measurements/solar/test-connection') {
      connected = testResult.ok;
      return { data: testResult };
    }
    if (path === '/measurements/solar/settings') {
      return {
        data: {
          enabled: true, preferredQuality: 'HIGH', allowBaseFallback: true, dailyLimit: { building_insights: 200, data_layers: 20, geocode: 300 }, monthlyFree: { building_insights: 10000, data_layers: 1000, geocode: 10000 },
          warnPercent: 80, allowOverage: false, pricePer1000Cents: {}, cacheDays: 30, rawRetentionDays: 30,
          integration: { state: connected ? 'connected' : 'configuration_required', keyConfigured: true, lastTest: connected ? { at: new Date().toISOString(), ok: true, code: 'OK', httpStatus: 200, message: 'Connected. Google returned roof data.', fix: null } : null },
        },
      };
    }
    if (path === '/measurements/solar/usage') return { data: { month: '2026-11', configured: true, enabled: true, rows: [], recent: [], notes: [] } };
    if (path === '/integrations/status') return { data: [] };
    throw new Error(`unexpected ${path}`);
  },
}));

function IntegrationsProbe(): React.ReactElement {
  useQuery({ queryKey: ['integrations'], queryFn: () => import('@/services/http').then((m) => m.apiFetch('/integrations/status')) });
  return <span />;
}

function renderPage(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IntegrationsProbe />
      <SolarUsagePage />
    </QueryClientProvider>,
  );
}

describe('Measurement integration page', () => {
  beforeEach(() => { calls.length = 0; connected = false; testResult = { ok: true, code: 'OK', httpStatus: 200, message: 'Connected. Google returned roof data.', fix: null }; });
  afterEach(cleanup);

  it('shows "Configuration required" until a real test succeeds, then refreshes to "Connected" and refreshes the integrations hub', async () => {
    const user = userEvent.setup();
    renderPage();
    expect((await screen.findByTestId('solar-state')).textContent).toBe('Configuration required');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(screen.getByTestId('solar-state').textContent).toBe('Connected'));
    expect(calls.filter((c) => c === 'GET /measurements/solar/settings').length).toBeGreaterThanOrEqual(2); // refetched after the test
    expect(calls.filter((c) => c === 'GET /integrations/status').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the failure, the HTTP status and what to fix, and does not claim a connection', async () => {
    testResult = { ok: false, code: 'BILLING_DISABLED', httpStatus: 403, message: 'Billing is not enabled on the Google Cloud project.', fix: 'Link an active billing account to the Google Cloud project.' };
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Billing is not enabled');
    expect(alert.textContent).toContain('HTTP 403');
    expect(alert.textContent).toContain('Link an active billing account');
    expect(screen.getByTestId('solar-state').textContent).not.toBe('Connected');
  });
});
