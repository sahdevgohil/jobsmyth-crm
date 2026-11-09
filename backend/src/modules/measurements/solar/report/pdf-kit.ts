/**
 * Small layout kit on top of pdfkit: consistent page frame, aligned tables with continuation pages, key/value blocks.
 * Text is never shrunk to fit: content that does not fit moves to a continuation page.
 */
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { BRAND_LOGO_DATA_URI } from '../../../../assets/brand-logo.js';

export const C = { charcoal: '#3c3c3c', red: '#c32930', grey: '#757575', line: '#dcdcdc', head: '#f1f1f1', soft: '#fbeaeb', text: '#222222' } as const;
export const PAGE = { w: 612, h: 792, margin: 48, top: 112, bottom: 742 } as const;
export const CONTENT_W = PAGE.w - 2 * PAGE.margin;

export type Col = { label: string; width: number; align?: 'left' | 'right' | 'center' };
export type Row = { cells: string[]; kind?: 'normal' | 'group' | 'highlight' | 'total'; span?: boolean };

export type PageMeta = { companyName: string; website: string; address: string; reportNumber: string; revision: number; date: string; footerNote: string; demo: boolean };

export class Pdf {
  readonly doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private done: Promise<Buffer>;
  private pages = 0;
  private current: { title: string; subtitle?: string } = { title: '' };
  constructor(private meta: PageMeta, title: string, author: string, compress: boolean) {
    this.doc = new PDFDocument({ size: [PAGE.w, PAGE.h], margin: PAGE.margin, bufferPages: true, compress, info: { Title: title, Author: author } });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.done = new Promise((resolve) => this.doc.on('end', () => resolve(Buffer.concat(this.chunks))));
  }
  get y(): number { return this.doc.y; }
  set y(v: number) { this.doc.y = v; }
  get pageCount(): number { return this.pages; }
  /** Starts a new page with the standard header and title. */
  page(title: string, subtitle?: string): void {
    if (this.pages > 0) this.doc.addPage();
    this.pages += 1;
    this.current = { title, subtitle };
    this.header(title, subtitle);
  }
  private header(title: string, subtitle?: string): void {
    const d = this.doc;
    d.image(BRAND_LOGO_DATA_URI, PAGE.margin, 26, { width: 62 }); // string source: cached, embedded once
    d.font('Helvetica-Bold').fontSize(10).fillColor(C.charcoal).text(this.meta.companyName.toUpperCase(), 130, 34, { width: CONTENT_W - 82, align: 'right', lineBreak: false });
    if (this.meta.website) d.font('Helvetica').fontSize(8.5).fillColor(C.grey).text(this.meta.website, 130, 48, { width: CONTENT_W - 82, align: 'right', lineBreak: false });
    d.moveTo(PAGE.margin, 84).lineTo(PAGE.margin + CONTENT_W, 84).lineWidth(1.6).strokeColor(C.red).stroke();
    d.font('Helvetica-Bold').fontSize(19).fillColor(C.red).text(title, PAGE.margin, 94, { width: CONTENT_W, lineBreak: false });
    d.font('Helvetica').fontSize(9).fillColor(C.grey).text(subtitle ?? this.meta.address, PAGE.margin, 117, { width: CONTENT_W, lineBreak: false, ellipsis: true });
    if (this.meta.demo) d.font('Helvetica-Bold').fontSize(8).fillColor(C.red).text('DEMONSTRATION DATA: sample values, not a real measurement and not from Google.', PAGE.margin, 130, { width: CONTENT_W, lineBreak: false });
    d.y = PAGE.top + (this.meta.demo ? 28 : 18);
  }
  space(pts: number): void { this.doc.y += pts; }
  remaining(): number { return PAGE.bottom - this.doc.y; }
  /** Starts a continuation page when less than `need` points remain. */
  ensure(need: number): void {
    if (this.remaining() >= need) return;
    this.doc.addPage();
    this.pages += 1;
    this.header(`${this.current.title} (continued)`, this.current.subtitle);
  }
  h2(text: string): void {
    this.ensure(40);
    this.doc.font('Helvetica-Bold').fontSize(11.5).fillColor(C.charcoal).text(text, PAGE.margin, this.doc.y, { width: CONTENT_W });
    this.doc.moveDown(0.35);
  }
  para(text: string, opts: { size?: number; color?: string; italic?: boolean; width?: number; x?: number } = {}): void {
    const size = opts.size ?? 9;
    this.doc.font(opts.italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(size);
    const width = opts.width ?? CONTENT_W;
    const h = this.doc.heightOfString(text, { width });
    this.ensure(h + 4);
    this.doc.fillColor(opts.color ?? C.text).text(text, opts.x ?? PAGE.margin, this.doc.y, { width });
    this.doc.moveDown(0.3);
  }
  /** Label/value pairs in `cols` columns. Values are never blank: pass "Not available" explicitly. */
  kv(pairs: Array<[string, string]>, cols = 2, opts: { labelW?: number } = {}): void {
    const colW = CONTENT_W / cols;
    const rowH = 15;
    const rows = Math.ceil(pairs.length / cols);
    this.ensure(rows * rowH + 6);
    const y0 = this.doc.y;
    pairs.forEach(([k, v], i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = PAGE.margin + col * colW;
      this.doc.font('Helvetica').fontSize(9.5).fillColor(C.text).text(`${k}:`, x, y0 + row * rowH, { width: opts.labelW ?? colW * 0.55, lineBreak: false });
      this.doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.charcoal).text(v, x + (opts.labelW ?? colW * 0.55), y0 + row * rowH, { width: colW - (opts.labelW ?? colW * 0.55) - 6, lineBreak: false, ellipsis: true });
    });
    this.doc.y = y0 + rows * rowH + 6;
  }
  /** Aligned table. Long cell text wraps (the row grows); rows that do not fit continue on the next page with the header repeated. */
  table(cols: Col[], rows: Row[], opts: { fontSize?: number } = {}): void {
    const size = opts.fontSize ?? 8.8;
    const pad = 5;
    const drawHead = (): void => {
      const y = this.doc.y;
      this.doc.rect(PAGE.margin, y, CONTENT_W, 19).fill(C.head);
      let x = PAGE.margin;
      for (const c of cols) {
        this.doc.font('Helvetica-Bold').fontSize(size).fillColor(C.charcoal).text(c.label, x + pad, y + 5, { width: c.width - 2 * pad, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
        x += c.width;
      }
      this.doc.y = y + 21;
    };
    this.ensure(19 + 22 * 2);
    drawHead();
    for (const r of rows) {
      const kind = r.kind ?? 'normal';
      const bold = kind !== 'normal';
      this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      const heights = r.span ? [this.doc.heightOfString(r.cells[0] ?? '', { width: CONTENT_W - 2 * pad })] : r.cells.map((t, i) => this.doc.heightOfString(t, { width: (cols[i]?.width ?? 60) - 2 * pad }));
      const h = Math.max(15, Math.max(...heights) + 7);
      if (this.doc.y + h > PAGE.bottom) {
        this.doc.addPage();
        this.pages += 1;
        this.header(`${this.current.title} (continued)`, this.current.subtitle);
        drawHead();
      }
      const y = this.doc.y;
      if (kind === 'highlight') this.doc.rect(PAGE.margin, y, CONTENT_W, h).fill(C.soft);
      else if (kind === 'group') this.doc.rect(PAGE.margin, y, CONTENT_W, h).fill('#f7f7f7');
      this.doc.moveTo(PAGE.margin, y + h).lineTo(PAGE.margin + CONTENT_W, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
      this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(C.text);
      if (r.span) this.doc.text(r.cells[0] ?? '', PAGE.margin + pad, y + 4, { width: CONTENT_W - 2 * pad });
      else {
        let x = PAGE.margin;
        r.cells.forEach((t, i) => {
          const c = cols[i] as Col;
          this.doc.text(t, x + pad, y + 4, { width: c.width - 2 * pad, align: c.align ?? 'left' });
          x += c.width;
        });
      }
      this.doc.y = y + h;
    }
    this.doc.moveDown(0.5);
  }
  svg(svg: string, x: number, y: number, w: number, h: number): void {
    SVGtoPDF(this.doc, svg, x, y, { width: w, height: h, assumePt: true, preserveAspectRatio: 'xMidYMid meet' });
  }
  /** Draws a colour swatch with a label, for legends. */
  swatch(x: number, y: number, color: string, label: string, opts: { dashed?: boolean; width?: number } = {}): void {
    if (opts.dashed) this.doc.moveTo(x, y + 5).lineTo(x + 16, y + 5).lineWidth(2.4).dash(4, { space: 2 }).strokeColor(color).stroke().undash();
    else this.doc.moveTo(x, y + 5).lineTo(x + 16, y + 5).lineWidth(2.4).strokeColor(color).stroke();
    this.doc.font('Helvetica').fontSize(9).fillColor(C.text).text(label, x + 22, y, { width: opts.width ?? 150, lineBreak: false });
  }
  /** Writes the footer on every page and finishes the document. */
  async finish(): Promise<{ buffer: Buffer; pages: number }> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.doc.page.margins.bottom = 0; // otherwise writing in the footer area starts a new page
      this.doc.moveTo(PAGE.margin, 752).lineTo(PAGE.margin + CONTENT_W, 752).lineWidth(0.5).strokeColor(C.line).stroke();
      this.doc.font('Helvetica').fontSize(7.5).fillColor(C.grey);
      this.doc.text(`Report ${this.meta.reportNumber}  ·  Revision ${this.meta.revision}  ·  ${this.meta.date}`, PAGE.margin, 758, { width: CONTENT_W * 0.7, lineBreak: false });
      this.doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.margin + CONTENT_W * 0.7, 758, { width: CONTENT_W * 0.3, align: 'right', lineBreak: false });
      this.doc.text(this.meta.footerNote, PAGE.margin, 770, { width: CONTENT_W, lineBreak: false, ellipsis: true });
    }
    const pages = range.count;
    this.doc.end();
    return { buffer: await this.done, pages };
  }
}
