import { describe, expect, it } from 'vitest';
import { checkReport } from './data.js';
import { addressLine, contentDisposition, ftIn, reportFilename, slugify } from './format.js';

describe('report file name', () => {
  const rebecca = { line1: '1532 Rebecca Lane', city: 'Lancaster', state: 'TX', zip: '75134' };
  it('is built from the address', () => {
    expect(reportFilename(rebecca, 1, 'RM-2026-ABC123')).toBe('1532-Rebecca-Lane-Lancaster-TX-75134-Roof-Measurement-Report.pdf');
  });
  it('adds the revision only after the first', () => {
    expect(reportFilename(rebecca, 2, 'RM-2026-ABC123')).toBe('1532-Rebecca-Lane-Lancaster-TX-75134-Roof-Measurement-Report-Rev2.pdf');
  });
  it('removes unsafe characters and path tricks', () => {
    const n = reportFilename({ line1: '12/34 "Main" St.; ../../etc', city: 'A&B <City>', state: 'TX', zip: '' }, 1, 'RM-1');
    expect(n).toMatch(/^[\p{L}\p{N}-]+-Roof-Measurement-Report\.pdf$/u);
    expect(n).not.toMatch(/[/\\:*?"<>|;&]/);
    expect(n).not.toContain('..');
  });
  it('keeps non-English letters and gives them an ASCII fallback in the header', () => {
    const n = reportFilename({ line1: '5 Calle Peña', city: 'San José', state: 'CA', zip: '90001' }, 1, 'RM-1');
    expect(n).toContain('Peña');
    const cd = contentDisposition(n);
    expect(cd).toContain('filename="5-Calle-Pena-San-Jose-CA-90001-Roof-Measurement-Report.pdf"');
    expect(cd).toContain("filename*=UTF-8''5-Calle-Pe%C3%B1a-San-Jos%C3%A9-CA-90001-Roof-Measurement-Report.pdf");
    expect(cd).not.toMatch(/[\r\n]/);
  });
  it('never returns a generic name when the address is missing', () => {
    expect(reportFilename(null, 1, 'RM-2026-ABC123')).toBe('Roof-Measurement-Report-RM-2026-ABC123.pdf');
    expect(reportFilename({ line1: '', city: '', state: '', zip: '' }, 1, 'RM-2026-ABC123')).toContain('RM-2026-ABC123');
  });
  it('limits very long addresses', () => {
    expect(slugify('word '.repeat(100)).length).toBeLessThanOrEqual(120);
    expect(addressLine({ line1: 'a', city: 'b', state: 'c', zip: 'd' })).toBe('a, b, c d');
  });
});

describe('ft/in formatting', () => {
  it('rounds to the nearest inch and carries into feet', () => {
    expect(ftIn(219.27)).toBe('219ft 3in');
    expect(ftIn(10.99)).toBe('11ft 0in');
    expect(ftIn(0)).toBe('0ft 0in');
  });
  it('never turns missing data into a zero', () => {
    expect(ftIn(null)).toBe('Not available');
    expect(ftIn(undefined)).toBe('Not available');
    expect(ftIn(Number.NaN)).toBe('Not available');
  });
});

describe('report validation', () => {
  const ok = { totalAreaSqFt: 3000, pitchedAreaSqFt: 2900, flatAreaSqFt: 100, unspecifiedAreaSqFt: 0, facetAreas: [1500, 1500], structureRoofAreas: [3000], edgeCategories: [], edgesInGeometry: 0, pitchedWasteSelected: 14, flatWasteSelected: 15 };
  it('passes consistent data', () => expect(checkReport(ok, undefined, false)).toMatchObject({ ok: true, problems: [] }));
  it('flags pitched + flat + unspecified that do not equal the total', () => {
    const r = checkReport({ ...ok, pitchedAreaSqFt: 2000 }, undefined, false);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('does not equal the total');
  });
  it('flags facet and structure sums that disagree, but only notes a manual total', () => {
    expect(checkReport({ ...ok, facetAreas: [1000, 1000] }, undefined, false).problems.join()).toContain('Facet areas add up');
    expect(checkReport({ ...ok, structureRoofAreas: [2000] }, undefined, false).problems.join()).toContain('Structure roof areas');
    const manual = checkReport({ ...ok, facetAreas: [1000, 1000] }, undefined, true);
    expect(manual.ok).toBe(true);
    expect(manual.notes.join()).toContain('corrected manually');
  });
  it('flags edges that exist without any length', () => {
    expect(checkReport({ ...ok, edgesInGeometry: 5 }, undefined, false).problems.join()).toContain('none has a length');
  });
});
