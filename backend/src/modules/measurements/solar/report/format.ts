/** Formatting helpers for the measurement report and its download name. Pure functions. */

/** 219.27 ft -> "219ft 3in". Null/undefined stay explicit instead of becoming a zero. */
export function ftIn(ft: number | null | undefined): string {
  if (ft === null || ft === undefined || !Number.isFinite(ft)) return 'Not available';
  const totalIn = Math.round(ft * 12);
  return `${Math.floor(totalIn / 12)}ft ${totalIn % 12}in`;
}

/** Label-sized length for diagrams: whole feet ("23"), which is what the labels in a roof diagram need. */
export const ftLabel = (ft: number): string => String(Math.round(ft));

export const sqft = (n: number | null | undefined): string => (n === null || n === undefined ? 'Not available' : `${Math.round(n).toLocaleString('en-US')} sqft`);
export const num1 = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const num0 = (n: number): string => Math.round(n).toLocaleString('en-US');

type AddressParts = { line1?: string | null; city?: string | null; state?: string | null; zip?: string | null };

/** One-line address for titles and the file name. */
export function addressLine(a: AddressParts | null | undefined): string {
  if (!a) return '';
  const tail = [a.state, a.zip].filter(Boolean).join(' ');
  return [a.line1, a.city, tail].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
}

/** Words of an address joined with hyphens: letters and digits (any script) are kept, everything else separates words. */
export function slugify(text: string, max = 120): string {
  return text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/**
 * Download name built from the property address, e.g. `1532-Rebecca-Lane-Lancaster-TX-75134-Roof-Measurement-Report.pdf`.
 * Later revisions add `-Rev2`. Without an address the report number is used, so the name is never generic.
 */
export function reportFilename(address: AddressParts | null | undefined, revision: number, reportNumber: string): string {
  const base = slugify(addressLine(address));
  const rev = revision > 1 ? `-Rev${revision}` : '';
  return base ? `${base}-Roof-Measurement-Report${rev}.pdf` : `Roof-Measurement-Report-${slugify(reportNumber)}.pdf`;
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name, so non-English addresses download correctly. */
export function contentDisposition(filename: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = filename.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
