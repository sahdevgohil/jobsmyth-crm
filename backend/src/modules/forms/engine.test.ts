import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  breakingChanges,
  computeDerived,
  redactSensitive,
  stripHidden,
  validateAnswers,
  validateDefinition,
  visibleFields,
  type FormDefinition,
} from './engine.js';

const def: FormDefinition = {
  sections: [
    {
      id: 'job',
      title: 'Job',
      fields: [
        { id: 'job_type', label: 'Job type', type: 'dropdown', required: true, options: [{ value: 'insurance', label: 'Insurance claim' }, { value: 'retail', label: 'Retail' }] },
        { id: 'room_length', label: 'Length', type: 'measurement', units: ['ft'], required: true },
        { id: 'room_width', label: 'Width', type: 'measurement', units: ['ft'], required: true },
        { id: 'room_sqft', label: 'Square footage', type: 'measurement', units: ['SF'], computed: { formula: 'product', of: ['room_length', 'room_width'], decimals: 1 } },
        { id: 'north_slope', label: 'North slope', type: 'condition_rating', required: true, photoRequiredFor: ['damaged', 'needs_replacement'], noteRequiredFor: ['needs_replacement'] },
        { id: 'elevations', label: 'Four elevations', type: 'photos', minPhotos: 4 },
      ],
    },
    {
      id: 'insurance',
      title: 'Insurance',
      visibleWhen: { field: 'job_type', op: 'eq', value: 'insurance' },
      fields: [
        { id: 'policy_number', label: 'Policy number', type: 'text', required: true, sensitive: true },
        { id: 'date_of_loss', label: 'Date of loss', type: 'date', required: true },
      ],
    },
  ],
};

describe('form engine', () => {
  it('shows the insurance section only for insurance jobs', () => {
    expect(visibleFields(def, { job_type: 'retail' }).some((x) => x.section.id === 'insurance')).toBe(false);
    expect(visibleFields(def, { job_type: 'insurance' }).some((x) => x.section.id === 'insurance')).toBe(true);
  });

  it('enforces required fields only on completion, and only for visible fields', () => {
    expect(validateAnswers(def, {}, { mode: 'draft' })).toEqual([]);
    const done = validateAnswers(def, { job_type: 'retail' }, { mode: 'complete', photoCounts: { elevations: 4 } });
    expect(done.map((i) => i.fieldId).sort()).toEqual(['north_slope', 'room_length', 'room_width']);
    // Insurance fields become required once the section is visible.
    const ins = validateAnswers(def, { job_type: 'insurance' }, { mode: 'complete', photoCounts: { elevations: 4 } });
    expect(ins.map((i) => i.fieldId)).toEqual(expect.arrayContaining(['policy_number', 'date_of_loss']));
  });

  it('rejects answers for hidden fields and unknown ids', () => {
    const issues = validateAnswers(def, { job_type: 'retail', policy_number: 'X1' , nope: 1 }, { mode: 'draft' });
    expect(issues.map((i) => i.fieldId).sort()).toEqual(['nope', 'policy_number']);
    expect(Object.keys(stripHidden(def, { job_type: 'retail', policy_number: 'X1' }))).toEqual(['job_type']);
  });

  it('requires photos and notes according to the condition rating', () => {
    const answers = { job_type: 'retail', room_length: { value: 10, unit: 'ft' }, room_width: { value: 12, unit: 'ft' }, north_slope: { rating: 'needs_replacement' } };
    const issues = validateAnswers(def, answers, { mode: 'complete', photoCounts: { elevations: 4 } });
    expect(issues.find((i) => i.fieldId === 'north_slope')).toBeTruthy();
    const ok = validateAnswers(def, { ...answers, north_slope: { rating: 'needs_replacement', notes: 'Hail' } }, { mode: 'complete', photoCounts: { elevations: 4, north_slope: 1 } });
    expect(ok).toEqual([]);
    expect(validateAnswers(def, answers, { mode: 'complete', photoCounts: { elevations: 3, north_slope: 1 } }).some((i) => i.fieldId === 'elevations')).toBe(true);
  });

  it('validates types, enums and measurement units', () => {
    const bad = validateAnswers(def, { job_type: 'other', room_length: { value: -1, unit: 'ft' }, room_width: { value: 3, unit: 'SQ' }, north_slope: { rating: 'ok' } }, { mode: 'draft' });
    expect(bad.map((i) => i.fieldId).sort()).toEqual(['job_type', 'north_slope', 'room_length', 'room_width']);
  });

  it('recomputes derived values (client values are ignored) and uses one decimal rule', () => {
    const out = computeDerived(def, { room_length: { value: 12.5, unit: 'ft' }, room_width: { value: 10, unit: 'ft' }, room_sqft: { value: 1, unit: 'SF' } });
    expect(out.room_sqft).toEqual({ value: 125, unit: 'SF' });
    expect(computeDerived(def, { room_length: { value: 12, unit: 'ft' } }).room_sqft).toBeUndefined();
  });

  it('redacts sensitive answers', () => {
    expect(redactSensitive(def, { job_type: 'insurance', policy_number: 'P-123' })).toEqual({ job_type: 'insurance', policy_number: '[restricted]' });
  });

  it('validates a template definition and flags breaking changes', () => {
    expect(validateDefinition(def)).toEqual([]);
    const broken: FormDefinition = { sections: [{ id: 's', title: 'S', fields: [
      { id: 'a', label: 'A', type: 'dropdown' },
      { id: 'a', label: 'dup', type: 'text', visibleWhen: { field: 'ghost', op: 'notEmpty' } },
      { id: 'Bad-Id', label: 'x', type: 'text' },
    ] }] };
    const errs = validateDefinition(broken).join(' | ');
    expect(errs).toMatch(/needs at least one option/);
    expect(errs).toMatch(/Duplicate field id "a"/);
    expect(errs).toMatch(/unknown field "ghost"/);
    expect(errs).toMatch(/Bad-Id/);
    const changed: FormDefinition = { sections: [{ id: 'job', title: 'Job', fields: [{ id: 'job_type', label: 'Job type', type: 'text' }] }] };
    expect(breakingChanges(def, changed).join(' ')).toMatch(/changed type/);
  });

  it('keeps the backend copy identical to shared/form-engine.ts', () => {
    const shared = readFileSync(new URL('../../../../shared/form-engine.ts', import.meta.url), 'utf8');
    const copy = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8');
    expect(copy).toBe(shared);
    const front = readFileSync(new URL('../../../../frontend/src/lib/form-engine.ts', import.meta.url), 'utf8');
    expect(front).toBe(shared);
  });
});
