import { describe, expect, it } from 'vitest';
import { buildRoofGeometry, edgeTotals } from './derive.js';
import { COMPLEX, FLAT, GABLE, HIP, TWO_BUILDINGS, emptyRasters, makeRasters, roofOf, type RoofSpec } from './fixtures.js';
import { labelComponents, ringArea, simplifyRing, traceOuterRing, type Pt } from './raster.js';

const run = (spec: RoofSpec, extra: Partial<RoofSpec> = {}) => {
  const s = { ...spec, ...extra };
  const roof = roofOf(s);
  const g = buildRoofGeometry({ rasters: makeRasters(s), roof, center: roof.buildingCenter! });
  return { g, roof, totals: edgeTotals(g.edges) };
};
const center = (spec: RoofSpec) => ({ rasters: makeRasters(spec), roof: roofOf(spec) });

describe('raster primitives', () => {
  it('traces the outer ring of a blob and its area matches the pixel area', () => {
    const w = 20, h = 20;
    const data = new Uint8Array(w * h);
    for (let y = 5; y < 13; y++) for (let x = 4; x < 16; x++) data[y * w + x] = 1;
    const comps = labelComponents({ width: w, height: h, data });
    const ring = traceOuterRing(comps, 1);
    expect(ring).toHaveLength(4);
    expect(Math.abs(ringArea(ring))).toBe(12 * 8);
  });
  it('simplifies a noisy straight line without moving the corners', () => {
    const ring: Pt[] = [];
    for (let i = 0; i <= 20; i++) ring.push([i, (i % 2) * 0.05]);
    ring.push([20, 10], [0, 10]);
    expect(simplifyRing(ring, 0.2).length).toBeLessThanOrEqual(6);
  });
});

describe('roof geometry extraction (synthetic roofs with known dimensions)', () => {
  it('gable roof: footprint, two facets, one ridge, two eaves, four rakes', () => {
    const { g, totals } = run(GABLE);
    expect(g.status).toBe('ok');
    expect(g.structures).toHaveLength(1);
    expect(g.structures[0]!.footprintAreaSqFt).toBeCloseTo(12 * 8 * 10.7639, -1); // 96 m2
    expect(g.facets).toHaveLength(2);
    expect(g.facets.map((f) => f.pitchLabel)).toEqual(['6/12', '6/12']);
    expect(totals.ridge.lengthFt!).toBeGreaterThan(36); // true 39.4 ft
    expect(totals.ridge.lengthFt!).toBeLessThan(43);
    expect(totals.eave.lengthFt!).toBeGreaterThan(70); // true 78.7 ft
    expect(totals.eave.lengthFt!).toBeLessThan(86);
    expect(totals.rake.lengthFt!).toBeGreaterThan(50); // true 58.7 ft
    expect(totals.rake.lengthFt!).toBeLessThan(66);
    expect(totals.hip.count + totals.valley.count).toBe(0);
  });

  it('hip roof: four hips, one short ridge, no rakes', () => {
    const { g, totals } = run(HIP);
    expect(g.facets).toHaveLength(4);
    expect(totals.hip.count).toBeGreaterThanOrEqual(4);
    expect(totals.hip.lengthFt!).toBeGreaterThan(4 * 19.7 * 0.8); // true 19.7 ft each
    expect(totals.hip.lengthFt!).toBeLessThan(4 * 19.7 * 1.2);
    expect(totals.ridge.lengthFt!).toBeGreaterThan(11); // true 13.1 ft
    expect(totals.ridge.lengthFt!).toBeLessThan(16);
    expect(totals.rake.count).toBe(0);
  });

  it('complex roof: finds the two valleys and the ridges', () => {
    const { g, totals } = run(COMPLEX);
    expect(g.facets).toHaveLength(5);
    expect(totals.valley.count).toBeGreaterThanOrEqual(2);
    expect(totals.valley.lengthFt!).toBeGreaterThan(2 * 19.7 * 0.8); // true 19.7 ft each
    expect(totals.valley.lengthFt!).toBeLessThan(2 * 19.7 * 1.25);
    expect(totals.ridge.lengthFt!).toBeGreaterThan(70); // main 52.5 + wing 32.8 = 85 ft
  });

  it('flat roof: a footprint and facet, but perimeter edges are left for verification, never named', () => {
    const { g, totals } = run(FLAT);
    expect(g.facets[0]!.flat).toBe(true);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => e.type === 'unspecified' && e.verification === 'needs_verification' && e.lengthFt === null)).toBe(true);
    expect(totals.eave.lengthFt).toBeNull();
  });

  it('multiple structures: the extra building is an outline only and carries no roof area', () => {
    const { g } = run(TWO_BUILDINGS);
    expect(g.structures).toHaveLength(2);
    expect(g.structures[1]).toMatchObject({ kind: 'additional', roofAreaMeasured: false });
    expect(g.structures[1]!.footprintAreaSqFt).toBeCloseTo(20 * 10.7639, -1);
    expect(g.facets.every((f) => f.structureId === 'ST1')).toBe(true);
    expect(g.warnings.join(' ')).toMatch(/additional structure/);
  });

  it('survives noisy elevation data (5 cm) without inventing facets', () => {
    const { g, totals } = run(GABLE, { noiseM: 0.05 });
    expect(g.facets).toHaveLength(2);
    expect(totals.ridge.lengthFt!).toBeGreaterThan(33);
    expect(totals.ridge.lengthFt!).toBeLessThan(46);
  });

  it('every derived edge starts unverified and none is ever "high" confidence', () => {
    for (const spec of [GABLE, HIP, COMPLEX]) {
      const { g } = run(spec);
      expect(g.edges.every((e) => e.source === 'derived' && e.verification !== 'verified' && e.included && e.history.length === 0)).toBe(true);
      expect(g.edges.every((e) => (e.confidence as string) !== 'high')).toBe(true);
    }
  });

  it('reports unavailable geometry (no fake outline) when there is no building mask', () => {
    const roof = roofOf(GABLE);
    const g = buildRoofGeometry({ rasters: emptyRasters(), roof, center: roof.buildingCenter! });
    expect(g).toMatchObject({ status: 'unavailable', facets: [], edges: [], structures: [] });
    expect(g.reason).toMatch(/no building outline/);
  });

  it('refuses rasters that do not line up', () => {
    const { rasters, roof } = center(GABLE);
    const bad = { ...rasters, mask: { ...rasters.mask, originX: rasters.mask.originX + 5 } };
    expect(buildRoofGeometry({ rasters: bad, roof, center: roof.buildingCenter! }).status).toBe('unavailable');
  });
});

describe('outline cleaning', () => {
  it('snaps a slightly rotated rectangle onto its axis without changing its size, and never moves free-form shapes far', async () => {
    const { snapRing, dominantAngle, ringArea } = await import('./raster.js');
    const a = (3 * Math.PI) / 180;
    const rot = ([x, y]: [number, number]): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const wobbly = [rot([0, 0]), rot([10, 0.1]), rot([10.1, 6]), rot([0, 5.9])] as Array<[number, number]>;
    const snapped = snapRing(wobbly, dominantAngle(wobbly));
    const xs = new Set(snapped.map((p) => Math.round(p[0] * 100) / 100));
    expect(Math.abs(ringArea(snapped))).toBeGreaterThan(55);
    expect(Math.abs(ringArea(snapped))).toBeLessThan(65);
    // opposite sides are parallel after snapping
    const d = (i: number): number => Math.atan2(snapped[(i + 1) % 4]![1] - snapped[i]![1], snapped[(i + 1) % 4]![0] - snapped[i]![0]);
    expect(Math.abs(Math.sin(d(0) - d(2)))).toBeLessThan(1e-6);
    expect(xs.size).toBeLessThanOrEqual(4);
    const free: Array<[number, number]> = [[0, 0], [10, 3], [12, 9], [4, 11], [-1, 6]];
    const out = snapRing(free, dominantAngle(free));
    expect(out).toHaveLength(free.length);
    out.forEach((p, i) => expect(Math.hypot(p[0] - free[i]![0], p[1] - free[i]![1])).toBeLessThanOrEqual(0.7)); // never moves a vertex far
    expect(Math.abs(Math.abs(ringArea(out)) - Math.abs(ringArea(free))) / Math.abs(ringArea(free))).toBeLessThan(0.15);
  });
});
