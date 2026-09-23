import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LimitExceededError, ValidationError } from '../errors';
import type { IndexedRequirement } from '../indexer/types';
import { checkDocumentLimits, DEFAULT_LIMITS, LIMIT_IDS, LIMITS, limitExceeded, parseLimitOverrides, resolveLimits } from '../limits';

/** spec 07 §4, the table, row by row — the registry must say what the spec says. */
function specRows(): Array<{ label: string; id: string; value: number; override: string }> {
  const spec = readFileSync(resolve(__dirname, '../../../docs/specs/07-permissions-and-limits.md'), 'utf8');
  const section = spec.slice(spec.indexOf('## 4. Limits'), spec.indexOf('## 5. Performance budget'));
  return section
    .split('\n')
    .filter((line) => /^\| [^-L]/.test(line) && line.includes('`'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return {
        label: cells[1]!,
        id: cells[2]!.replace(/`/g, ''),
        value: Number(cells[3]!.replace(/,/g, '')),
        override: cells[4]!,
      };
    });
}

const requirement = (typeId: string | null): IndexedRequirement =>
  ({ key: 'K-1', upperKey: 'K-1', uid: 'u', typeId, title: '', bodyHtml: '', bodySearch: '', anchorPath: '0', layout: 'PARAGRAPH' }) as IndexedRequirement;

describe('the limits registry (spec 07 §4, RD-071)', () => {
  it('matches the spec table exactly: every row, its default and its override class', () => {
    const rows = specRows();
    expect(rows.map((row) => row.id).sort()).toEqual([...LIMIT_IDS].sort());
    for (const row of rows) {
      const definition = LIMITS[row.id as keyof typeof LIMITS];
      expect({ id: row.id, label: definition.label, value: definition.default, override: definition.override }).toEqual({
        id: row.id,
        label: row.label,
        value: row.value,
        override: row.override,
      });
    }
  });

  it('keeps RY numbers where RY has them', () => {
    expect(DEFAULT_LIMITS.requirementsPerSpace).toBe(12_000);
    expect(DEFAULT_LIMITS.requirementsPerDocument).toBe(400);
    expect(DEFAULT_LIMITS.requirementsPerDocumentWarning).toBe(150);
    expect(DEFAULT_LIMITS.dependencyMatrixCells).toBe(40_000);
  });

  it('layers installation then space over the defaults', () => {
    const limits = resolveLimits({ requirementsPerSpace: 20_000, rulesPerType: 10 }, { requirementsPerSpace: 5 });
    expect(limits.requirementsPerSpace).toBe(5);
    expect(limits.rulesPerType).toBe(10);
    expect(limits.requirementsPerBaseline).toBe(12_000);
  });

  it('refuses to raise a lower-only limit, at either layer', () => {
    expect(() => resolveLimits({ matrixPageSizeMax: 601 })).toThrow(ValidationError);
    expect(() => resolveLimits({}, { dependencyMatrixCells: 50_000 })).toThrow(/may be lowered but not raised/);
    expect(resolveLimits({}, { matrixPageSizeMax: 200 }).matrixPageSizeMax).toBe(200);
  });

  it('refuses any change to a fixed limit, but accepts restating it', () => {
    expect(() => resolveLimits({}, { traversalDepth: 5 })).toThrow(/fixed at 4/);
    expect(() => resolveLimits({}, { traversalDepth: 3 })).toThrow(/fixed at 4/);
    expect(resolveLimits({}, { traversalDepth: 4 }).traversalDepth).toBe(4);
  });

  it('keeps a warning below its hard limit', () => {
    expect(() => resolveLimits({}, { requirementsPerDocument: 100 })).toThrow(/must be below/);
    expect(resolveLimits({}, { requirementsPerDocument: 100, requirementsPerDocumentWarning: 50 }).requirementsPerDocument).toBe(100);
  });

  it('parses overrides strictly: unknown names and non-numbers are refused, not ignored', () => {
    expect(parseLimitOverrides(null, 'x')).toEqual({});
    expect(parseLimitOverrides({ rulesPerType: 12 }, 'x')).toEqual({ rulesPerType: 12 });
    expect(() => parseLimitOverrides({ rulesPerTyp: 12 }, 'REQFORGE_LIMITS')).toThrow(/"rulesPerTyp" is not a limit/);
    expect(() => parseLimitOverrides({ rulesPerType: '12' }, 'x')).toThrow(/whole number/);
    expect(() => parseLimitOverrides({ rulesPerType: 0 }, 'x')).toThrow(/at least 1/);
    expect(() => parseLimitOverrides({ rulesPerType: 1.5 }, 'x')).toThrow(/whole number/);
    expect(() => parseLimitOverrides([1], 'x')).toThrow(/object/);
  });

  it('names the limit in the error, and carries it as problem details', () => {
    const error = limitExceeded('requirementsPerDocument', 400, 412, 'this document has 412 requirements');
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toBe('"Requirements per document" limit exceeded: this document has 412 requirements; the limit is 400.');
    expect(error.toProblem()).toMatchObject({ status: 422, code: 'LIMIT_EXCEEDED', limitName: 'requirementsPerDocument', limit: 400, actual: 412 });
  });
});

describe('checkDocumentLimits (spec 07 §4, RD-072)', () => {
  const limits = { requirementsPerDocument: 5, requirementsPerDocumentWarning: 3, typesPerDocument: 2 };
  const doc = (types: Array<string | null>) => ({ requirements: types.map(requirement) });

  it('passes quietly at or under the warning threshold', () => {
    expect(checkDocumentLimits(doc([null, null, null]), limits)).toEqual({ violation: null, warnings: [] });
  });

  it('warns above the threshold without blocking', () => {
    const outcome = checkDocumentLimits(doc([null, null, null, null]), limits);
    expect(outcome.violation).toBeNull();
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toMatchObject({ code: 'DOCUMENT_LARGE', severity: 'warning' });
  });

  it('refuses above the hard limit, naming it', () => {
    const outcome = checkDocumentLimits(doc([null, null, null, null, null, null]), limits);
    expect(outcome.violation?.message).toMatch(/^"Requirements per document" limit exceeded: this document has 6 requirements; the limit is 5\.$/);
  });

  it('counts distinct types, ignoring untyped requirements', () => {
    expect(checkDocumentLimits(doc(['a', 'a', 'b', null]), limits).violation).toBeNull();
    expect(checkDocumentLimits(doc(['a', 'b', 'c']), limits).violation?.message).toMatch(/"Types applying to one document" limit exceeded/);
  });
});
