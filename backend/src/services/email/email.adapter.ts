import { AppError } from '../../utils/errors.js';

export type EmailDeliveryResult = {
  status: 'not_configured' | 'queued' | 'sent' | 'failed';
  provider: 'none' | 'resend';
  message?: string;
};

/** Resend credentials are not configured — never claim delivery. */
export function getEmailStatus(): {
  provider: 'resend';
  status: 'not_configured';
  message: string;
} {
  return {
    provider: 'resend',
    status: 'not_configured',
    message: 'Resend email is not configured. Set credentials before sending live email.',
  };
}

export async function sendEmail(_input: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<EmailDeliveryResult> {
  const status = getEmailStatus();
  return {
    status: status.status,
    provider: 'none',
    message: status.message,
  };
}

export function assertEmailConfigured(): void {
  throw new AppError({
    status: 503,
    code: 'EMAIL_NOT_CONFIGURED',
    message: getEmailStatus().message,
  });
}
