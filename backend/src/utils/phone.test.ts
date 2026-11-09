import { describe, expect, it } from 'vitest';
import { normalizePhoneE164 } from './phone.js';

describe('normalizePhoneE164', () => {
  it('normalizes US formats to E.164', () => {
    expect(normalizePhoneE164('(512) 555-0100')).toBe('+15125550100');
    expect(normalizePhoneE164('5125550100')).toBe('+15125550100');
    expect(normalizePhoneE164('+1 512 555 0100')).toBe('+15125550100');
  });

  it('returns null for empty or invalid', () => {
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('not-a-phone')).toBeNull();
  });
});
