/**
 * Customer quote engine (pure, integer cents). Turns a catalog + job measurements into estimate lines.
 *
 * Rules taken from the client price sheet:
 *  - Field-shingle rates already include a 10-15% waste factor: waste is never added to them.
 *  - Conditional charges are added only when their trigger applies (pitch band, stories, extra layers, sheets, re-deck).
 *  - Permit and city fees are "at cost": the amount is entered per job and never guessed.
 *  - Tax is explicit: no rate is assumed (pending company/CPA confirmation).
 */
import type { ConditionalChargeSeed, PackageKey, QuantityBasis } from './default-catalogs.js';

export type CatalogItem = {
  key: string;
  name: string;
  unit: string;
  basis: QuantityBasis;
  kind: 'material' | 'labor' | 'other';
  rates: Record<PackageKey, number | null>;
  optional?: boolean;
  wasteIncludedInRate?: boolean;
  wasteApplies?: boolean;
};

export type QuoteCatalog = {
  items: CatalogItem[];
  conditionalCharges: ConditionalChargeSeed[];
  packages: Array<{ key: PackageKey; name: string; perSquareLowCents: number; perSquareHighCents: number }>;
};

export type QuoteInput = {
  package: PackageKey;
  /** Roof squares (1 SQ = 100 sq ft). */
  squares: number;
  /** Roof pitch as `rise/12`, e.g. `8/12`. */
  pitch?: string;
  stories?: number;
  /** Tear-off layers beyond the first. */
  extraLayers?: number;
  quantities?: Partial<Record<Exclude<QuantityBasis, 'squares' | 'included'>, number>>;
  osbSheets?: number;
  plywoodSheets?: number;
  reDeckSquares?: number;
  /** Actual permit / city fees, in cents (at cost). */
  permitCents?: number;
  optionalItemKeys?: string[];
  /** Extra waste in basis points, applied only to items flagged `wasteApplies` and never to rates that already include waste. */
  wasteBps?: number;
  discountCents?: number;
  /** Explicit tax rate in basis points; omitted = no tax calculated (pending confirmation). */
  taxRateBps?: number;
};

export type QuoteLine = {
  key: string;
  description: string;
  kind: 'material' | 'labor' | 'other';
  quantity: number;
  unit: string;
  unitCostCents: number;
  amountCents: number;
  included: boolean;
  conditional: boolean;
  note?: string;
};

export type Quote = {
  package: PackageKey;
  lines: QuoteLine[];
  subtotalCents: number;
  discountCents: number;
  taxRateBps: number | null;
  taxCents: number;
  totalCents: number;
  /** Package per-square range × squares, for the "price range, not a guaranteed total" display. */
  rangeLowCents: number;
  rangeHighCents: number;
  warnings: string[];
};

const round = (n: number): number => Math.round(n);

export function pitchRise(pitch: string | undefined): number | null {
  const m = /^\s*(\d{1,2})\s*\/\s*12\s*$/.exec(pitch ?? '');
  return m ? Number(m[1]) : null;
}

function qtyFor(basis: QuantityBasis, input: QuoteInput): number {
  if (basis === 'squares') return input.squares;
  if (basis === 'included') return 0;
  return input.quantities?.[basis] ?? 0;
}

export function computeQuote(catalog: QuoteCatalog, input: QuoteInput): Quote {
  const warnings: string[] = [];
  const pkg = catalog.packages.find((p) => p.key === input.package);
  if (!pkg) throw new Error(`Unknown package ${input.package}`);
  if (!Number.isFinite(input.squares) || input.squares <= 0) throw new Error('squares must be greater than zero');
  const lines: QuoteLine[] = [];
  const optional = new Set(input.optionalItemKeys ?? []);

  for (const item of catalog.items) {
    if (item.optional && !optional.has(item.key)) continue;
    const rate = item.rates[input.package];
    if (rate === null || item.basis === 'included') {
      lines.push({ key: item.key, description: item.name, kind: item.kind, quantity: 1, unit: 'included', unitCostCents: 0, amountCents: 0, included: true, conditional: false });
      continue;
    }
    let quantity = qtyFor(item.basis, input);
    if (quantity <= 0) {
      if (!item.optional && item.basis !== 'squares') warnings.push(`No quantity entered for "${item.name}" (${item.unit}); it was left out of the quote.`);
      continue;
    }
    if (input.wasteBps && input.wasteBps > 0 && item.wasteApplies && !item.wasteIncludedInRate) {
      quantity = Math.round(quantity * (1 + input.wasteBps / 10_000) * 100) / 100;
    }
    lines.push({ key: item.key, description: item.name, kind: item.kind, quantity, unit: item.unit, unitCostCents: rate, amountCents: round(quantity * rate), included: false, conditional: false });
  }

  // Conditional charges
  const rise = pitchRise(input.pitch);
  if (input.pitch && rise === null) warnings.push('Pitch was not understood; use rise/12 (e.g. 8/12). No steep-pitch charge was applied.');
  if (rise !== null && rise > 12) warnings.push('Pitch above 12/12 is outside the price sheet; price it manually.');
  const apply = (trigger: ConditionalChargeSeed['trigger'], quantity: number, extraNote?: string): void => {
    const c = catalog.conditionalCharges.find((x) => x.trigger === trigger);
    if (!c || quantity <= 0) return;
    if (c.rateCents === null) return;
    lines.push({ key: c.key, description: c.name, kind: trigger.startsWith('osb') || trigger.startsWith('plywood') ? 'material' : 'labor', quantity, unit: c.unit, unitCostCents: c.rateCents, amountCents: round(quantity * c.rateCents), included: false, conditional: true, note: extraNote });
  };
  if (rise !== null && rise >= 7 && rise <= 9) apply('pitch_7_9', input.squares);
  if (rise !== null && rise >= 10 && rise <= 12) apply('pitch_10_12', input.squares);
  if ((input.stories ?? 1) >= 2) apply('stories_2plus', input.squares);
  if ((input.extraLayers ?? 0) > 0) apply('extra_layers', input.squares * (input.extraLayers ?? 0), `${input.extraLayers} additional layer(s)`);
  apply('osb_sheets', input.osbSheets ?? 0);
  apply('plywood_sheets', input.plywoodSheets ?? 0);
  apply('redeck_sq', input.reDeckSquares ?? 0);
  const permit = catalog.conditionalCharges.find((c) => c.trigger === 'permit_at_cost');
  if (permit) {
    if (input.permitCents && input.permitCents > 0) {
      lines.push({ key: permit.key, description: permit.name, kind: 'other', quantity: 1, unit: 'at cost', unitCostCents: input.permitCents, amountCents: input.permitCents, included: false, conditional: true, note: 'At cost' });
    } else {
      warnings.push('Permit and city fees are at cost; add the actual amount when known.');
    }
  }

  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const discountCents = input.discountCents ?? 0;
  if (discountCents < 0 || discountCents > subtotalCents) throw new Error('discount must be between zero and the subtotal');
  const taxable = subtotalCents - discountCents;
  const taxRateBps = input.taxRateBps ?? null;
  if (taxRateBps === null) warnings.push('No tax rate applied: tax treatment is pending company/CPA confirmation.');
  const taxCents = taxRateBps === null ? 0 : round((taxable * taxRateBps) / 10_000);
  return {
    package: input.package,
    lines,
    subtotalCents,
    discountCents,
    taxRateBps,
    taxCents,
    totalCents: taxable + taxCents,
    rangeLowCents: round(pkg.perSquareLowCents * input.squares),
    rangeHighCents: round(pkg.perSquareHighCents * input.squares),
    warnings,
  };
}
