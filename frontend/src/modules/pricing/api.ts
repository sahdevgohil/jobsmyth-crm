import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/http';

export type PackageKey = 'good' | 'better' | 'best';

export type CatalogItem = { key: string; name: string; unit: string; basis: string; kind: string; rates: Record<PackageKey, number | null>; optional?: boolean; wasteIncludedInRate?: boolean };
export type CatalogPackage = { key: PackageKey; name: string; perSquareLowCents: number; perSquareHighCents: number; warrantyYears?: number; warrantyIsPlaceholder?: boolean; manufacturerEligibility?: string; description?: string };

export type Catalog = {
  id: string;
  name: string;
  status: 'draft' | 'approved' | 'retired';
  version: number;
  effectiveFrom: string | null;
  validityDays: number;
  source: string;
  sourceNote: string;
  packages: CatalogPackage[];
  items: CatalogItem[];
  conditionalCharges: Array<{ key: string; name: string; unit: string; rateCents: number | null; note?: string }>;
  taxRateBps: number | null;
  approvedAt: string | null;
  usableForProposals: boolean;
};

export type QuoteInput = {
  package: PackageKey;
  squares: number;
  pitch?: string;
  stories?: number;
  extraLayers?: number;
  osbSheets?: number;
  plywoodSheets?: number;
  reDeckSquares?: number;
  permitCents?: number;
  discountCents?: number;
  taxRateBps?: number;
  optionalItemKeys?: string[];
  /** Catalog quantity bases (drip_edge_lf, ridge_lf, pipe_boots, ...). */
  quantities?: Record<string, number>;
};

export type QuoteLine = { key: string; description: string; kind: string; quantity: number; unit: string; unitCostCents: number; amountCents: number; included: boolean; conditional: boolean; note?: string };
export type Quote = {
  package: PackageKey;
  lines: QuoteLine[];
  subtotalCents: number;
  discountCents: number;
  taxRateBps: number | null;
  taxCents: number;
  totalCents: number;
  rangeLowCents: number;
  rangeHighCents: number;
  warnings: string[];
  catalog: { id: string; version: number; status: string; usableForProposals: boolean };
  validUntil: string;
  draftWarning?: string;
};

export type Rate = { key: string; category: string; name: string; unit: string; rateCents: number | null; minCents?: number; maxCents?: number; notes?: string; materialsIncluded?: boolean | null };
export type RateCard = { id: string; name: string; status: string; version: number; subcontractorId: string | null; source: string; inclusionsNote: string; rates: Rate[]; approvedAt: string | null };

export type CostLine = {
  id?: string;
  kind: 'subcontractor' | 'material' | 'other';
  description?: string;
  unit?: string;
  quantity: number;
  unitCostCents?: number;
  rateCardId?: string;
  rateKey?: string;
  overridden?: boolean;
  overrideReason?: string;
};
export type CostSheet = {
  estimateId: string;
  lines: Array<CostLine & { id: string; description: string; unit: string; unitCostCents: number; totalCents: number }>;
  materialCostCents: number;
  subcontractorCostCents: number;
  otherCostCents: number;
  totalCostCents: number;
  sellingPriceCents?: number;
  grossProfitCents?: number;
  marginBps?: number | null;
};

const j = (b: unknown): string => JSON.stringify(b);

export function useCatalogs() {
  return useQuery({ queryKey: ['pricing', 'catalogs'], queryFn: () => apiFetch<{ data: Catalog[] }>('/pricing/catalogs').then((r) => r.data) });
}

export function usePricingMutations() {
  const qc = useQueryClient();
  const done = (): Promise<void> => qc.invalidateQueries({ queryKey: ['pricing'] });
  return {
    install: useMutation({ mutationFn: () => apiFetch('/pricing/install-defaults', { method: 'POST' }), onSuccess: done }),
    updateCatalog: useMutation({ mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) => apiFetch<{ data: Catalog }>(`/pricing/catalogs/${id}`, { method: 'PATCH', body: j(b) }).then((r) => r.data), onSuccess: done }),
    approveCatalog: useMutation({ mutationFn: (id: string) => apiFetch<{ data: Catalog }>(`/pricing/catalogs/${id}/approve`, { method: 'POST' }).then((r) => r.data), onSuccess: done }),
    quote: useMutation({ mutationFn: (b: { catalogId: string; input: QuoteInput }) => apiFetch<{ data: Quote }>('/pricing/quote', { method: 'POST', body: j(b) }).then((r) => r.data) }),
    createEstimate: useMutation({
      mutationFn: (b: { catalogId: string; customerId: string; propertyId: string; inspectionId?: string; measurementId?: string; notes?: string; quote: QuoteInput }) =>
        apiFetch<{ data: { estimate: { id: string }; quote: Quote } }>('/pricing/estimates', { method: 'POST', body: j(b) }).then((r) => r.data),
    }),
    updateRateCard: useMutation({ mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) => apiFetch<{ data: RateCard }>(`/pricing/rate-cards/${id}`, { method: 'PATCH', body: j(b) }).then((r) => r.data), onSuccess: done }),
    approveRateCard: useMutation({ mutationFn: (id: string) => apiFetch<{ data: RateCard }>(`/pricing/rate-cards/${id}/approve`, { method: 'POST' }).then((r) => r.data), onSuccess: done }),
  };
}

export function useRateCards(enabled = true) {
  return useQuery({ queryKey: ['pricing', 'rate-cards'], enabled, queryFn: () => apiFetch<{ data: RateCard[] }>('/pricing/rate-cards').then((r) => r.data) });
}

export function useCostSheet(estimateId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: ['pricing', 'costs', estimateId], enabled: enabled && Boolean(estimateId), queryFn: () => apiFetch<{ data: CostSheet }>(`/pricing/estimates/${estimateId}/costs`).then((r) => r.data) });
}

export function useSaveCostSheet(estimateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lines: CostLine[]) => apiFetch<{ data: CostSheet }>(`/pricing/estimates/${estimateId}/costs`, { method: 'PUT', body: j({ lines }) }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricing', 'costs', estimateId] }),
  });
}

export const dollars = (cents: number | null | undefined): string => (cents === null || cents === undefined ? '—' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
export const pct = (bps: number | null | undefined): string => (bps === null || bps === undefined ? '—' : `${(bps / 100).toFixed(1)}%`);
