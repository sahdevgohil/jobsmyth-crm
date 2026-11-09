import { brandLogoImg } from '../../assets/brand.js';
import type { ProposalDto } from './proposal.service.js';

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function renderProposalHtml(input: {
  companyName: string;
  proposal: ProposalDto;
  customerLabel: string;
  propertyLabel: string;
}): string {
  const { proposal: p } = input;
  const lines = p.lineItems
    .map(
      (li) =>
        `<tr><td>${esc(li.description)}</td><td>${li.quantity} ${esc(li.unit)}</td><td>${money(li.amountCents)}</td></tr>`,
    )
    .join('');
  const schedule = p.paymentSchedule
    .map((s) => {
      const pct = s.percentBps != null ? `${(s.percentBps / 100).toFixed(2)}%` : '';
      const amt = s.amountCents != null ? money(s.amountCents) : '';
      return `<li>${esc(s.label)} ${pct} ${amt}</li>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(p.number)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:2rem;color:#303030}
header{display:flex;align-items:center;gap:1.25rem;border-bottom:3px solid #c32930;padding-bottom:.75rem;margin-bottom:1rem}
header h1{margin:0;font-size:1.25rem;color:#3c3c3c}
h2,h3{color:#c32930}
table{width:100%;border-collapse:collapse;margin:1rem 0}
td,th{border-bottom:1px solid #e1e1e1;padding:.5rem;text-align:left}
th{background:#eeeeee;color:#3c3c3c}
.muted{color:#898989;font-size:.9rem}
</style></head><body>
<header>${brandLogoImg(130)}<h1>${esc(input.companyName)}</h1></header>
<h2>Proposal ${esc(p.number)}</h2>
<p class="muted">Status: ${esc(p.status)} · Version ${p.version}</p>
<p><strong>Customer:</strong> ${esc(input.customerLabel)}<br/>
<strong>Property:</strong> ${esc(input.propertyLabel)}</p>
<table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead>
<tbody>${lines || '<tr><td colspan="3">No line items</td></tr>'}</tbody></table>
<p>Subtotal: ${money(p.subtotalCents)} · Discount: ${money(p.discountCents)} · Tax: ${money(p.taxCents)}</p>
<p><strong>Total: ${money(p.totalCents)}</strong></p>
${schedule ? `<h3>Payment schedule</h3><ul>${schedule}</ul>` : ''}
${p.termsAndConditions ? `<h3>Terms</h3><p>${esc(p.termsAndConditions)}</p>` : ''}
<p class="muted">Signature status: ${esc(p.signature.status)} (${esc(p.signature.provider)})</p>
<p class="muted">Generated ${new Date().toISOString()}</p>
</body></html>`;
}
