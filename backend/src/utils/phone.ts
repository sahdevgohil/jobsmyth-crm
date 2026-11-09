import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Normalize a US-centric phone string to E.164, or null if invalid/empty. */
export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountry: 'US' = 'US',
): string | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) {
    return null;
  }
  return parsed.format('E.164');
}

export function assertPhoneE164OrEmpty(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  const normalized = normalizePhoneE164(raw);
  if (!normalized) {
    throw Object.assign(new Error('Invalid phone number'), { code: 'INVALID_PHONE' });
  }
  return normalized;
}
