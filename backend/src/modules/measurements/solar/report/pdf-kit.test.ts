import { describe, expect, it } from 'vitest';
import { PAGE, Pdf, type Col, type Row } from './pdf-kit.js';

const meta = { companyName: 'LEGACY CONSTRUCTION GROUP LLC', website: 'https://example.test', address: '1 Test St', reportNumber: 'RM-2026-ABC123', revision: 1, date: 'November 9, 2026', footerNote: 'Includes data from Google Maps.', demo: false };
const text = (buf: Buffer): string => (buf.toString('latin1').match(/<([0-9a-fA-F]{2,})>/g) ?? []).map((t) => Buffer.from(t.slice(1, -1), 'hex').toString('latin1')).join('');
const pageCount = (buf: Buffer): number => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('PDF layout kit', () => {
  it('a table with many rows continues on new pages with the header repeated, and every page keeps its header and footer', async () => {
    const pdf = new Pdf(meta, 'Large report', 'Legacy', false);
    pdf.page('Area Measurement Report', '1 Test St');
    const cols: Col[] = [{ label: 'Facet', width: 100 }, { label: 'Area (sqft)', width: 120, align: 'right' }, { label: 'Pitch', width: 100, align: 'right' }];
    const rows: Row[] = Array.from({ length: 140 }, (_, i) => ({ cells: [`F${i + 1}`, String(100 + i), '6/12'] }));
    pdf.table(cols, rows);
    const { buffer, pages } = await pdf.finish();
    const t = text(buffer);
    expect(pages).toBe(pageCount(buffer));
    expect(pages).toBeGreaterThan(3);
    expect(t).toContain('F140');
    expect(t).toContain('Area Measurement Report (continued)');
    expect(t.split('Facet').length - 1).toBe(pages); // column header repeats on each page
    expect(t.split('LEGACY CONSTRUCTION GROUP LLC').length - 1).toBe(pages);
    for (let i = 1; i <= pages; i++) expect(t).toContain(`Page ${i} of ${pages}`);
    expect(PAGE.bottom).toBeLessThan(PAGE.h);
  });

  it('long cell text wraps inside its column instead of overflowing', async () => {
    const pdf = new Pdf(meta, 'Wrap', 'Legacy', false);
    pdf.page('Notes');
    pdf.table([{ label: 'Type', width: 80 }, { label: 'Status', width: 120 }], [{ cells: ['Unspecified', '10 edges need verification (no length stated) and more words that must wrap'] }]);
    const { buffer } = await pdf.finish();
    expect(pageCount(buffer)).toBe(1);
    expect(text(buffer)).toContain('Unspecified');
  });
});
