/**
 * Company time-zone helpers. Appointments and schedules are entered and displayed in the company time
 * zone (default America/Chicago) regardless of the viewer's browser time zone; the API stores UTC ISO.
 */
export const COMPANY_TZ = 'America/Chicago';

type Parts = { y: number; m: number; d: number; h: number; min: number };

function partsIn(date: Date, timeZone: string): Parts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute) };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** Converts a `YYYY-MM-DDTHH:mm` wall-clock value in `timeZone` to a UTC ISO string. */
export function zonedInputToISO(local: string, timeZone = COMPANY_TZ): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error('Invalid date/time');
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = new Date(wall);
  // Two passes settle the offset across daylight-saving boundaries.
  guess = new Date(wall - offsetMs(guess, timeZone));
  guess = new Date(wall - offsetMs(guess, timeZone));
  return guess.toISOString();
}

/** Formats an instant as a `datetime-local` value in `timeZone`. */
export function isoToZonedInput(iso: string, timeZone = COMPANY_TZ): string {
  const p = partsIn(new Date(iso), timeZone);
  const z = (n: number): string => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.min)}`;
}

/** `YYYY-MM-DD` of an instant in `timeZone`. */
export function dayKey(iso: string | Date, timeZone = COMPANY_TZ): string {
  const p = partsIn(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
  const z = (n: number): string => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}`;
}

/** UTC instant of 00:00 on `YYYY-MM-DD` in `timeZone`. */
export function startOfDayISO(key: string, timeZone = COMPANY_TZ): string {
  return zonedInputToISO(`${key}T00:00`, timeZone);
}

/** Adds whole calendar days to a `YYYY-MM-DD` key (timezone-independent calendar arithmetic). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a `YYYY-MM-DD` key. */
export function weekday(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatTime(iso: string, timeZone = COMPANY_TZ): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone = COMPANY_TZ): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function formatDayLabel(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
