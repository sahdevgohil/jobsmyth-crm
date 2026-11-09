import { describe, expect, it } from 'vitest';
import { calculateProductMaterials, type CatalogProduct } from './materials.js';

const prod = (family: CatalogProduct['family'], name: string, coverage: number, extra: Partial<CatalogProduct> = {}): CatalogProduct => ({ id: name, family, brand: '', name, packageUnit: 'pkg', coveragePerPackage: coverage, specConfirmed: true, enabled: true, ...extra });
const verified = (ft: number) => ({ ft, status: 'verified' as const });
const cols = [0, 10, 14, 15];

describe('product material calculation', () => {
  it('uses each product coverage and rounds up to whole packages with waste applied once', () => {
    const fam = calculateProductMaterials({ pitchedAreaSqFt: 3000, lengths: {}, counts: {}, wasteColumns: cols }, [prod('shingle', 'A', 33.3), prod('shingle', 'B', 32)]).find((f) => f.family === 'shingle')!;
    const [a, b] = fam.products;
    expect(a!.packages[0]).toBe(Math.ceil(3000 / 33.3 - 1e-9));
    expect(a!.packages[14]).toBe(Math.ceil((3000 * 1.14) / 33.3 - 1e-9));
    expect(b!.packages[14]).toBeGreaterThan(a!.packages[14] as number); // smaller coverage needs more packages
    expect(fam.status).toBe('ready');
  });
  it('does not print a quantity when a required edge is unverified or missing', () => {
    const lengths = { eave: { ft: 140, status: 'unverified' as const }, rake: verified(10) };
    const starter = calculateProductMaterials({ pitchedAreaSqFt: 3000, lengths, counts: {}, wasteColumns: cols }, [prod('starter', 'S', 100)]).find((f) => f.family === 'starter')!;
    expect(starter.status).toBe('unverified');
    expect(starter.products[0]!.packages[14]).toBeNull();
    const none = calculateProductMaterials({ pitchedAreaSqFt: 3000, lengths: {}, counts: {}, wasteColumns: cols }, [prod('starter', 'S', 100)]).find((f) => f.family === 'starter')!;
    expect(none.status).toBe('missing');
    expect(none.products[0]!.packages[0]).toBeNull();
  });
  it('calculates edge products once the edges are verified', () => {
    const lengths = { eave: verified(140), rake: verified(10) };
    const starter = calculateProductMaterials({ pitchedAreaSqFt: 3000, lengths, counts: {}, wasteColumns: cols }, [prod('starter', 'S', 100)]).find((f) => f.family === 'starter')!;
    expect(starter.status).toBe('ready');
    expect(starter.products[0]!.packages[0]).toBe(2);
  });
  it('ignores disabled products and labels generic rows as unconfirmed', () => {
    const fam = calculateProductMaterials({ pitchedAreaSqFt: 3000, lengths: {}, counts: {}, wasteColumns: cols }, [prod('shingle', 'Off', 33, { enabled: false })]).find((f) => f.family === 'shingle')!;
    expect(fam.products.every((p) => p.generic && !p.specConfirmed)).toBe(true);
    expect(fam.products.some((p) => p.name === 'Off')).toBe(false);
  });
});
