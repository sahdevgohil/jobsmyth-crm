/**
 * Form engine — SINGLE SOURCE OF TRUTH.
 *
 * Pure TypeScript, no dependencies. `npm run sync:shared` copies this file verbatim to
 *   backend/src/modules/forms/engine.ts   (authoritative validation on the server)
 *   frontend/src/lib/form-engine.ts       (rendering, conditional logic, offline checks)
 * A backend test fails if the copies drift from this file.
 *
 * Field ids are stable identifiers; labels are freely editable. Answers are keyed by field id.
 */

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'currency',
  'date',
  'datetime',
  'dropdown',
  'multiselect',
  'yes_no',
  'condition_rating',
  'measurement',
  'photos',
  'signature',
  'address',
  'file',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const CONDITION_RATINGS = ['good', 'fair', 'damaged', 'needs_replacement', 'n_a'] as const;
export type ConditionRating = (typeof CONDITION_RATINGS)[number];
export const CONDITION_RATING_LABELS: Record<ConditionRating, string> = {
  good: 'Good',
  fair: 'Fair',
  damaged: 'Damaged',
  needs_replacement: 'Needs replacement',
  n_a: 'N/A',
};

export const MEASUREMENT_UNITS = ['SQ', 'LF', 'SF', 'EA', 'in', 'ft', 'yr'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export type Condition =
  | { field: string; op: 'eq' | 'neq'; value: string | number | boolean }
  | { field: string; op: 'in'; value: Array<string | number | boolean> }
  | { field: string; op: 'includes'; value: string }
  | { field: string; op: 'notEmpty' | 'empty' }
  | { all: Condition[] }
  | { any: Condition[] };

export type FieldOption = { value: string; label: string };

export type FormField = {
  /** Stable machine id: lowercase letters, digits, underscores. Never changes after publishing. */
  id: string;
  label: string;
  type: FieldType;
  helpText?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: FieldOption[];
  /** measurement: allowed units (first is the default). */
  units?: MeasurementUnit[];
  min?: number;
  max?: number;
  maxLength?: number;
  /** Regular expression source applied to text answers. */
  pattern?: string;
  patternMessage?: string;
  /** Hidden unless the condition holds. Hidden fields are not required and their answers are discarded. */
  visibleWhen?: Condition;
  /** Answers are masked for users without the sensitive-data permission and excluded from lists/exports. */
  sensitive?: boolean;
  /** photos: minimum photos required to complete. condition_rating: min photos when rating is in photoRequiredFor. */
  minPhotos?: number;
  photoRequiredFor?: ConditionRating[];
  /** condition_rating: a note is mandatory for these ratings. */
  noteRequiredFor?: ConditionRating[];
  /** condition_rating: also capture a measurement for this item. */
  withMeasurement?: boolean;
  /** number/measurement: derived value, recomputed on the server (client values are ignored). */
  computed?: { formula: 'product'; of: string[]; decimals?: number };
  /** signature: the printed name must be provided. */
  signerNameRequired?: boolean;
};

export type FormSection = {
  id: string;
  title: string;
  description?: string;
  visibleWhen?: Condition;
  fields: FormField[];
};

export type FormDefinition = {
  sections: FormSection[];
};

export type Answers = Record<string, unknown>;
export type Issue = { fieldId: string; message: string };

const ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

// ---------------------------------------------------------------- conditions

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Value a condition compares against: condition ratings compare on their rating, measurements on their value. */
function comparable(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ('rating' in o) return o.rating;
    if ('value' in o) return o.value;
  }
  return v;
}

export function evalCondition(cond: Condition | undefined, answers: Answers): boolean {
  if (!cond) return true;
  if ('all' in cond) return cond.all.every((c) => evalCondition(c, answers));
  if ('any' in cond) return cond.any.some((c) => evalCondition(c, answers));
  const raw = answers[cond.field];
  switch (cond.op) {
    case 'eq':
      return comparable(raw) === cond.value;
    case 'neq':
      return comparable(raw) !== cond.value;
    case 'in':
      return cond.value.includes(comparable(raw) as string | number | boolean);
    case 'includes':
      return Array.isArray(raw) && raw.includes(cond.value);
    case 'notEmpty':
      return !isEmpty(raw);
    case 'empty':
      return isEmpty(raw);
  }
}

export function isSectionVisible(section: FormSection, answers: Answers): boolean {
  return evalCondition(section.visibleWhen, answers);
}

export function isFieldVisible(section: FormSection, field: FormField, answers: Answers): boolean {
  return isSectionVisible(section, answers) && evalCondition(field.visibleWhen, answers);
}

export function visibleFields(def: FormDefinition, answers: Answers): Array<{ section: FormSection; field: FormField }> {
  const out: Array<{ section: FormSection; field: FormField }> = [];
  for (const section of def.sections) {
    for (const field of section.fields) {
      if (isFieldVisible(section, field, answers)) out.push({ section, field });
    }
  }
  return out;
}

export function allFields(def: FormDefinition): FormField[] {
  return def.sections.flatMap((s) => s.fields);
}

// ---------------------------------------------------------------- definition validation

function conditionRefs(cond: Condition | undefined, out: string[] = []): string[] {
  if (!cond) return out;
  if ('all' in cond) cond.all.forEach((c) => conditionRefs(c, out));
  else if ('any' in cond) cond.any.forEach((c) => conditionRefs(c, out));
  else out.push(cond.field);
  return out;
}

/** Structural validation of a template definition (builder save/publish). Returns human-readable errors. */
export function validateDefinition(def: FormDefinition): string[] {
  const errors: string[] = [];
  if (!def || !Array.isArray(def.sections) || def.sections.length === 0) return ['A form needs at least one section.'];
  const sectionIds = new Set<string>();
  const fieldIds = new Set<string>();
  const order: string[] = [];
  for (const s of def.sections) {
    if (!ID_RE.test(s.id)) errors.push(`Section id "${s.id}" must be lowercase letters, digits and underscores.`);
    if (sectionIds.has(s.id)) errors.push(`Duplicate section id "${s.id}".`);
    sectionIds.add(s.id);
    if (!s.title?.trim()) errors.push(`Section "${s.id}" needs a title.`);
    for (const f of s.fields ?? []) {
      if (!ID_RE.test(f.id)) errors.push(`Field id "${f.id}" must be lowercase letters, digits and underscores.`);
      if (fieldIds.has(f.id)) errors.push(`Duplicate field id "${f.id}".`);
      fieldIds.add(f.id);
      order.push(f.id);
      if (!f.label?.trim()) errors.push(`Field "${f.id}" needs a label.`);
      if (!(FIELD_TYPES as readonly string[]).includes(f.type)) errors.push(`Field "${f.id}" has unknown type "${String(f.type)}".`);
      if ((f.type === 'dropdown' || f.type === 'multiselect') && (!f.options || f.options.length === 0)) {
        errors.push(`Field "${f.id}" needs at least one option.`);
      }
      const values = (f.options ?? []).map((o) => o.value);
      if (new Set(values).size !== values.length) errors.push(`Field "${f.id}" has duplicate option values.`);
      for (const u of f.units ?? []) {
        if (!(MEASUREMENT_UNITS as readonly string[]).includes(u)) errors.push(`Field "${f.id}" has unsupported unit "${u}".`);
      }
      if (f.pattern) {
        try {
          new RegExp(f.pattern);
        } catch {
          errors.push(`Field "${f.id}" has an invalid pattern.`);
        }
      }
      if (f.min !== undefined && f.max !== undefined && f.min > f.max) errors.push(`Field "${f.id}" has min greater than max.`);
    }
  }
  // Conditions may only reference fields that exist (and not themselves).
  for (const s of def.sections) {
    for (const ref of conditionRefs(s.visibleWhen)) {
      if (!fieldIds.has(ref)) errors.push(`Section "${s.id}" condition references unknown field "${ref}".`);
    }
    for (const f of s.fields) {
      for (const ref of conditionRefs(f.visibleWhen)) {
        if (!fieldIds.has(ref)) errors.push(`Field "${f.id}" condition references unknown field "${ref}".`);
        if (ref === f.id) errors.push(`Field "${f.id}" cannot depend on itself.`);
      }
      for (const ref of f.computed?.of ?? []) {
        if (!fieldIds.has(ref)) errors.push(`Field "${f.id}" computes from unknown field "${ref}".`);
      }
    }
  }
  return errors;
}

/**
 * Compares two definitions and returns changes that would corrupt existing submissions
 * (a field id changing its type, or a field being removed). Used to warn the builder user:
 * removing a field is allowed (old versions are immutable) but flagged.
 */
export function breakingChanges(prev: FormDefinition, next: FormDefinition): string[] {
  const before = new Map(allFields(prev).map((f) => [f.id, f]));
  const after = new Map(allFields(next).map((f) => [f.id, f]));
  const out: string[] = [];
  for (const [id, f] of before) {
    const n = after.get(id);
    if (!n) out.push(`Field "${id}" was removed; earlier submissions keep it in their original version.`);
    else if (n.type !== f.type) out.push(`Field "${id}" changed type from ${f.type} to ${n.type}; use a new field id instead.`);
  }
  return out;
}

// ---------------------------------------------------------------- answers

export function computeDerived(def: FormDefinition, answers: Answers): Answers {
  const out: Answers = { ...answers };
  for (const f of allFields(def)) {
    if (!f.computed) continue;
    const nums = f.computed.of.map((id) => numberOf(out[id]));
    if (nums.some((n) => n === null)) {
      delete out[f.id];
      continue;
    }
    const product = (nums as number[]).reduce((a, b) => a * b, 1);
    const d = f.computed.decimals ?? 2;
    const value = Math.round(product * 10 ** d) / 10 ** d;
    out[f.id] = f.type === 'measurement' ? { value, unit: f.units?.[0] ?? 'SF' } : value;
  }
  return out;
}

function numberOf(v: unknown): number | null {
  const x = comparable(v);
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/** Removes answers for fields/sections that are currently hidden (and unknown ids). */
export function stripHidden(def: FormDefinition, answers: Answers): Answers {
  const keep = new Set(visibleFields(def, answers).map((x) => x.field.id));
  return Object.fromEntries(Object.entries(answers).filter(([k]) => keep.has(k)));
}

export function redactSensitive(def: FormDefinition, answers: Answers): Answers {
  const sensitive = new Set(allFields(def).filter((f) => f.sensitive).map((f) => f.id));
  return Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, sensitive.has(k) ? '[restricted]' : v]));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const hasPhoneShape = (s: string): boolean => /^[0-9+()\-\s.]{7,20}$/.test(s);

function checkValue(f: FormField, v: unknown): string | null {
  switch (f.type) {
    case 'text':
    case 'long_text': {
      if (typeof v !== 'string') return 'Must be text.';
      if (f.maxLength !== undefined && v.length > f.maxLength) return `Must be at most ${f.maxLength} characters.`;
      if (f.type === 'text' && v.length > 500) return 'Must be at most 500 characters.';
      if (v.length > 10_000) return 'Too long.';
      if (f.pattern && v.trim() !== '' && !new RegExp(f.pattern).test(v)) return f.patternMessage ?? 'Invalid format.';
      return null;
    }
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Must be a number.';
      if (f.min !== undefined && v < f.min) return `Must be at least ${f.min}.`;
      if (f.max !== undefined && v > f.max) return `Must be at most ${f.max}.`;
      return null;
    }
    case 'currency': {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return 'Must be a non-negative whole number of cents.';
      if (f.max !== undefined && v > f.max) return `Must be at most ${f.max} cents.`;
      return null;
    }
    case 'date':
      return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'Must be a date (YYYY-MM-DD).';
    case 'datetime':
      return typeof v === 'string' && !Number.isNaN(Date.parse(v)) && v.length >= 16 ? null : 'Must be a date and time.';
    case 'dropdown':
      return typeof v === 'string' && (f.options ?? []).some((o) => o.value === v) ? null : 'Choose one of the listed options.';
    case 'multiselect': {
      if (!Array.isArray(v)) return 'Must be a list of options.';
      const allowed = new Set((f.options ?? []).map((o) => o.value));
      return v.every((x) => typeof x === 'string' && allowed.has(x)) && new Set(v).size === v.length ? null : 'Choose only listed options, once each.';
    }
    case 'yes_no':
      return typeof v === 'boolean' ? null : 'Must be yes or no.';
    case 'condition_rating': {
      if (!v || typeof v !== 'object') return 'Choose a condition.';
      const o = v as Record<string, unknown>;
      if (!(CONDITION_RATINGS as readonly string[]).includes(o.rating as string)) return 'Choose a valid condition.';
      if (o.notes !== undefined && (typeof o.notes !== 'string' || o.notes.length > 2000)) return 'Notes must be text up to 2000 characters.';
      if (o.measurement !== undefined) {
        const m = o.measurement as Record<string, unknown>;
        if (!f.withMeasurement) return 'This item does not take a measurement.';
        if (typeof m?.value !== 'number' || !Number.isFinite(m.value) || m.value < 0) return 'Measurement must be a non-negative number.';
        if (!(MEASUREMENT_UNITS as readonly string[]).includes(m.unit as string)) return 'Unsupported measurement unit.';
      }
      return null;
    }
    case 'measurement': {
      if (!v || typeof v !== 'object') return 'Enter a measurement.';
      const m = v as Record<string, unknown>;
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) return 'Measurement must be a number.';
      if (m.value < 0) return 'Measurement cannot be negative.';
      const units = f.units && f.units.length > 0 ? f.units : MEASUREMENT_UNITS;
      if (!(units as readonly string[]).includes(m.unit as string)) return `Unit must be one of ${units.join(', ')}.`;
      if (f.min !== undefined && m.value < f.min) return `Must be at least ${f.min}.`;
      if (f.max !== undefined && m.value > f.max) return `Must be at most ${f.max}.`;
      return null;
    }
    case 'address': {
      if (!v || typeof v !== 'object') return 'Enter an address.';
      const a = v as Record<string, unknown>;
      for (const k of ['line1', 'city', 'state', 'zip']) {
        if (a[k] !== undefined && typeof a[k] !== 'string') return `Address ${k} must be text.`;
      }
      if (a.lat !== undefined && (typeof a.lat !== 'number' || a.lat < -90 || a.lat > 90)) return 'Latitude is out of range.';
      if (a.lng !== undefined && (typeof a.lng !== 'number' || a.lng < -180 || a.lng > 180)) return 'Longitude is out of range.';
      return null;
    }
    case 'photos':
      return null; // photos are File records linked to (submission, field); counted server-side
    case 'signature': {
      if (!v || typeof v !== 'object') return 'A signature is required.';
      const s = v as Record<string, unknown>;
      if (typeof s.fileId !== 'string' || s.fileId === '') return 'Signature image is missing.';
      if (typeof s.signedAt !== 'string' || Number.isNaN(Date.parse(s.signedAt))) return 'Signature time is missing.';
      if (f.signerNameRequired && (typeof s.signerName !== 'string' || s.signerName.trim() === '')) return 'Printed name is required.';
      return null;
    }
    case 'file': {
      if (!v || typeof v !== 'object' || !Array.isArray((v as { fileIds?: unknown }).fileIds)) return 'Attach at least one file.';
      return null;
    }
  }
}

function phoneOrEmailHint(f: FormField, v: unknown): string | null {
  if (f.id.endsWith('_phone') && typeof v === 'string' && v.trim() !== '' && !hasPhoneShape(v)) return 'Enter a valid phone number.';
  if (f.id.endsWith('_email') && typeof v === 'string' && v.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
  return null;
}

export type ValidateOptions = {
  /** `draft` checks the shape of what was entered; `complete` also enforces required fields and photos. */
  mode: 'draft' | 'complete';
  /** photos per field id: number of File records linked to (submission, field). */
  photoCounts?: Record<string, number>;
  /** ids of files that exist for this submission (to verify signature/file references). */
  fileIds?: Set<string>;
};

export function validateAnswers(def: FormDefinition, answers: Answers, opts: ValidateOptions): Issue[] {
  const issues: Issue[] = [];
  const known = new Map(allFields(def).map((f) => [f.id, f]));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) issues.push({ fieldId: key, message: 'Unknown field.' });
  }
  const visible = visibleFields(def, answers);
  const visibleIds = new Set(visible.map((x) => x.field.id));
  for (const key of Object.keys(answers)) {
    if (known.has(key) && !visibleIds.has(key)) issues.push({ fieldId: key, message: 'This field is not applicable and must not have an answer.' });
  }
  for (const { field: f } of visible) {
    const v = answers[f.id];
    const empty = isEmpty(v);
    if (f.type === 'photos') {
      if (opts.mode === 'complete' && (f.minPhotos ?? (f.required ? 1 : 0)) > 0) {
        const have = opts.photoCounts?.[f.id] ?? 0;
        const need = f.minPhotos ?? 1;
        if (have < need) issues.push({ fieldId: f.id, message: `At least ${need} photo${need === 1 ? '' : 's'} required (${have} uploaded).` });
      }
      continue;
    }
    if (empty) {
      if (opts.mode === 'complete' && f.required) issues.push({ fieldId: f.id, message: 'This field is required.' });
      continue;
    }
    const problem = checkValue(f, v) ?? phoneOrEmailHint(f, v);
    if (problem) {
      issues.push({ fieldId: f.id, message: problem });
      continue;
    }
    if (f.type === 'condition_rating') {
      const o = v as { rating: ConditionRating; notes?: string };
      if (opts.mode === 'complete') {
        if (f.noteRequiredFor?.includes(o.rating) && !(o.notes && o.notes.trim())) issues.push({ fieldId: f.id, message: 'A note is required for this rating.' });
        if (f.photoRequiredFor?.includes(o.rating)) {
          const need = Math.max(1, f.minPhotos ?? 1);
          if ((opts.photoCounts?.[f.id] ?? 0) < need) issues.push({ fieldId: f.id, message: `A photo is required for a "${CONDITION_RATING_LABELS[o.rating]}" rating.` });
        }
      }
    }
    if (opts.fileIds && (f.type === 'signature' || f.type === 'file')) {
      const ids = f.type === 'signature' ? [(v as { fileId: string }).fileId] : ((v as { fileIds: string[] }).fileIds);
      for (const id of ids) {
        if (!opts.fileIds.has(id)) issues.push({ fieldId: f.id, message: 'Referenced file was not found on this submission.' });
      }
    }
  }
  // Required condition_rating with no answer yet is covered by the empty check above.
  return issues;
}

/** Progress for the UI: required visible fields answered vs total. */
export function progress(def: FormDefinition, answers: Answers, photoCounts: Record<string, number> = {}): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const { field: f } of visibleFields(def, answers)) {
    const need = f.type === 'photos' ? (f.minPhotos ?? (f.required ? 1 : 0)) > 0 : Boolean(f.required);
    if (!need) continue;
    total += 1;
    if (f.type === 'photos') {
      if ((photoCounts[f.id] ?? 0) >= (f.minPhotos ?? 1)) done += 1;
    } else if (!isEmpty(answers[f.id])) done += 1;
  }
  return { done, total };
}

/** Initial answers from field defaults. */
export function defaultAnswers(def: FormDefinition): Answers {
  const out: Answers = {};
  for (const f of allFields(def)) {
    if (f.defaultValue !== undefined) out[f.id] = f.defaultValue;
  }
  return out;
}
