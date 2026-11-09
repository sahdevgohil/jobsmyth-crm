/**
 * Default price data transcribed from the client documents:
 *   - "Roof Replacement Price Sheet — Good / Better / Best" (customer selling prices, 2026 Texas asphalt shingle)
 *   - "Sub-Contractor Price List" (INTERNAL costs)
 * Both are seeded as DRAFT / UNAPPROVED. The source sheet states that individual line-item prices are
 * estimates and must be validated against supplier and crew rates, so an authorised administrator
 * must approve a catalog before it can be used on a proposal. All money is integer cents.
 */

export type PackageKey = 'good' | 'better' | 'best';
export const PACKAGE_KEYS: PackageKey[] = ['good', 'better', 'best'];

/** What quantity an item is multiplied by. `included` items carry no quantity or charge. */
export type QuantityBasis =
  | 'squares'
  | 'leak_barrier_sq'
  | 'drip_edge_lf'
  | 'starter_lf'
  | 'ridge_lf'
  | 'ridge_vent_lf'
  | 'box_vents'
  | 'pipe_boots'
  | 'exhaust_caps'
  | 'step_flashing_lf'
  | 'headwall_lf'
  | 'chimney_kits'
  | 'satellite_dishes'
  | 'included';

export type CatalogItemSeed = {
  key: string;
  name: string;
  unit: 'SQ' | 'LF' | 'EA' | 'Included';
  basis: QuantityBasis;
  kind: 'material' | 'labor' | 'other';
  /** Rate in cents per package; `null` = included in the package price. */
  rates: Record<PackageKey, number | null>;
  /** Only added to a quote when selected. */
  optional?: boolean;
  /** The supplied rate already contains the 10–15% waste factor: never add another. */
  wasteIncludedInRate?: boolean;
  /** Apply the quote waste factor to this item's quantity (when a waste factor is configured). */
  wasteApplies?: boolean;
};

export type ConditionalChargeSeed = {
  key: string;
  name: string;
  unit: 'SQ' | 'sheet' | 'at cost';
  /** `null` = at cost (amount entered per job). */
  rateCents: number | null;
  trigger: 'pitch_7_9' | 'pitch_10_12' | 'stories_2plus' | 'extra_layers' | 'osb_sheets' | 'plywood_sheets' | 'redeck_sq' | 'permit_at_cost';
  note?: string;
};

const flat = (c: number): Record<PackageKey, number | null> => ({ good: c, better: c, best: c });
const trio = (g: number, b: number, t: number): Record<PackageKey, number | null> => ({ good: g, better: b, best: t });
const included: Record<PackageKey, number | null> = { good: null, better: null, best: null };

export const CUSTOMER_CATALOG_SEED = {
  name: '2026 Texas asphalt-shingle roof replacement — Good / Better / Best',
  source: 'Client price sheet "Roof Replacement Price Sheet — Good / Better / Best" (2026, Texas asphalt shingle).',
  sourceNote:
    'Individual line-item prices are estimates and must be validated against supplier and crew rates. ' +
    'Field-shingle rates already include a 10–15% waste factor; do not add another.',
  validityDays: 30,
  packages: [
    {
      key: 'good' as const,
      name: 'GOOD',
      perSquareLowCents: 45_000,
      perSquareHighCents: 49_500,
      example25SquaresLowCents: 1_125_000,
      example25SquaresHighCents: 1_237_500,
      features: [
        'Architectural shingles',
        'Standard synthetic underlayment',
        'Leak barrier in valleys',
        'Existing vents replaced',
        'Neoprene pipe boots',
        'Standard limited manufacturer warranty',
      ],
      workmanshipWarrantyYears: 5,
      workmanshipWarrantyIsPlaceholder: true,
      manufacturerWarrantyEligibilityConfirmed: false,
    },
    {
      key: 'better' as const,
      name: 'BETTER',
      perSquareLowCents: 52_500,
      perSquareHighCents: 57_500,
      example25SquaresLowCents: 1_312_500,
      example25SquaresHighCents: 1_437_500,
      features: [
        'Premium architectural shingles',
        'Premium synthetic underlayment',
        'Leak barrier in valleys and penetrations',
        'Ridge vent where roof allows',
        'Lead or premium pipe boot',
        'Enhanced system warranty',
      ],
      workmanshipWarrantyYears: 10,
      workmanshipWarrantyIsPlaceholder: true,
      manufacturerWarrantyEligibilityConfirmed: false,
    },
    {
      key: 'best' as const,
      name: 'BEST',
      perSquareLowCents: 65_000,
      perSquareHighCents: 72_500,
      example25SquaresLowCents: 1_625_000,
      example25SquaresHighCents: 1_812_500,
      features: [
        'Class 4 impact-resistant shingles',
        'UL 2218 impact rating',
        'Top-tier synthetic underlayment',
        'Leak barrier in valleys, penetrations and eaves',
        'Balanced ridge and intake ventilation',
        'Lead pipe boots',
        'Top-tier manufacturer system warranty',
      ],
      workmanshipWarrantyYears: 25,
      workmanshipWarrantyIsPlaceholder: true,
      manufacturerWarrantyEligibilityConfirmed: false,
    },
  ],
  items: [
    { key: 'tear_off', name: 'Tear-off and disposal, one layer', unit: 'SQ', basis: 'squares', kind: 'labor', rates: flat(7_500) },
    { key: 'deck_inspection', name: 'Deck inspection and re-nail', unit: 'Included', basis: 'included', kind: 'labor', rates: included },
    { key: 'underlayment', name: 'Synthetic underlayment', unit: 'SQ', basis: 'squares', kind: 'material', rates: trio(2_500, 3_500, 4_500) },
    { key: 'leak_barrier', name: 'Leak barrier', unit: 'SQ', basis: 'leak_barrier_sq', kind: 'material', rates: trio(11_000, 12_000, 13_000) },
    { key: 'drip_edge', name: 'Drip edge', unit: 'LF', basis: 'drip_edge_lf', kind: 'material', rates: trio(350, 400, 450) },
    { key: 'starter_strip', name: 'Starter strip', unit: 'LF', basis: 'starter_lf', kind: 'material', rates: trio(225, 250, 275) },
    { key: 'field_shingles', name: 'Field shingles', unit: 'SQ', basis: 'squares', kind: 'material', rates: trio(28_500, 33_500, 42_000), wasteIncludedInRate: true },
    { key: 'hip_ridge_cap', name: 'Hip and ridge cap', unit: 'LF', basis: 'ridge_lf', kind: 'material', rates: trio(800, 900, 1_100) },
    { key: 'ridge_vent', name: 'Ridge vent', unit: 'LF', basis: 'ridge_vent_lf', kind: 'material', rates: trio(900, 1_000, 1_200) },
    { key: 'box_vent', name: 'Box/turtle vent', unit: 'EA', basis: 'box_vents', kind: 'material', rates: trio(4_500, 5_500, 6_500) },
    { key: 'pipe_boot', name: 'Pipe boot', unit: 'EA', basis: 'pipe_boots', kind: 'material', rates: trio(4_000, 5_500, 7_500) },
    { key: 'exhaust_vent_cap', name: 'Exhaust vent cap', unit: 'EA', basis: 'exhaust_caps', kind: 'material', rates: trio(6_500, 7_500, 8_500) },
    { key: 'step_flashing', name: 'Step flashing', unit: 'LF', basis: 'step_flashing_lf', kind: 'material', rates: trio(1_000, 1_100, 1_200) },
    { key: 'headwall_flashing', name: 'Counter/headwall flashing', unit: 'LF', basis: 'headwall_lf', kind: 'material', rates: trio(1_400, 1_500, 1_600) },
    { key: 'chimney_flashing_kit', name: 'Chimney flashing kit', unit: 'EA', basis: 'chimney_kits', kind: 'material', rates: trio(35_000, 45_000, 55_000) },
    { key: 'satellite_dish', name: 'Satellite dish detach/reset', unit: 'EA', basis: 'satellite_dishes', kind: 'labor', rates: flat(7_500), optional: true },
    { key: 'paint_penetrations', name: 'Paint penetrations', unit: 'Included', basis: 'included', kind: 'labor', rates: included },
    { key: 'site_cleanup', name: 'Magnetic nail sweep/site cleanup', unit: 'Included', basis: 'included', kind: 'labor', rates: included },
  ] as CatalogItemSeed[],
  conditionalCharges: [
    { key: 'steep_7_9', name: 'Steep pitch 7/12–9/12', unit: 'SQ', rateCents: 3_500, trigger: 'pitch_7_9' },
    { key: 'steep_10_12', name: 'Steep pitch 10/12–12/12', unit: 'SQ', rateCents: 6_000, trigger: 'pitch_10_12' },
    { key: 'two_story', name: 'Two-story or more', unit: 'SQ', rateCents: 1_500, trigger: 'stories_2plus' },
    { key: 'extra_layer', name: 'Each additional tear-off layer', unit: 'SQ', rateCents: 4_500, trigger: 'extra_layers' },
    { key: 'osb_replace', name: '7/16-inch OSB replacement', unit: 'sheet', rateCents: 8_500, trigger: 'osb_sheets' },
    { key: 'plywood_replace', name: '1/2-inch plywood replacement', unit: 'sheet', rateCents: 9_500, trigger: 'plywood_sheets' },
    { key: 'redeck_skip', name: 'Re-deck over skip sheathing', unit: 'SQ', rateCents: 17_500, trigger: 'redeck_sq' },
    { key: 'permit_fees', name: 'Permit and city fees', unit: 'at cost', rateCents: null, trigger: 'permit_at_cost', note: 'At cost — enter the actual fee per job.' },
  ] as ConditionalChargeSeed[],
};

// ----------------------------------------------------------------- subcontractor (internal) rates

export type RateSeed = {
  key: string;
  category: string;
  name: string;
  unit: string;
  /** Fixed rate in cents; `null` when the source gives a range. */
  rateCents: number | null;
  minCents?: number;
  maxCents?: number;
  notes?: string;
  /** The source states "materials delivered on the ground and hand loading" for shingle pricing only. */
  materialsIncluded?: boolean | null;
};

const sq = (key: string, category: string, name: string, cents: number, notes?: string): RateSeed => ({ key, category, name, unit: 'SQ', rateCents: cents, notes, materialsIncluded: category === 'Shingles' || category === 'Fortified roof' ? true : null });

export const SUBCONTRACTOR_RATE_CARD_SEED = {
  name: 'Sub-Contractor Price List',
  source: 'Client document "Sub-Contractor Price List" (internal cost document, not customer pricing).',
  inclusionsNote:
    'Source: pricing includes materials delivered on the ground and hand loading. ' +
    'Do not assume the same inclusions apply to separately listed labor items without confirmation.',
  rates: [
    // Shingles — pitch pricing (per square)
    sq('shingle_up_to_7_12', 'Shingles', 'Up to 7/12 pitch — Lifetime Shingles', 8_000),
    sq('shingle_8_12', 'Shingles', '8/12 pitch', 8_500),
    sq('shingle_9_12', 'Shingles', '9/12 pitch', 9_000),
    sq('shingle_10_12', 'Shingles', '10/12 pitch', 9_500),
    sq('shingle_11_12', 'Shingles', '11/12 pitch', 10_000),
    sq('shingle_12_12', 'Shingles', '12/12 pitch', 10_500),
    sq('shingle_mansard', 'Shingles', 'Mansard roof', 11_500),
    // Fortified roof
    sq('fortified_one_story', 'Fortified roof', 'Fortified roof — one story', 10_000, 'Includes nailing of decking.'),
    sq('fortified_two_story', 'Fortified roof', 'Fortified roof — two story', 11_000, 'Includes nailing of decking.'),
    // Permit roof
    sq('permit_two_ply_felt', 'Permit roof', 'Two-ply felt additional', 1_000),
    // Other shingle charges
    sq('other_two_story', 'Other shingle charges', 'Two-story charge', 500),
    sq('other_asbestos', 'Other shingle charges', 'Asbestos removal', 1_500),
    sq('other_trash_on_ground', 'Other shingle charges', 'Trash on ground, no haul-off', 1_500),
    sq('other_additional_layers', 'Other shingle charges', 'Additional layers up to 7/12', 2_000),
    { key: 'other_plywood', category: 'Other shingle charges', name: 'Plywood', unit: 'sheet', rateCents: 2_000, materialsIncluded: null },
    sq('other_roof_over', 'Other shingle charges', 'Roof over', 5_000),
    // Flat roofs
    sq('flat_single_ply', 'Flat roofs', 'Install single ply and drip edge', 11_500),
    sq('flat_single_off_on', 'Flat roofs', 'Single off and on with drip edge', 15_000),
    sq('flat_iso_board', 'Flat roofs', 'ISO board', 6_000),
    sq('flat_densdeck', 'Flat roofs', 'DensDeck', 6_000),
    sq('flat_cap_sheet', 'Flat roofs', 'Cap sheet, two-ply', 11_500),
    sq('flat_coating_pressure_wash', 'Flat roofs', 'Coating / pressure washing', 1_500),
    sq('flat_coating', 'Flat roofs', 'Coating', 5_000),
    { key: 'flat_wall_capping', category: 'Flat roofs', name: 'Wall capping', unit: 'LF', rateCents: 400, materialsIncluded: null },
    // Miscellaneous
    { key: 'misc_clay_tile', category: 'Miscellaneous', name: 'Remove/replace clay tiles', unit: 'tile', rateCents: 100, materialsIncluded: null },
    { key: 'misc_soffit_fascia', category: 'Miscellaneous', name: 'Soffit and fascia', unit: 'LF', rateCents: 650, materialsIncluded: null },
    // Additional labor items
    { key: 'labor_patio_cover', category: 'Additional labor items', name: 'Insulated patio cover labor', unit: 'SF', rateCents: 425, materialsIncluded: null },
    { key: 'labor_clay_tile', category: 'Additional labor items', name: 'Clay tile remove/replace', unit: 'each', rateCents: 100, materialsIncluded: null },
    { key: 'labor_demo_fireplace', category: 'Additional labor items', name: 'Demo fireplace', unit: 'job', rateCents: null, minCents: 30_000, maxCents: 50_000, notes: 'Source gives a range ($300–$500).', materialsIncluded: null },
    { key: 'labor_gutter', category: 'Additional labor items', name: 'Gutter material and labor', unit: 'LF', rateCents: 900, materialsIncluded: null },
    sq('labor_hardie', 'Additional labor items', 'Hardie installation', 25_000),
    // Labor rate
    { key: 'labor_half_day', category: 'Labor rate', name: 'Labor — half day', unit: 'half day', rateCents: 30_000, materialsIncluded: null },
    { key: 'labor_full_day', category: 'Labor rate', name: 'Labor — full day', unit: 'day', rateCents: 60_000, materialsIncluded: null },
  ] as RateSeed[],
};
