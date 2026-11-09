import { describe, expect, it } from 'vitest';
import { buildAddressKey, normalizeEmail } from './address-key.js';

describe('buildAddressKey', () => {
  it('normalizes street suffixes and ZIP', () => {
    expect(
      buildAddressKey({
        line1: '123 Main Street',
        zip: '78701-1234',
      }),
    ).toBe('123 main st|78701');
    expect(
      buildAddressKey({
        line1: '123 Main St.',
        zip: '78701',
      }),
    ).toBe('123 main st|78701');
  });

  it('returns null without line1 or zip', () => {
    expect(buildAddressKey({ line1: '123 Main', zip: '' })).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });
});
