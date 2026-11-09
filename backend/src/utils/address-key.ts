const SUFFIX_MAP: Record<string, string> = {
  street: 'st',
  st: 'st',
  avenue: 'ave',
  ave: 'ave',
  boulevard: 'blvd',
  blvd: 'blvd',
  drive: 'dr',
  dr: 'dr',
  road: 'rd',
  rd: 'rd',
  lane: 'ln',
  ln: 'ln',
  court: 'ct',
  ct: 'ct',
  circle: 'cir',
  cir: 'cir',
  place: 'pl',
  pl: 'pl',
  highway: 'hwy',
  hwy: 'hwy',
  parkway: 'pkwy',
  pkwy: 'pkwy',
  terrace: 'ter',
  ter: 'ter',
};

export type AddressParts = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

function normalizeToken(token: string): string {
  const lower = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SUFFIX_MAP[lower] ?? lower;
}

function normalizeLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeToken)
    .join(' ');
}

function normalizeZip(zip: string): string {
  const digits = zip.replace(/\D/g, '');
  return digits.slice(0, 5);
}

/** Stable address key for duplicate detection (street + ZIP). */
export function buildAddressKey(address: AddressParts | null | undefined): string | null {
  if (!address) {
    return null;
  }
  const line1 = (address.line1 ?? '').trim();
  const zip = (address.zip ?? '').trim();
  if (!line1 || !zip) {
    return null;
  }
  const street = normalizeLine(line1);
  const zipKey = normalizeZip(zip);
  if (!street || !zipKey) {
    return null;
  }
  return `${street}|${zipKey}`;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email || !email.trim()) {
    return null;
  }
  return email.trim().toLowerCase();
}
