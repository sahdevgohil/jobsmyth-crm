import { AppError } from '../../utils/errors.js';
import type { LineItemKind } from '../settings/company-settings.model.js';

export type LineItemInput = {
  id: string;
  description: string;
  kind: LineItemKind;
  quantity: number;
  unit: string;
  unitCostCents: number;
  laborCostCents: number;
  materialCostCents: number;
};

export type CalculatedLineItem = LineItemInput & { amountCents: number };

export type EstimateTotals = {
  lineItems: CalculatedLineItem[];
  subtotalCents: number;
  discountCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
};

function assertSafeCents(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError({
      status: 422,
      code: 'INVALID_AMOUNT',
      message: 'Calculated amount is out of range.',
      details: [{ path, message: 'Amount out of range' }],
    });
  }
}

/**
 * Line amount = round(quantity x unitCostCents) + laborCostCents + materialCostCents.
 * `laborCostCents` / `materialCostCents` are flat per-line adders (default 0).
 */
export function calcLineAmountCents(
  item: Pick<LineItemInput, 'quantity' | 'unitCostCents' | 'laborCostCents' | 'materialCostCents'>,
): number {
  return (
    Math.round(item.quantity * item.unitCostCents) + item.laborCostCents + item.materialCostCents
  );
}

/**
 * Authoritative totals calculation. All values are integer cents.
 *
 * subtotal = sum(line amounts); taxable = subtotal - discount;
 * tax = round(taxable x taxRateBps / 10000) (half-up); total = taxable + tax.
 */
export function recalcTotals(
  lineItems: LineItemInput[],
  discountCents: number,
  taxRateBps: number,
): EstimateTotals {
  if (!Number.isSafeInteger(discountCents) || discountCents < 0) {
    throw new AppError({
      status: 422,
      code: 'INVALID_DISCOUNT',
      message: 'Discount must be a non-negative whole number of cents.',
      details: [{ path: 'discountCents', message: 'Invalid discount' }],
    });
  }
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
    throw new AppError({
      status: 422,
      code: 'INVALID_TAX_RATE',
      message: 'Tax rate must be between 0 and 10000 basis points.',
      details: [{ path: 'taxRateBps', message: 'Invalid tax rate' }],
    });
  }

  const calculated = lineItems.map((item, index) => {
    const amountCents = calcLineAmountCents(item);
    assertSafeCents(amountCents, `lineItems.${index}.amountCents`);
    return { ...item, amountCents };
  });

  const subtotalCents = calculated.reduce((sum, item) => sum + item.amountCents, 0);
  assertSafeCents(subtotalCents, 'subtotalCents');
  if (discountCents > subtotalCents) {
    throw new AppError({
      status: 422,
      code: 'INVALID_DISCOUNT',
      message: 'Discount cannot exceed the subtotal.',
      details: [{ path: 'discountCents', message: 'Discount exceeds subtotal' }],
    });
  }
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round((taxableCents * taxRateBps) / 10000);
  const totalCents = taxableCents + taxCents;
  assertSafeCents(totalCents, 'totalCents');

  return { lineItems: calculated, subtotalCents, discountCents, taxRateBps, taxCents, totalCents };
}

export type ClientTotals = {
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  /** Client-supplied per-line amounts, keyed by line index. */
  lineAmounts?: Array<number | undefined>;
};

/** Rejects (422) any client-supplied figure that disagrees with the backend calculation. */
export function assertClientTotalsMatch(client: ClientTotals, computed: EstimateTotals): void {
  const details: Array<{ path: string; message: string }> = [];
  if (client.subtotalCents !== undefined && client.subtotalCents !== computed.subtotalCents) {
    details.push({ path: 'subtotalCents', message: 'Does not match calculated subtotal' });
  }
  if (client.taxCents !== undefined && client.taxCents !== computed.taxCents) {
    details.push({ path: 'taxCents', message: 'Does not match calculated tax' });
  }
  if (client.totalCents !== undefined && client.totalCents !== computed.totalCents) {
    details.push({ path: 'totalCents', message: 'Does not match calculated total' });
  }
  client.lineAmounts?.forEach((amount, index) => {
    const line = computed.lineItems[index];
    if (amount !== undefined && line && amount !== line.amountCents) {
      details.push({
        path: `lineItems.${index}.amountCents`,
        message: 'Does not match calculated line amount',
      });
    }
  });
  if (details.length > 0) {
    throw new AppError({
      status: 422,
      code: 'TOTAL_MISMATCH',
      message: 'Client-supplied totals do not match the backend calculation.',
      details,
    });
  }
}
