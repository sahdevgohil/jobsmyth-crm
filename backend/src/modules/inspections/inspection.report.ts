import { brandLogoImg } from '../../assets/brand.js';
import type { InspectionDto } from './inspection.service.js';

export type InspectionReportData = {
  company: {
    name: string;
    phone: string;
    email: string;
    website: string;
    licenseText: string;
    timeZone: string;
  };
  inspection: InspectionDto;
  customer: { name: string; email: string; phone: string };
  propertyAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  inspectorName: string;
  photos: Array<{ filename: string; caption: string; uploadedAt: string }>;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatAddress(address: InspectionReportData['propertyAddress']): string {
  if (!address) return 'Address unavailable';
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [address.line1, address.line2, cityLine].filter(Boolean).join(', ');
}

function textSection(title: string, value: string): string {
  const body = value.trim()
    ? `<p class="text">${escapeHtml(value.trim())}</p>`
    : '<p class="empty">Not recorded.</p>';
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function renderInspectionReportHtml(data: InspectionReportData): string {
  const { company, inspection, customer, photos } = data;
  const tz = company.timeZone;
  const address = formatAddress(data.propertyAddress);
  const statusLabel = STATUS_LABELS[inspection.status] ?? inspection.status;
  const m = inspection.measurements;

  const contactBits = [company.phone, company.email, company.website]
    .filter((v) => v.trim())
    .map(escapeHtml)
    .join(' &middot; ');

  const photoRows = photos
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.filename)}</td><td>${escapeHtml(p.caption) || '&mdash;'}</td><td>${escapeHtml(
          formatDateTime(p.uploadedAt, tz),
        )}</td></tr>`,
    )
    .join('');
  const photoSection = photos.length
    ? `<table><thead><tr><th>File</th><th>Caption</th><th>Uploaded</th></tr></thead><tbody>${photoRows}</tbody></table>`
    : '<p class="empty">No photos have been attached to this inspection.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roof Inspection Report - ${escapeHtml(address)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #303030; margin: 0; padding: 32px; background: #fff; line-height: 1.5; }
  .page { max-width: 820px; margin: 0 auto; }
  header { border-bottom: 3px solid #c32930; padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 20px; }
  header .brand-text { flex: 1; }
  header h1 { margin: 0; font-size: 20px; color: #3c3c3c; }
  header .sub { color: #898989; font-size: 13px; }
  h2 { color: #c32930; font-size: 16px; margin: 24px 0 6px; border-bottom: 1px solid #e1e1e1; padding-bottom: 4px; }
  .title { font-size: 20px; font-weight: bold; margin: 0 0 4px; }
  .grid { display: table; width: 100%; border-collapse: collapse; }
  .row { display: table-row; }
  .label, .value { display: table-cell; padding: 3px 0; vertical-align: top; font-size: 14px; }
  .label { width: 190px; color: #6b7280; }
  .text { white-space: pre-wrap; margin: 4px 0; font-size: 14px; }
  .empty { color: #9ca3af; font-style: italic; margin: 4px 0; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  th, td { border: 1px solid #e1e1e1; padding: 6px 8px; text-align: left; }
  th { background: #eeeeee; color: #3c3c3c; }
  .note { font-size: 12px; color: #6b7280; margin-top: 6px; }
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

  <p class="title">Roof Inspection Report</p>
  <div class="sub">Status: ${escapeHtml(statusLabel)}</div>

  <section>
    <h2>Inspection details</h2>
    <div class="grid">
      <div class="row"><span class="label">Property address</span><span class="value">${escapeHtml(address)}</span></div>
      <div class="row"><span class="label">Customer</span><span class="value">${escapeHtml(customer.name) || '&mdash;'}</span></div>
      ${customer.phone ? `<div class="row"><span class="label">Customer phone</span><span class="value">${escapeHtml(customer.phone)}</span></div>` : ''}
      ${customer.email ? `<div class="row"><span class="label">Customer email</span><span class="value">${escapeHtml(customer.email)}</span></div>` : ''}
      <div class="row"><span class="label">Inspection date</span><span class="value">${escapeHtml(formatDateTime(inspection.inspectionDate, tz))}</span></div>
      <div class="row"><span class="label">Inspection type</span><span class="value">${escapeHtml(inspection.typeKey)}</span></div>
      <div class="row"><span class="label">Inspector</span><span class="value">${escapeHtml(data.inspectorName) || '&mdash;'}</span></div>
      <div class="row"><span class="label">Reference</span><span class="value">${escapeHtml(inspection.id)}</span></div>
    </div>
  </section>

  ${textSection('Roof condition', inspection.roofCondition)}
  ${textSection('Findings', inspection.findings)}
  ${textSection('Damage observations', inspection.damageObservations)}
  ${textSection('Recommendations', inspection.recommendations)}

  <section>
    <h2>Measurements</h2>
    <div class="grid">
      <div class="row"><span class="label">Total roof area</span><span class="value">${
        m.totalAreaSqFt !== null ? `${escapeHtml(String(m.totalAreaSqFt))} sq ft` : '&mdash;'
      }</span></div>
      <div class="row"><span class="label">Pitch</span><span class="value">${escapeHtml(m.pitch) || '&mdash;'}</span></div>
    </div>
    ${m.notes.trim() ? `<p class="text">${escapeHtml(m.notes.trim())}</p>` : ''}
    <p class="note">Measurements are entered manually and are approximate.</p>
  </section>

  ${textSection('Additional notes', inspection.notes)}

  <section>
    <h2>Photos</h2>
    ${photoSection}
    <p class="note">Photo files are not embedded in this report. Open the inspection in the CRM to view them.</p>
  </section>

  <footer>
    ${
      inspection.reportGeneratedAt
        ? `Report generated ${escapeHtml(formatDateTime(inspection.reportGeneratedAt, tz))}.`
        : 'Draft report &mdash; not yet finalized.'
    }
  </footer>
</div>
</body>
</html>
`;
}
