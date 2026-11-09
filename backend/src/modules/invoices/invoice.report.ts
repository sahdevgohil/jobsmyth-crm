import { brandLogoImg } from '../../assets/brand.js';
import { escapeHtml } from '../inspections/inspection.report.js';

export type InvoiceReportData = {
  company: { name: string; phone: string; email: string; website: string; licenseText: string; termsText: string };
  invoice: {
    number: string;
    status: string;
    invoiceDate: string;
    dueDate: string | null;
    lineItems: Array<{ description: string; quantity: number; unit: string; unitCostCents: number; amountCents: number }>;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    taxRateBps: number;
    totalCents: number;
    amountPaidCents: number;
    notes: string;
  };
  customerName: string;
  propertyAddress: string;
  payments: Array<{ paymentDate: string; method: string; amountCents: number }>;
};

function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'America/Chicago' }) : '—';
}

/** Printable invoice. All amounts are integer cents taken from the stored invoice (never recomputed client-side). */
export function renderInvoiceHtml(d: InvoiceReportData): string {
  const inv = d.invoice;
  const e = escapeHtml;
  const lines = inv.lineItems
    .map(
      (l) =>
        `<tr><td>${e(l.description)}</td><td class="num">${l.quantity} ${e(l.unit)}</td><td class="num">${money(l.unitCostCents)}</td><td class="num">${money(l.amountCents)}</td></tr>`,
    )
    .join('');
  const pays = d.payments
    .map((p) => `<tr><td>${day(p.paymentDate)}</td><td>${e(p.method.replace(/_/g, ' '))}</td><td class="num">${money(p.amountCents)}</td></tr>`)
    .join('');
  const contact = [d.company.phone, d.company.email, d.company.website].filter((v) => v.trim()).map(e).join(' &middot; ');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${e(inv.number)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #303030; margin: 0; padding: 32px; background: #fff; line-height: 1.5; }
  .page { max-width: 860px; margin: 0 auto; }
  header { border-bottom: 3px solid #c32930; padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 20px; }
  header .brand-text { flex: 1; } header h1 { margin: 0; font-size: 20px; color: #3c3c3c; }
  .sub { color: #898989; font-size: 13px; }
  .title { font-size: 20px; font-weight: bold; margin: 0 0 4px; }
  h2 { color: #c32930; font-size: 16px; margin: 24px 0 6px; border-bottom: 1px solid #e1e1e1; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  th, td { border: 1px solid #e1e1e1; padding: 6px 8px; text-align: left; } th { background: #eeeeee; color: #3c3c3c; }
  .num { text-align: right; white-space: nowrap; }
  table.totals { width: 320px; margin-left: auto; margin-top: 12px; }
  table.totals td { border: none; border-bottom: 1px solid #e1e1e1; }
  table.totals tr.grand td { font-weight: bold; font-size: 15px; border-top: 2px solid #c32930; }
  footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #e1e1e1; font-size: 12px; color: #898989; }
  @media print { body { padding: 0; } section { page-break-inside: avoid; } }
</style></head><body><div class="page">
<header>${brandLogoImg(130)}<div class="brand-text"><h1>${e(d.company.name)}</h1>${contact ? `<div class="sub">${contact}</div>` : ''}${d.company.licenseText.trim() ? `<div class="sub">${e(d.company.licenseText)}</div>` : ''}</div></header>
<p class="title">Invoice ${e(inv.number)}</p>
<div class="sub">Status: ${e(inv.status.replace(/_/g, ' '))} &middot; Issued ${day(inv.invoiceDate)} &middot; Due ${day(inv.dueDate)}</div>
<section><h2>Billed to</h2><p>${e(d.customerName)}<br>${e(d.propertyAddress)}</p></section>
<section><h2>Items</h2><table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${lines}</tbody></table>
<table class="totals"><tr><td>Subtotal</td><td class="num">${money(inv.subtotalCents)}</td></tr>
<tr><td>Discount</td><td class="num">${money(inv.discountCents)}</td></tr>
<tr><td>Tax (${(inv.taxRateBps / 100).toFixed(2)}%)</td><td class="num">${money(inv.taxCents)}</td></tr>
<tr class="grand"><td>Total</td><td class="num">${money(inv.totalCents)}</td></tr>
<tr><td>Paid</td><td class="num">${money(inv.amountPaidCents)}</td></tr>
<tr class="grand"><td>Balance due</td><td class="num">${money(Math.max(0, inv.totalCents - inv.amountPaidCents))}</td></tr></table></section>
${pays ? `<section><h2>Payments received</h2><table><thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>${pays}</tbody></table></section>` : ''}
${inv.notes.trim() ? `<section><h2>Notes</h2><p>${e(inv.notes)}</p></section>` : ''}
${d.company.termsText.trim() ? `<section><h2>Terms</h2><p>${e(d.company.termsText)}</p></section>` : ''}
<footer>${e(d.company.name)}</footer></div></body></html>`;
}
