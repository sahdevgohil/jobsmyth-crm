import { centsToDollars, dollarsToCents } from '@/lib/money';
import type { EstimateLineItem, LineItemKind, StandardLineItem } from './types';

export type LineDraft = {
  key: string;
  id?: string;
  description: string;
  kind: LineItemKind;
  quantity: string;
  unit: string;
  unitDollars: string;
  laborDollars: string;
  materialDollars: string;
};

let counter = 0;
function nextKey(): string {
  counter += 1;
  return `line-${counter}`;
}

export function emptyLine(): LineDraft {
  return {
    key: nextKey(),
    description: '',
    kind: 'material',
    quantity: '1',
    unit: 'ea',
    unitDollars: '0.00',
    laborDollars: '0.00',
    materialDollars: '0.00',
  };
}

export function lineFromStandard(item: StandardLineItem): LineDraft {
  return {
    ...emptyLine(),
    description: item.label,
    kind: item.kind,
    unit: item.unit,
    unitDollars: centsToDollars(item.unitCostCents),
  };
}

export function draftsFromEstimate(items: EstimateLineItem[]): LineDraft[] {
  return items.map((item) => ({
    key: nextKey(),
    id: item.id,
    description: item.description,
    kind: item.kind,
    quantity: String(item.quantity),
    unit: item.unit,
    unitDollars: centsToDollars(item.unitCostCents),
    laborDollars: centsToDollars(item.laborCostCents),
    materialDollars: centsToDollars(item.materialCostCents),
  }));
}

/** Builds the API payload. Amounts/totals are intentionally never sent: the server calculates them. */
export function draftsToPayload(drafts: LineDraft[]): Array<Record<string, unknown>> {
  return drafts.map((d) => ({
    id: d.id,
    description: d.description.trim(),
    kind: d.kind,
    quantity: Number(d.quantity) || 0,
    unit: d.unit.trim() || 'ea',
    unitCostCents: dollarsToCents(d.unitDollars),
    laborCostCents: dollarsToCents(d.laborDollars),
    materialCostCents: dollarsToCents(d.materialDollars),
  }));
}
