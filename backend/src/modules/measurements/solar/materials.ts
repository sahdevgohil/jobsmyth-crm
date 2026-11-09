/**
 * Material quantity estimates from a measurement and configurable packaging rules.
 * The default rules are generic industry coverage assumptions, NOT the client's products: administrators should set
 * coverage per package for the products they actually buy. Prices are never calculated here (see the price catalog).
 */
import { round } from './geo.js';

export const MATERIAL_BASES = ['area_squares', 'eave_rake_lf', 'hip_ridge_lf', 'ice_water_lf', 'ridge_lf', 'hip_lf', 'valley_lf', 'eave_lf', 'rake_lf', 'count'] as const;
export type MaterialBasis = (typeof MATERIAL_BASES)[number];

export type MaterialRule = {
  key: string;
  name: string;
  /** What one package is called, e.g. "bundle", "roll". */
  packageUnit: string;
  basis: MaterialBasis;
  /** For `count` rules: the entered count to use (pipeBoots, vents, ...). */
  countKey?: string;
  /** Quantity of the basis one package covers (squares or linear feet or pieces). */
  coveragePerPackage: number;
  /** Apply the selected waste percentage to the area basis. */
  useWaste: boolean;
  enabled: boolean;
  note: string;
};

export const DEFAULT_MATERIAL_RULES: MaterialRule[] = [
  { key: 'field_shingles', name: 'Field shingles', packageUnit: 'bundle', basis: 'area_squares', coveragePerPackage: 1 / 3, useWaste: true, enabled: true, note: 'Assumes 3 bundles per square.' },
  { key: 'starter_strip', name: 'Starter strips', packageUnit: 'bundle', basis: 'eave_rake_lf', coveragePerPackage: 105, useWaste: false, enabled: true, note: 'Assumes about 105 linear feet per bundle along eaves and rakes.' },
  { key: 'synthetic_underlayment', name: 'Synthetic underlayment', packageUnit: 'roll', basis: 'area_squares', coveragePerPackage: 10, useWaste: true, enabled: true, note: 'Assumes 10 squares (1,000 sq ft) per roll.' },
  { key: 'ice_water', name: 'Ice and water barrier', packageUnit: 'roll', basis: 'ice_water_lf', coveragePerPackage: 66, useWaste: false, enabled: true, note: 'Assumes a 3 ft wide strip along eaves and valleys, 66 linear feet per roll. Local code may require more.' },
  { key: 'hip_ridge_caps', name: 'Hip and ridge caps', packageUnit: 'bundle', basis: 'hip_ridge_lf', coveragePerPackage: 33, useWaste: false, enabled: true, note: 'Assumes about 33 linear feet per bundle.' },
  { key: 'drip_edge', name: 'Drip edge', packageUnit: 'piece (10 ft)', basis: 'eave_rake_lf', coveragePerPackage: 10, useWaste: false, enabled: true, note: 'Assumes 10 ft pieces along eaves and rakes.' },
  { key: 'pipe_boots', name: 'Pipe boots', packageUnit: 'each', basis: 'count', countKey: 'pipeBoots', coveragePerPackage: 1, useWaste: false, enabled: true, note: 'From the count entered by staff.' },
  { key: 'roof_vents', name: 'Roof vents', packageUnit: 'each', basis: 'count', countKey: 'vents', coveragePerPackage: 1, useWaste: false, enabled: true, note: 'From the count entered by staff.' },
];

export type EdgeInput = { ft: number | null; status: 'verified' | 'unverified' | 'missing' };
export type MaterialInput = {
  areaSqFt: number;
  wastePercent: number;
  edges: Record<'ridge' | 'hip' | 'valley' | 'eave' | 'rake', EdgeInput>;
  counts: Record<string, number | string>;
};

export type MaterialRow = {
  key: string;
  name: string;
  basis: MaterialBasis;
  /** Quantity of the basis used (squares, feet or count). Null when an input is missing. */
  basisQuantity: number | null;
  basisUnit: string;
  coveragePerPackage: number;
  packageUnit: string;
  /** Exact packages before rounding; whole packages to buy. */
  exactPackages: number | null;
  packages: number | null;
  /** verified = every input was verified or entered by staff; unverified = derived from unverified edges; missing = cannot calculate. */
  inputStatus: 'verified' | 'unverified' | 'missing';
  missing: string[];
  note: string;
};

export const MATERIAL_DISCLAIMER =
  'Material calculations are estimates and must be verified before ordering. Actual quantities may vary based on installation method, product specifications, roof complexity and field conditions.';

const unitOf = (b: MaterialBasis): string => (b === 'area_squares' ? 'SQ' : b === 'count' ? 'each' : 'LF');

export function calculateMaterials(inp: MaterialInput, rules: MaterialRule[] = DEFAULT_MATERIAL_RULES): MaterialRow[] {
  const sumEdges = (names: Array<'ridge' | 'hip' | 'valley' | 'eave' | 'rake'>): { v: number | null; status: MaterialRow['inputStatus']; missing: string[] } => {
    const parts = names.map((n) => ({ n, e: inp.edges[n] }));
    const missing = parts.filter((p) => p.e.status === 'missing' || p.e.ft === null).map((p) => `${p.n} length`);
    if (missing.length === names.length) return { v: null, status: 'missing', missing };
    // A zero-length type that is simply absent from the roof is entered as 0; unknown stays missing.
    if (missing.length > 0) return { v: null, status: 'missing', missing };
    const unverified = parts.some((p) => p.e.status === 'unverified');
    return { v: parts.reduce((a, p) => a + (p.e.ft as number), 0), status: unverified ? 'unverified' : 'verified', missing: [] };
  };

  return rules.filter((r) => r.enabled).map((r) => {
    let qty: number | null = null;
    let status: MaterialRow['inputStatus'] = 'verified';
    let missing: string[] = [];
    switch (r.basis) {
      case 'area_squares': {
        const sq = (inp.areaSqFt * (r.useWaste ? 1 + inp.wastePercent / 100 : 1)) / 100;
        qty = sq > 0 ? sq : null;
        if (qty === null) { status = 'missing'; missing = ['roof area']; }
        break;
      }
      case 'eave_rake_lf': ({ v: qty, status, missing } = sumEdges(['eave', 'rake'])); break;
      case 'hip_ridge_lf': ({ v: qty, status, missing } = sumEdges(['hip', 'ridge'])); break;
      case 'ice_water_lf': ({ v: qty, status, missing } = sumEdges(['eave', 'valley'])); break;
      case 'ridge_lf': ({ v: qty, status, missing } = sumEdges(['ridge'])); break;
      case 'hip_lf': ({ v: qty, status, missing } = sumEdges(['hip'])); break;
      case 'valley_lf': ({ v: qty, status, missing } = sumEdges(['valley'])); break;
      case 'eave_lf': ({ v: qty, status, missing } = sumEdges(['eave'])); break;
      case 'rake_lf': ({ v: qty, status, missing } = sumEdges(['rake'])); break;
      case 'count': {
        const raw = r.countKey ? inp.counts[r.countKey] : undefined;
        if (typeof raw === 'number' && Number.isFinite(raw)) qty = raw;
        else { status = 'missing'; missing = [`${r.countKey ?? 'count'} (not entered)`]; }
        break;
      }
    }
    const exact = qty === null ? null : qty / r.coveragePerPackage;
    return {
      key: r.key, name: r.name, basis: r.basis, basisQuantity: qty === null ? null : round(qty, 2), basisUnit: unitOf(r.basis), coveragePerPackage: round(r.coveragePerPackage, 4),
      packageUnit: r.packageUnit, exactPackages: exact === null ? null : round(exact, 2), packages: exact === null ? null : Math.ceil(exact - 1e-9), inputStatus: qty === null ? 'missing' : status, missing, note: r.note,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Product-specific calculation (company catalog). Replaces the generic rules for reports and the materials screen.
// ---------------------------------------------------------------------------------------------------------------------

export const PRODUCT_FAMILIES = ['shingle', 'starter', 'ice_water', 'underlayment', 'hip_ridge', 'valley', 'drip_edge', 'flashing', 'accessory'] as const;
export type ProductFamily = (typeof PRODUCT_FAMILIES)[number];
export type LengthKey = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'step_flashing' | 'wall_flashing' | 'curb_flashing';

export type CatalogProduct = { id: string | null; family: ProductFamily; brand: string; name: string; packageUnit: string; coveragePerPackage: number; countKey?: string; specConfirmed: boolean; enabled: boolean; sortOrder?: number };

type FamilyDef = { label: string; basisLabel: string; unit: 'sqft' | 'ft' | 'each'; waste: boolean; required: LengthKey[]; optional: LengthKey[]; generic: { packageUnit: string; coverage: number } | null };

export const FAMILY_DEFS: Record<ProductFamily, FamilyDef> = {
  shingle: { label: 'Shingle', basisLabel: 'pitched area', unit: 'sqft', waste: true, required: [], optional: [], generic: { packageUnit: 'bundle', coverage: 100 / 3 } },
  starter: { label: 'Starter', basisLabel: 'eaves + rakes', unit: 'ft', waste: false, required: ['eave', 'rake'], optional: [], generic: { packageUnit: 'bundle', coverage: 105 } },
  ice_water: { label: 'Ice and water', basisLabel: 'eaves + valleys + flashings', unit: 'ft', waste: false, required: ['eave', 'valley'], optional: ['step_flashing', 'wall_flashing', 'curb_flashing'], generic: { packageUnit: 'roll', coverage: 66 } },
  underlayment: { label: 'Synthetic underlayment', basisLabel: 'pitched area, no laps', unit: 'sqft', waste: true, required: [], optional: [], generic: { packageUnit: 'roll', coverage: 1000 } },
  hip_ridge: { label: 'Capping (hips + ridges)', basisLabel: 'hips + ridges', unit: 'ft', waste: false, required: ['hip', 'ridge'], optional: [], generic: { packageUnit: 'bundle', coverage: 33 } },
  valley: { label: 'Valley', basisLabel: 'valleys', unit: 'ft', waste: false, required: ['valley'], optional: [], generic: { packageUnit: 'sheet', coverage: 8 } },
  drip_edge: { label: 'Drip edge', basisLabel: 'eaves + rakes', unit: 'ft', waste: false, required: ['eave', 'rake'], optional: [], generic: { packageUnit: 'piece', coverage: 10 } },
  flashing: { label: 'Flashing', basisLabel: 'step + wall + curb flashing', unit: 'ft', waste: false, required: [], optional: ['step_flashing', 'wall_flashing', 'curb_flashing'], generic: null },
  accessory: { label: 'Accessories', basisLabel: 'counts entered by staff', unit: 'each', waste: false, required: [], optional: [], generic: null },
};

export type ProductMaterialInput = {
  pitchedAreaSqFt: number;
  lengths: Partial<Record<LengthKey, EdgeInput>>;
  counts: Record<string, number | string>;
  wasteColumns: readonly number[];
};

export type ProductRow = { id: string | null; brand: string; name: string; packageUnit: string; coveragePerPackage: number; specConfirmed: boolean; generic: boolean; packages: Record<number, number | null> };
export type FamilyResult = {
  family: ProductFamily;
  label: string;
  basisLabel: string;
  unit: 'sqft' | 'ft' | 'each';
  /** Quantity of the basis at each waste percentage (area families) or constant (length families). Null = cannot be calculated. */
  basis: Record<number, number | null>;
  /** ready: every required input is verified. unverified / missing: no quantity is printed. no_product: nothing configured. */
  status: 'ready' | 'unverified' | 'missing' | 'no_product';
  blocking: string[];
  notes: string[];
  products: ProductRow[];
};

const LENGTH_LABEL: Record<LengthKey, string> = { ridge: 'ridge', hip: 'hip', valley: 'valley', eave: 'eave', rake: 'rake', step_flashing: 'step flashing', wall_flashing: 'wall flashing', curb_flashing: 'curb flashing' };

/**
 * Quantities per catalog product. Area families use the (provider measured) pitched area with waste; length families use ONLY
 * verified or staff-entered edge totals. If a required length is unverified or missing the family prints a reason, not a number.
 * Packages are always rounded up to whole packages.
 */
export function calculateProductMaterials(inp: ProductMaterialInput, catalog: CatalogProduct[]): FamilyResult[] {
  return PRODUCT_FAMILIES.map((family) => {
    const def = FAMILY_DEFS[family];
    const blocking: string[] = [];
    const notes: string[] = [];
    let status: FamilyResult['status'] = 'ready';
    let lengthSum: number | null = 0;
    if (def.unit === 'ft') {
      for (const k of def.required) {
        const e = inp.lengths[k];
        if (!e || e.ft === null || e.status === 'missing') { blocking.push(`${LENGTH_LABEL[k]} length is not confirmed (enter the measured length, or 0 ft if the roof has none)`); status = 'missing'; lengthSum = null; }
        else if (e.status === 'unverified') { blocking.push(`${LENGTH_LABEL[k]} length needs verification`); if (status !== 'missing') status = 'unverified'; lengthSum = null; }
        else if (lengthSum !== null) lengthSum += e.ft;
      }
      for (const k of def.optional) {
        const e = inp.lengths[k];
        if (e && e.ft !== null && e.status === 'verified') { if (lengthSum !== null) lengthSum += e.ft; }
        else if (e && e.ft !== null && e.status === 'unverified') notes.push(`${LENGTH_LABEL[k]} is derived but not verified, so it is not included`);
      }
      if (def.required.length === 0 && (lengthSum ?? 0) === 0) { status = 'missing'; blocking.push('no verified flashing lengths'); lengthSum = null; }
    }
    if (def.unit === 'sqft' && inp.pitchedAreaSqFt <= 0) { status = 'missing'; blocking.push('no pitched roof area'); }
    const basis: Record<number, number | null> = {};
    for (const w of inp.wasteColumns) {
      basis[w] = def.unit === 'sqft' ? (inp.pitchedAreaSqFt > 0 ? inp.pitchedAreaSqFt * (def.waste ? 1 + w / 100 : 1) : null) : def.unit === 'ft' ? lengthSum : null;
    }

    const mine = catalog.filter((p) => p.family === family && p.enabled).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.brand.localeCompare(b.brand));
    const rows: ProductRow[] = mine.map((p) => ({ id: p.id, brand: p.brand, name: p.name, packageUnit: p.packageUnit, coveragePerPackage: p.coveragePerPackage, specConfirmed: p.specConfirmed, generic: false, packages: {} }));
    if (rows.length === 0 && def.generic) rows.push({ id: null, brand: '', name: 'Generic estimate (no product configured)', packageUnit: def.generic.packageUnit, coveragePerPackage: def.generic.coverage, specConfirmed: false, generic: true, packages: {} });
    const finalStatus: FamilyResult['status'] = rows.length === 0 ? 'no_product' : status;

    if (family === 'accessory') {
      for (const r of rows) {
        const key = mine.find((p) => p.id === r.id)?.countKey;
        const raw = key ? inp.counts[key] : undefined;
        for (const w of inp.wasteColumns) r.packages[w] = typeof raw === 'number' && Number.isFinite(raw) ? Math.ceil(raw / r.coveragePerPackage - 1e-9) : null;
        if (typeof raw !== 'number') blocking.push(`${key ?? 'count'} was not entered`);
      }
    } else {
      for (const r of rows) {
        for (const w of inp.wasteColumns) {
          const b = basis[w];
          r.packages[w] = finalStatus === 'ready' && b !== null && b !== undefined ? Math.ceil(b / r.coveragePerPackage - 1e-9) : null;
        }
      }
    }
    return { family, label: def.label, basisLabel: def.basisLabel, unit: def.unit, basis, status: finalStatus, blocking, notes, products: rows };
  });
}
