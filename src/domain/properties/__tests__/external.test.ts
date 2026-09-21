import { describe, expect, it } from 'vitest';
import {
  aggregateValues,
  coerceValue,
  compareValues,
  isDataType,
  normaliseName,
  VALUE_MAX,
  type DataType,
} from '../external';

const def = (dataType: DataType, enumValues: string[] = []) => ({ dataType, enumValues });

describe('normaliseName', () => {
  it('keeps the name verbatim and derives the lookup name', () => {
    expect(normaliseName('  Target Release ')).toEqual({
      name: 'Target Release',
      searchName: 'target release',
      searchable: false,
    });
  });

  it('marks a name without spaces as searchable', () => {
    expect(normaliseName('RiskScore')?.searchable).toBe(true);
  });

  it('collapses runs of whitespace', () => {
    expect(normaliseName('Target   Release')?.name).toBe('Target Release');
  });

  it('refuses a blank or over-long name', () => {
    expect(normaliseName('   ')).toBeNull();
    expect(normaliseName('x'.repeat(65))).toBeNull();
    expect(normaliseName(42)).toBeNull();
  });
});

describe('coerceValue', () => {
  it('treats blank, null and undefined as clearing the value', () => {
    expect(coerceValue(def('STRING'), '')).toEqual({ ok: true, value: null });
    expect(coerceValue(def('NUMBER'), '   ')).toEqual({ ok: true, value: null });
    expect(coerceValue(def('STRING'), null)).toEqual({ ok: true, value: null });
    expect(coerceValue(def('STRING'), undefined)).toEqual({ ok: true, value: null });
  });

  it('trims a string and keeps its case', () => {
    expect(coerceValue(def('STRING'), '  Signed off ')).toEqual({ ok: true, value: 'Signed off' });
  });

  it('canonicalises a number and refuses one that is not', () => {
    expect(coerceValue(def('NUMBER'), '3.50')).toEqual({ ok: true, value: '3.5' });
    expect(coerceValue(def('NUMBER'), '-12')).toEqual({ ok: true, value: '-12' });
    expect(coerceValue(def('NUMBER'), 'high')).toMatchObject({ ok: false });
    expect(coerceValue(def('NUMBER'), 'Infinity')).toMatchObject({ ok: false });
  });

  it('accepts the documented spellings of a boolean', () => {
    for (const yes of ['true', 'TRUE', 'yes', '1']) {
      expect(coerceValue(def('BOOLEAN'), yes)).toEqual({ ok: true, value: 'true' });
    }
    for (const no of ['false', 'No', '0']) {
      expect(coerceValue(def('BOOLEAN'), no)).toEqual({ ok: true, value: 'false' });
    }
    expect(coerceValue(def('BOOLEAN'), 'maybe')).toMatchObject({ ok: false });
  });

  it('pins a date to ISO so ordered comparison works (spec 02 §5)', () => {
    expect(coerceValue(def('DATE'), '2026-06-30')).toEqual({ ok: true, value: '2026-06-30' });
    expect(coerceValue(def('DATE'), '30/06/2026')).toMatchObject({ ok: false });
    // A well-formed but impossible date is still a refusal.
    expect(coerceValue(def('DATE'), '2026-02-30')).toMatchObject({ ok: false });
  });

  it('requires an enum value to be a member, case-sensitively', () => {
    const approval = def('ENUM', ['Pending', 'Signed off']);
    expect(coerceValue(approval, 'Signed off')).toEqual({ ok: true, value: 'Signed off' });
    expect(coerceValue(approval, 'signed off')).toMatchObject({ ok: false });
    expect(coerceValue(approval, 'Approved')).toMatchObject({ ok: false });
  });

  it('names the members in the refusal so the author can fix it', () => {
    const outcome = coerceValue(def('ENUM', ['Pending', 'Signed off']), 'Approved');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('Pending, Signed off');
  });

  it('caps the length, generously for TEXT and tightly for everything else', () => {
    expect(coerceValue(def('TEXT'), 'x'.repeat(VALUE_MAX.TEXT))).toMatchObject({ ok: true });
    expect(coerceValue(def('TEXT'), 'x'.repeat(VALUE_MAX.TEXT + 1))).toMatchObject({ ok: false });
    expect(coerceValue(def('STRING'), 'x'.repeat(VALUE_MAX.OTHER + 1))).toMatchObject({ ok: false });
  });

  it('refuses a value that is not a scalar at all', () => {
    expect(coerceValue(def('STRING'), { toString: () => 'sneaky' })).toMatchObject({ ok: false });
  });
});

describe('aggregateValues', () => {
  it('counts the values that are present, and only those', () => {
    expect(aggregateValues('count', 'STRING', ['a', '', 'b'])).toEqual({ ok: true, text: '2' });
    expect(aggregateValues('count', 'NUMBER', [])).toEqual({ ok: true, text: '0' });
  });

  it('sums and averages a number property', () => {
    expect(aggregateValues('sum', 'NUMBER', ['1', '2', '4'])).toEqual({ ok: true, text: '7' });
    expect(aggregateValues('avg', 'NUMBER', ['1', '2'])).toEqual({ ok: true, text: '1.5' });
  });

  it('drops floating-point noise from an average', () => {
    expect(aggregateValues('avg', 'NUMBER', ['1', '1', '1.1'])).toEqual({ ok: true, text: '1.03333333333' });
  });

  it('refuses sum and avg on a property that is not numeric', () => {
    expect(aggregateValues('sum', 'STRING', ['a'])).toMatchObject({ ok: false });
    expect(aggregateValues('avg', 'DATE', ['2026-01-01'])).toMatchObject({ ok: false });
  });

  it('orders min and max numerically for NUMBER and by collation otherwise', () => {
    expect(aggregateValues('min', 'NUMBER', ['10', '9'])).toEqual({ ok: true, text: '9' });
    expect(aggregateValues('max', 'NUMBER', ['10', '9'])).toEqual({ ok: true, text: '10' });
    expect(aggregateValues('min', 'STRING', ['10', '9'])).toEqual({ ok: true, text: '10' });
    expect(aggregateValues('max', 'DATE', ['2026-01-02', '2025-12-31'])).toEqual({
      ok: true,
      text: '2026-01-02',
    });
  });

  it('shows an em dash rather than an empty cell when nothing has a value', () => {
    expect(aggregateValues('sum', 'NUMBER', ['', ' '])).toEqual({ ok: true, text: '—' });
    expect(aggregateValues('max', 'STRING', [])).toEqual({ ok: true, text: '—' });
  });
});

describe('compareValues', () => {
  it('compares numbers as numbers and everything else by code unit', () => {
    expect(compareValues('NUMBER', '9', '10')).toBeLessThan(0);
    expect(compareValues('STRING', '9', '10')).toBeGreaterThan(0);
    expect(compareValues('NUMBER', 'x', 'y')).toBeLessThan(0);
  });
});

describe('isDataType', () => {
  it('narrows a string from the wire', () => {
    expect(isDataType('ENUM')).toBe(true);
    expect(isDataType('enum')).toBe(false);
    expect(isDataType(null)).toBe(false);
  });
});
