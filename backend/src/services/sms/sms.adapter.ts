export function getSmsStatus(): {
  provider: 'twilio';
  status: 'not_configured';
  message: string;
} {
  return {
    provider: 'twilio',
    status: 'not_configured',
    message: 'Twilio SMS is not configured. Set credentials before sending live SMS.',
  };
}

export async function sendSms(_input: {
  to: string;
  body: string;
}): Promise<{ status: 'not_configured'; provider: 'none'; message: string }> {
  const s = getSmsStatus();
  return { status: s.status, provider: 'none', message: s.message };
}
