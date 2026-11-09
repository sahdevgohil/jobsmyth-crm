import { describe, expect, it } from 'vitest';
import { CUSTOMER_CATALOG_SEED } from './default-catalogs.js';
import { computeQuote, pitchRise, type QuoteCatalog } from './quote-engine.js';

const catalog: QuoteCatalog = {
  items: CUSTOMER_CATALOG_SEED.items,
  conditionalCharges: CUSTOMER_CATALOG_SEED.conditionalCharges,
  packages: CUSTOMER_CATALOG_SEED.packages.map((p) => ({ key: p.key, name: p.name, perSquareLowCents: p.perSquareLowCents, perSquareHighCents: p.perSquareHighCents })),
};

describe('quote engine (client Good / Better / Best sheet)', () => {
  it('seed data reproduces the client package ranges and 25-square examples exactly', () => {
    for (const p of CUSTOMER_CATALOG_SEED.packages) {
      expect(p.perSquareLowCents * 25).toBe(p.example25SquaresLowCents);
      expect(p.perSquareHighCents * 25).toBe(p.example25SquaresHighCents);
    }
    const q = computeQuote(catalog, { package: 'good', squares: 25 });
    expect(q.rangeLowCents).toBe(1_125_000); // $11,250
    expect(q.rangeHighCents).toBe(1_237_500); // $12,375
    expect(computeQuote(catalog, { package: 'better', squares: 25 }).rangeHighCents).toBe(1_437_500);
    expect(computeQuote(catalog, { package: 'best', squares: 25 }).rangeLowCents).toBe(1_625_000);
  });

  it('prices the per-square items for each package in integer cents', () => {
    // tear-off + underlayment + field shingles per SQ: Good 75+25+285=385, Better 75+35+335=445, Best 75+45+420=540
    const per = (pkg: 'good' | 'better' | 'best'): number => computeQuote(catalog, { package: pkg, squares: 1 }).subtotalCents;
    expect(per('good')).toBe(38_500);
    expect(per('better')).toBe(44_500);
    expect(per('best')).toBe(54_000);
  });

  it('multiplies quantities by units and rounds half-up per line', () => {
    const q = computeQuote(catalog, { package: 'good', squares: 20, quantities: { drip_edge_lf: 150.5, pipe_boots: 3, ridge_lf: 60 } });
    const line = (k: string) => q.lines.find((l) => l.key === k)!;
    expect(line('drip_edge').amountCents).toBe(Math.round(150.5 * 350)); // $526.75 → 52675 (rounded)
    expect(line('pipe_boot').amountCents).toBe(3 * 4_000);
    expect(line('hip_ridge_cap').amountCents).toBe(60 * 800);
    expect(q.subtotalCents).toBe(q.lines.reduce((s, l) => s + l.amountCents, 0));
    expect(Number.isInteger(q.totalCents)).toBe(true);
  });

  it('lists included items with no charge', () => {
    const q = computeQuote(catalog, { package: 'best', squares: 10 });
    const included = q.lines.filter((l) => l.included).map((l) => l.key);
    expect(included).toEqual(expect.arrayContaining(['deck_inspection', 'paint_penetrations', 'site_cleanup']));
    expect(q.lines.filter((l) => l.included).every((l) => l.amountCents === 0)).toBe(true);
  });

  it('adds conditional charges only when triggered', () => {
    const base = computeQuote(catalog, { package: 'good', squares: 25 });
    expect(base.lines.some((l) => l.conditional)).toBe(false);
    const q = computeQuote(catalog, { package: 'good', squares: 25, pitch: '8/12', stories: 2, extraLayers: 2, osbSheets: 4, plywoodSheets: 2, reDeckSquares: 3, permitCents: 25_000 });
    const c = (k: string) => q.lines.find((l) => l.key === k)!;
    expect(c('steep_7_9').amountCents).toBe(25 * 3_500);
    expect(q.lines.some((l) => l.key === 'steep_10_12')).toBe(false);
    expect(c('two_story').amountCents).toBe(25 * 1_500);
    expect(c('extra_layer').amountCents).toBe(25 * 2 * 4_500);
    expect(c('osb_replace').amountCents).toBe(4 * 8_500);
    expect(c('plywood_replace').amountCents).toBe(2 * 9_500);
    expect(c('redeck_skip').amountCents).toBe(3 * 17_500);
    expect(c('permit_fees').amountCents).toBe(25_000);
    expect(computeQuote(catalog, { package: 'good', squares: 10, pitch: '11/12' }).lines.find((l) => l.key === 'steep_10_12')!.amountCents).toBe(10 * 6_000);
  });

  it('never adds a second waste factor to field shingles', () => {
    const noWaste = computeQuote(catalog, { package: 'good', squares: 25 });
    const withWaste = computeQuote(catalog, { package: 'good', squares: 25, wasteBps: 1_500 });
    expect(withWaste.lines.find((l) => l.key === 'field_shingles')!.quantity).toBe(25);
    expect(withWaste.subtotalCents).toBe(noWaste.subtotalCents); // no item in the seed opts in to extra waste
  });

  it('treats permit fees as at-cost, optional items as opt-in, and warns instead of guessing', () => {
    const q = computeQuote(catalog, { package: 'good', squares: 10 });
    expect(q.lines.some((l) => l.key === 'permit_fees')).toBe(false);
    expect(q.warnings.join(' ')).toMatch(/Permit and city fees are at cost/);
    expect(q.lines.some((l) => l.key === 'satellite_dish')).toBe(false);
    const opt = computeQuote(catalog, { package: 'good', squares: 10, quantities: { satellite_dishes: 1 }, optionalItemKeys: ['satellite_dish'] });
    expect(opt.lines.find((l) => l.key === 'satellite_dish')!.amountCents).toBe(7_500);
  });

  it('applies discount then an explicit tax rate; no tax is assumed otherwise', () => {
    const q = computeQuote(catalog, { package: 'good', squares: 10, discountCents: 10_000, taxRateBps: 825 });
    const taxable = q.subtotalCents - 10_000;
    expect(q.taxCents).toBe(Math.round((taxable * 825) / 10_000));
    expect(q.totalCents).toBe(taxable + q.taxCents);
    const none = computeQuote(catalog, { package: 'good', squares: 10 });
    expect(none.taxRateBps).toBeNull();
    expect(none.taxCents).toBe(0);
    expect(none.warnings.join(' ')).toMatch(/pending company\/CPA confirmation/);
    expect(() => computeQuote(catalog, { package: 'good', squares: 10, discountCents: 99_999_999 })).toThrow();
  });

  it('parses pitch and rejects bad geometry', () => {
    expect(pitchRise('7/12')).toBe(7);
    expect(pitchRise('seven')).toBeNull();
    expect(() => computeQuote(catalog, { package: 'good', squares: 0 })).toThrow();
  });
});
