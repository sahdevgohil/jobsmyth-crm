import { describe, expect, it } from 'vitest';
import { escapeRegex } from './escape-regex.js';

describe('escapeRegex', () => {
  it('escapes regex metacharacters from user search input', () => {
    expect(escapeRegex('a+b*(c)')).toBe('a\\+b\\*\\(c\\)');
    expect(new RegExp(escapeRegex('foo.'), 'i').test('fooX')).toBe(false);
    expect(new RegExp(escapeRegex('foo.'), 'i').test('foo.')).toBe(true);
  });
});
