import { describe, expect, it } from 'vitest';
import { AppError } from '../../utils/errors.js';
import { assertClientTotalsMatch, recalcTotals, type LineItemInput } from './estimate.calc.js';

const item = (overrides: Partial<LineItemInput> = {}): LineItemInput => ({
  id: 'x',
  description: 'Shingles',
  kind: 'material',
  quantity: 1,
  unit: 'sq',
  unitCostCents: 0,
  laborCostCents: 0,
  materialCostCents: 0,
  ...overrides,
});

describe('recalcTotals', () => {
  it('computes line amounts, subtotal, discount, tax (half-up) and total in cents', () => {
    const totals = recalcTotals(
      [
        item({ quantity: 24.5, unitCostCents: 35_000 }), // 857_500
        item({ id: 'y', kind: 'labor', quantity: 10, unitCostCents: 5_000, laborCostCents: 1_234 }), // 51_234
      ],
      10_000,
      825,
    );
    expect(totals.lineItems.map((l) => l.amountCents)).toEqual([857_500, 51_234]);
    expect(totals.subtotalCents).toBe(908_734);
    // taxable 898_734 * 0.0825 = 74_145.555 -> 74_146
    expect(totals.taxCents).toBe(74_146);
    expect(totals.totalCents).toBe(972_880);
  });

  it('returns zeros for an empty estimate and rejects a discount above the subtotal', () => {
    expect(recalcTotals([], 0, 0)).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
    expect(() => recalcTotals([item({ unitCostCents: 100 })], 101, 0)).toThrow(AppError);
  });
});

describe('assertClientTotalsMatch', () => {
  it('passes for matching figures and throws TOTAL_MISMATCH otherwise', () => {
    const totals = recalcTotals([item({ quantity: 2, unitCostCents: 500 })], 0, 0);
    expect(() =>
      assertClientTotalsMatch({ subtotalCents: 1000, totalCents: 1000, lineAmounts: [1000] }, totals),
    ).not.toThrow();
    try {
      assertClientTotalsMatch({ totalCents: 1 }, totals);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('TOTAL_MISMATCH');
      expect((err as AppError).status).toBe(422);
    }
  });
});
