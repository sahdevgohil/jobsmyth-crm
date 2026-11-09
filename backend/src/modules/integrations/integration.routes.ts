import { Router } from 'express';
import { authenticate, requireAuth } from '../../middleware/authenticate.js';
import { integrationState } from '../measurements/solar/solar.service.js';
import { authorize } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-changed.js';
import { getQuickBooksStatus } from '../../services/accounting/quickbooks.adapter.js';
import { getEmailStatus } from '../../services/email/email.adapter.js';
import { getSignatureProvidersStatus } from '../../services/signatures/signature.adapter.js';
import { getSmsStatus } from '../../services/sms/sms.adapter.js';
import { getEnv } from '../../config/env.js';

export type IntegrationStatus =
  | 'not_configured'
  | 'configuration_required'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'disconnected';

export type IntegrationDto = {
  key: string;
  name: string;
  purpose: string;
  status: IntegrationStatus;
  message: string;
  /** What still works without this integration. */
  fallback: string;
};

/**
 * Honest integration status. No provider adapter performs a live connection check today, so
 * nothing here may ever report `connected`.
 */
export function listIntegrations(solar: { state: string; message: string }): IntegrationDto[] {
  const email = getEmailStatus();
  const qbo = getQuickBooksStatus();
  const sms = getSmsStatus();
  const sig = getSignatureProvidersStatus()[0] ?? { status: 'not_configured' as const, message: 'E-signature providers are not configured.' };
  const env = getEnv();
  return [
    { key: 'resend', name: 'Resend (email)', purpose: 'Transactional email: proposals, invoices, reminders', status: email.status, message: email.message, fallback: 'Emails are recorded as not_configured; nothing is sent.' },
    { key: 'twilio', name: 'Twilio (SMS)', purpose: 'SMS reminders and updates', status: sms.status, message: sms.message, fallback: 'SMS attempts are recorded as not_configured; nothing is sent.' },
    { key: 'esign', name: 'Dropbox Sign / DocuSign', purpose: 'Electronic proposal signatures', status: sig.status, message: sig.message, fallback: 'Proposals can be accepted internally (manual approval tracking).' },
    { key: 'quickbooks', name: 'QuickBooks Online', purpose: 'Accounting sync for invoices and payments', status: qbo.status, message: qbo.message, fallback: 'Invoices and payments work fully inside the CRM.' },
    { key: 'google_solar', name: 'Google Solar API', purpose: 'Address-based roof area, pitch and segment data', status: solar.state === 'connected' ? 'connected' : solar.state === 'not_configured' ? 'not_configured' : solar.state === 'configuration_required' ? 'configuration_required' : solar.state === 'disabled' ? 'disconnected' : 'error', message: solar.message, fallback: 'Manual measurement entry or an uploaded measurement report.' },
    { key: 'roofr', name: 'Roofr / EagleView / HOVER', purpose: 'Third-party roof measurement reports', status: 'not_configured', message: 'Not used. No adapter is connected and no paid measurement API is required.', fallback: 'Google Solar lookup or manual entry.' },
    { key: 'storage', name: 'File storage (S3/R2)', purpose: 'Persistent photo and document storage', status: 'not_configured', message: `Local disk storage in use (${env.FILE_STORAGE_DIR}). Configure object storage and backups before production.`, fallback: 'Local file storage (development only).' },
    { key: 'sentry', name: 'Sentry', purpose: 'Error monitoring', status: 'not_configured', message: 'Error monitoring is not configured.', fallback: 'Structured logs only.' },
    { key: 'website_form', name: 'Website lead form', purpose: 'Public lead intake from the marketing site', status: env.WEBSITE_LEAD_INTAKE_SECRET ? 'configuration_required' : 'not_configured', message: env.WEBSITE_LEAD_INTAKE_SECRET ? 'Intake endpoint has a secret configured, but the live website form has not been verified.' : 'Intake secret is not set.', fallback: 'Create leads manually.' },
  ];
}

export const integrationsRouter = Router();
integrationsRouter.use(authenticate, requirePasswordChanged);
integrationsRouter.get('/status', authorize('settings:update'), (req, res, next) => {
  const a = requireAuth(req);
  void integrationState({ userId: a.userId, role: a.role, companyId: a.companyId, permissions: a.permissions })
    .then((st) => {
      const message =
        st.state === 'connected' ? `Connected: ${String(st.lastTest?.message ?? 'Google answered a real request.')}`
        : st.state === 'not_configured' ? 'GOOGLE_SOLAR_API_KEY is not set on the server. Add it to backend/.env and restart the backend.'
        : st.state === 'disabled' ? 'Automated measurements are turned off.'
        : st.state === 'configuration_required' ? (st.stale ? 'The API key changed since the last test. Open Measurements > Integration & usage and press Test connection.' : 'The key is set but has not been tested. Open Measurements > Integration & usage and press Test connection.')
        : `${String(st.lastTest?.message ?? 'The last connection test failed.')} ${String(st.lastTest?.fix ?? '')}`.trim();
      res.status(200).json({ data: listIntegrations({ state: st.state, message }) });
    })
    .catch(next);
});
