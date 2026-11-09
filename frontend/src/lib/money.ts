/** Money is always integer cents. These helpers only convert at the UI edge. */

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${(abs % 100).toString().padStart(2, '0')}`;
}

/** Parses a dollar string ("12.34") into integer cents. Empty/invalid input -> 0. */
export function dollarsToCents(value: string): number {
  const n = Number(value.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

/** Parses a percent string ("8.25") into basis points (825). */
export function percentToBps(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}
