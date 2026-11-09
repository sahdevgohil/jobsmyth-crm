import { describe, expect, it } from 'vitest';
import { addDays, dayKey, isoToZonedInput, startOfDayISO, weekday, zonedInputToISO } from './datetime';

describe('company time-zone helpers (America/Chicago)', () => {
  it('converts wall-clock time to UTC in winter (CST, UTC-6) and summer (CDT, UTC-5)', () => {
    expect(zonedInputToISO('2026-01-15T09:00')).toBe('2026-01-15T15:00:00.000Z');
    expect(zonedInputToISO('2026-07-15T09:00')).toBe('2026-07-15T14:00:00.000Z');
  });

  it('round-trips through the input format', () => {
    for (const local of ['2026-03-08T01:30', '2026-03-08T03:30', '2026-11-01T00:30', '2026-11-01T03:30', '2026-12-31T23:45']) {
      expect(isoToZonedInput(zonedInputToISO(local))).toBe(local);
    }
  });

  it('assigns instants to the correct business day regardless of UTC date', () => {
    // 02:30 UTC on Nov 6 is still the evening of Nov 5 in Chicago.
    expect(dayKey('2026-11-06T02:30:00.000Z')).toBe('2026-11-05');
    expect(dayKey('2026-11-06T06:30:00.000Z')).toBe('2026-11-06');
  });

  it('computes day starts across the daylight-saving change', () => {
    expect(startOfDayISO('2026-03-08')).toBe('2026-03-08T06:00:00.000Z'); // CST
    expect(startOfDayISO('2026-03-09')).toBe('2026-03-09T05:00:00.000Z'); // CDT
  });

  it('does calendar arithmetic without time-zone drift', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(weekday('2026-11-05')).toBe(4); // Thursday
  });
});
