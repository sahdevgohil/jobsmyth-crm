import { brandLogoImg } from '../../assets/brand.js';
import { escapeHtml } from '../inspections/inspection.report.js';
import type { EstimateDto } from './estimate.service.js';

export type EstimatePreviewData = {
  company: {
    name: string;
    phone: string;
    email: string;
    website: string;
    licenseText: string;
    termsText: string;
    timeZone: string;
  };
  estimate: EstimateDto;
  customer: { name: string; email: string; phone: string };
  propertyAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  } | null;
};

/** Formats integer cents for display only (no arithmetic on the formatted value). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${(abs % 100).toString().padStart(2, '0')}`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function formatDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatAddress(address: EstimatePreviewData['propertyAddress']): string {
  if (!address) return 'Address unavailable';
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [address.line1, address.line2, cityLine].filter(Boolean).join(', ');
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
  void: 'Void',
};

export function renderEstimateHtml(data: EstimatePreviewData): string {
  const { company, estimate, customer } = data;
  const tz = company.timeZone;
  const address = formatAddress(data.propertyAddress);
  const contactBits = [company.phone, company.email, company.website]
    .filter((v) => v.trim())
    .map(escapeHtml)
    .join(' &middot; ');

  const rows = estimate.lineItems
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.description)}</td>
        <td>${escapeHtml(item.kind)}</td>
        <td class="num">${escapeHtml(String(item.quantity))} ${escapeHtml(item.unit)}</td>
        <td class="num">${formatCents(item.unitCostCents)}</td>
        <td class="num">${formatCents(item.laborCostCents)}</td>
        <td class="num">${formatCents(item.materialCostCents)}</td>
        <td class="num">${formatCents(item.amountCents)}</td>
      </tr>`,
    )
    .join('');
  const table = estimate.lineItems.length
    ? `<table><thead><tr><th>Description</th><th>Type</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Labor</th><th class="num">Materials</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty">No line items.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estimate ${escapeHtml(estimate.number)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #303030; margin: 0; padding: 32px; background: #fff; line-height: 1.5; }
  .page { max-width: 860px; margin: 0 auto; }
  header { border-bottom: 3px solid #c32930; padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 20px; }
  header .brand-text { flex: 1; }
  header h1 { margin: 0; font-size: 20px; color: #3c3c3c; }
  .sub { color: #898989; font-size: 13px; }
  h2 { color: #c32930; font-size: 16px; margin: 24px 0 6px; border-bottom: 1px solid #e1e1e1; padding-bottom: 4px; }
  .title { font-size: 20px; font-weight: bold; margin: 0 0 4px; }
  .grid { display: table; width: 100%; }
  .row { display: table-row; }
  .label, .value { display: table-cell; padding: 3px 0; vertical-align: top; font-size: 14px; }
  .label { width: 160px; color: #6b7280; }
  .text { white-space: pre-wrap; margin: 4px 0; font-size: 14px; }
  .empty { color: #9ca3af; font-style: italic; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  th, td { border: 1px solid #e1e1e1; padding: 6px 8px; text-align: left; }
  th { background: #eeeeee; color: #3c3c3c; }
  .num { text-align: right; white-space: nowrap; }
  table.totals { width: 320px; margin-left: auto; margin-top: 12px; }
  table.totals td { border: none; border-bottom: 1px solid #e5e7eb; }
  table.totals tr.grand td { font-weight: bold; font-size: 15px; border-top: 2px solid #c32930; }
  .void { color: #c32930; font-weight: bold; }
  footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #e1e1e1; font-size: 12px; color: #6b7280; }
  @media print { body { padding: 0; } section { page-break-inside: avoid; } }
</style>
</head>
<body>
<div class="page">
  <header>
    ${brandLogoImg(130)}
    <div class="brand-text">
      <h1>${escapeHtml(company.name)}</h1>
      ${contactBits ? `<div class="sub">${contactBits}</div>` : ''}
      ${company.licenseText.trim() ? `<div class="sub">${escapeHtml(company.licenseText)}</div>` : ''}
    </div>
  </header>

  <p class="title">Estimate ${escapeHtml(estimate.number)}</p>
  <div class="sub">Version ${estimate.version} &middot; <span class="${estimate.status === 'void' ? 'void' : ''}">${escapeHtml(STATUS_LABELS[estimate.status] ?? estimate.status)}</span></div>

  <section>
    <h2>Prepared for</h2>
    <div class="grid">
      <div class="row"><span class="label">Customer</span><span class="value">${escapeHtml(customer.name) || '&mdash;'}</span></div>
      ${customer.phone ? `<div class="row"><span class="label">Phone</span><span class="value">${escapeHtml(customer.phone)}</span></div>` : ''}
      ${customer.email ? `<div class="row"><span class="label">Email</span><span class="value">${escapeHtml(customer.email)}</span></div>` : ''}
      <div class="row"><span class="label">Property</span><span class="value">${escapeHtml(address)}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${escapeHtml(formatDate(estimate.createdAt, tz))}</span></div>
      ${estimate.validUntil ? `<div class="row"><span class="label">Valid until</span><span class="value">${escapeHtml(formatDate(estimate.validUntil, tz))}</span></div>` : ''}
    </div>
  </section>

  <section>
    <h2>Line items</h2>
    ${table}
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${formatCents(estimate.subtotalCents)}</td></tr>
      ${estimate.discountCents > 0 ? `<tr><td>Discount</td><td class="num">-${formatCents(estimate.discountCents)}</td></tr>` : ''}
      <tr><td>Tax (${formatBps(estimate.taxRateBps)})</td><td class="num">${formatCents(estimate.taxCents)}</td></tr>
      <tr class="grand"><td>Total</td><td class="num">${formatCents(estimate.totalCents)}</td></tr>
    </table>
  </section>

  ${estimate.notes.trim() ? `<section><h2>Notes</h2><p class="text">${escapeHtml(estimate.notes.trim())}</p></section>` : ''}
  ${company.termsText.trim() ? `<section><h2>Terms</h2><p class="text">${escapeHtml(company.termsText.trim())}</p></section>` : ''}

  <footer>This estimate is not a contract. Amounts are calculated by the CRM from the listed line items.</footer>
</div>
</body>
</html>
`;
}
