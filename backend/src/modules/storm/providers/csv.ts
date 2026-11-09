/**
 * Incremental RFC 4180 CSV parser. Handles quoted fields, doubled quotes and line breaks inside quotes (NCEI narratives),
 * so a multi-hundred-megabyte file can be processed chunk by chunk without being held in memory.
 */
/** Matches a leading UTF-8 byte order mark. */
export const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

export class CsvParser {
  private row: string[] = [];
  private field = '';
  private inQuotes = false;
  private pendingQuote = false; // saw a quote inside a quoted field: either an escape or the end
  private sawAny = false;

  /** Feeds a chunk; returns the rows completed by it. */
  push(chunk: string): string[][] {
    const out: string[][] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i] as string;
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === '"') { this.field += '"'; continue; }
        this.inQuotes = false;
      }
      if (this.inQuotes) {
        if (c === '"') this.pendingQuote = true;
        else this.field += c;
        continue;
      }
      if (c === '"' && this.field === '') { this.inQuotes = true; this.sawAny = true; continue; }
      if (c === ',') { this.row.push(this.field); this.field = ''; this.sawAny = true; continue; }
      if (c === '\r') continue;
      if (c === '\n') {
        if (this.sawAny || this.field !== '' || this.row.length > 0) { this.row.push(this.field); out.push(this.row); }
        this.row = []; this.field = ''; this.sawAny = false;
        continue;
      }
      this.field += c;
      this.sawAny = true;
    }
    return out;
  }

  /** Flushes a final row that has no trailing newline. */
  end(): string[][] {
    if (this.pendingQuote) { this.pendingQuote = false; this.inQuotes = false; }
    if (this.sawAny || this.field !== '' || this.row.length > 0) {
      this.row.push(this.field);
      const r = this.row;
      this.row = []; this.field = ''; this.sawAny = false;
      return [r];
    }
    return [];
  }
}

export function parseCsvText(text: string): string[][] {
  const p = new CsvParser();
  return [...p.push(text), ...p.end()];
}

/** Rows keyed by header name, tolerant of a UTF-8 BOM and of missing trailing columns. */
export function toRecords(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const header = (rows[0] as string[]).map((h, i) => (i === 0 ? h.replace(BOM_RE, '') : h).trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
