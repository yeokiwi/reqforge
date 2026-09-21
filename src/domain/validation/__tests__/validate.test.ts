import { describe, expect, it } from 'vitest';
import type { Placement } from '../fixes';
import { parseRule, parseRules, type Rule } from '../rules';
import { statusOf, validateRequirement, type Subject } from '../validate';

/**
 * spec: 06-requirement-types.md §2.1 — the status mapping table, rule by rule.
 * RD-041 adds PROPERTY_NOT_IN_VALUES and PROPERTY_DOES_NOT_MATCH to the catalogue.
 */

const placement: Placement = {
  layout: 'HORIZONTAL_TABLE',
  anchorPath: '1.1.2',
  table: { path: '1', row: 1, column: 2, hasHeader: true },
  cells: [
    { name: 'Title', searchName: 'title', valuePath: '1.1.0' },
    { name: 'Status', searchName: 'status', valuePath: '1.1.1' },
    { name: 'Priority', searchName: 'priority', valuePath: '1.1.3' },
  ],
};

const subject = (overrides: Partial<Subject> = {}): Subject => ({
  key: 'FN-001',
  anchorPath: '1.1.2',
  properties: [{ name: 'Status', searchName: 'status', value: 'Draft' }],
  outbound: [],
  inbound: [],
  placement,
  ...overrides,
});

const codes = (rules: Rule[], over: Partial<Subject> = {}) =>
  validateRequirement(subject(over), rules).diagnostics.map((diagnostic) => diagnostic.code);

describe('the status mapping (spec 06 §2.1)', () => {
  it('TRUE when every rule passes', () => {
    const outcome = validateRequirement(subject(), [{ kind: 'REQUIRED_PROPERTY', name: 'Status' }]);
    expect(outcome.status).toBe('TRUE');
    expect(outcome.diagnostics).toEqual([]);
  });

  it('TRUE when the type has no rules at all', () => {
    expect(validateRequirement(subject(), []).status).toBe('TRUE');
  });

  it('FALSE when a required property is missing', () => {
    const outcome = validateRequirement(subject(), [{ kind: 'REQUIRED_PROPERTY', name: 'Priority' }]);
    expect(outcome.status).toBe('FALSE');
    expect(outcome.diagnostics[0]).toMatchObject({
      code: 'MISSING_REQUIRED_PROPERTY',
      severity: 'error',
      key: 'FN-001',
      path: '1.1.2',
    });
  });

  it('WARNING when only an optional property is missing', () => {
    const outcome = validateRequirement(subject(), [{ kind: 'OPTIONAL_PROPERTY', name: 'Rationale' }]);
    expect(outcome.status).toBe('WARNING');
    expect(outcome.diagnostics[0]?.severity).toBe('warning');
  });

  it('FALSE beats WARNING when both are present', () => {
    const outcome = validateRequirement(subject(), [
      { kind: 'OPTIONAL_PROPERTY', name: 'Rationale' },
      { kind: 'REQUIRED_PROPERTY', name: 'Priority' },
    ]);
    expect(outcome.status).toBe('FALSE');
    expect(outcome.diagnostics).toHaveLength(2);
  });

  it('treats a present-but-empty property as absent (RD-020)', () => {
    expect(
      codes([{ kind: 'REQUIRED_PROPERTY', name: 'Status' }], {
        properties: [{ name: 'Status', searchName: 'status', value: '   ' }],
      }),
    ).toEqual(['MISSING_REQUIRED_PROPERTY']);
  });

  it('finds a property by its lookup name, whatever the case of the rule', () => {
    expect(codes([{ kind: 'REQUIRED_PROPERTY', name: 'STATUS' }])).toEqual([]);
  });

  it('warns about a headerless table and offers to promote the header (rule S4)', () => {
    const outcome = validateRequirement(subject({ headerlessTable: true }), []);
    expect(outcome.status).toBe('WARNING');
    expect(outcome.diagnostics[0]).toMatchObject({
      code: 'TABLE_HAS_NO_HEADER',
      fix: { kind: 'promoteHeader', tablePath: '1' },
    });
  });
});

describe('REQUIRED_DEPENDENCY, both directions (RD-040)', () => {
  const toRule: Rule = { kind: 'REQUIRED_DEPENDENCY', relationship: 'satisfies', direction: 'to' };
  const fromRule: Rule = { kind: 'REQUIRED_DEPENDENCY', relationship: 'verifies', direction: 'from' };

  it('passes when the outbound edge is there', () => {
    expect(codes([toRule], { outbound: ['satisfies'] })).toEqual([]);
  });

  it('fails when it is not, and says which way round', () => {
    const outcome = validateRequirement(subject(), [toRule]);
    expect(outcome.diagnostics[0]?.message).toContain('must depend on something');
    expect(outcome.status).toBe('FALSE');
  });

  it('reads an inbound edge for a `from` rule — the edge lives in another document', () => {
    expect(codes([fromRule], { inbound: ['verifies'] })).toEqual([]);
    const outcome = validateRequirement(subject(), [fromRule]);
    expect(outcome.diagnostics[0]?.message).toContain('Something must depend on FN-001');
  });

  it('does not let an outbound edge satisfy a `from` rule, or the reverse', () => {
    expect(codes([fromRule], { outbound: ['verifies'] })).toEqual(['MISSING_REQUIRED_DEPENDENCY']);
    expect(codes([toRule], { inbound: ['satisfies'] })).toEqual(['MISSING_REQUIRED_DEPENDENCY']);
  });

  it('matches a relationship exactly — relationship names are case-sensitive (RD-032)', () => {
    expect(codes([toRule], { outbound: ['Satisfies'] })).toEqual(['MISSING_REQUIRED_DEPENDENCY']);
  });

  it('offers the link picker scoped to the relationship', () => {
    const outcome = validateRequirement(subject(), [toRule]);
    expect(outcome.diagnostics[0]?.fix).toEqual({
      kind: 'addDependency',
      anchorPath: '1.1.2',
      relationship: 'satisfies',
      direction: 'to',
      // The scope has no `satisfies` column, so there is no cell to aim at yet.
      cellPath: null,
    });
  });

  it('aims the picker at the cell under the header naming the relationship', () => {
    const outcome = validateRequirement(
      subject({
        placement: {
          ...placement,
          cells: [...placement.cells, { name: 'satisfies', searchName: 'satisfies', valuePath: '1.1.4' }],
        },
      }),
      [toRule],
    );
    expect(outcome.diagnostics[0]?.fix).toMatchObject({ kind: 'addDependency', cellPath: '1.1.4' });
  });

  it('offers no fix for a `from` rule: a link inserted here would be outbound', () => {
    const outcome = validateRequirement(
      subject({
        placement: {
          ...placement,
          cells: [...placement.cells, { name: 'verifies', searchName: 'verifies', valuePath: '1.1.4' }],
        },
      }),
      [fromRule],
    );
    expect(outcome.diagnostics[0]?.fix).toBeUndefined();
  });
});

describe('PROPERTY_IN (RD-015)', () => {
  const rule: Rule = { kind: 'PROPERTY_IN', name: 'Status', values: ['Draft', 'Reviewed', 'Approved'] };

  it('passes on a member', () => {
    expect(codes([rule])).toEqual([]);
  });

  it('fails on a non-member and names the allowed values', () => {
    const outcome = validateRequirement(
      subject({ properties: [{ name: 'Status', searchName: 'status', value: 'Sort of done' }] }),
      [rule],
    );
    expect(outcome.status).toBe('FALSE');
    expect(outcome.diagnostics[0]?.code).toBe('PROPERTY_NOT_IN_VALUES');
    expect(outcome.diagnostics[0]?.message).toContain('Draft, Reviewed, Approved');
  });

  it('is case-sensitive, as property values are (spec 02 §2.1)', () => {
    expect(
      codes([rule], { properties: [{ name: 'Status', searchName: 'status', value: 'draft' }] }),
    ).toEqual(['PROPERTY_NOT_IN_VALUES']);
  });

  it('offers a dropdown over the allowed values, pointed at the right cell', () => {
    const outcome = validateRequirement(
      subject({ properties: [{ name: 'Status', searchName: 'status', value: 'Nope' }] }),
      [rule],
    );
    expect(outcome.diagnostics[0]?.fix).toEqual({
      kind: 'setCellValue',
      cellPath: '1.1.1',
      name: 'Status',
      values: ['Draft', 'Reviewed', 'Approved'],
    });
  });

  it('says nothing when the property is absent — a value rule does not make it required', () => {
    expect(codes([rule], { properties: [] })).toEqual([]);
  });
});

describe('PROPERTY_MATCHES (RD-015)', () => {
  const rule: Rule = { kind: 'PROPERTY_MATCHES', name: 'Status', pattern: '^[A-Z][a-z]+$' };

  it('passes a value that matches', () => {
    expect(codes([rule])).toEqual([]);
  });

  it('fails one that does not, and quotes the pattern', () => {
    const outcome = validateRequirement(
      subject({ properties: [{ name: 'Status', searchName: 'status', value: '42' }] }),
      [rule],
    );
    expect(outcome.status).toBe('FALSE');
    expect(outcome.diagnostics[0]?.code).toBe('PROPERTY_DOES_NOT_MATCH');
    expect(outcome.diagnostics[0]?.message).toContain('^[A-Z][a-z]+$');
  });

  it('carries no fix: no value can be invented that matches an arbitrary pattern', () => {
    const outcome = validateRequirement(
      subject({ properties: [{ name: 'Status', searchName: 'status', value: '42' }] }),
      [rule],
    );
    expect(outcome.diagnostics[0]?.fix).toBeUndefined();
  });

  it('treats an uncompilable pattern as a rule that never matches, not a crash', () => {
    const broken: Rule = { kind: 'PROPERTY_MATCHES', name: 'Status', pattern: '([unclosed' };
    expect(() => validateRequirement(subject(), [broken])).not.toThrow();
    expect(codes([broken])).toEqual([]);
  });

  it('says nothing when the property is absent', () => {
    expect(codes([rule], { properties: [] })).toEqual([]);
  });
});

describe('without a document in hand (the revalidation job)', () => {
  it('still decides the status, and simply offers no fix', () => {
    const outcome = validateRequirement(subject({ placement: null }), [
      { kind: 'REQUIRED_PROPERTY', name: 'Priority' },
      { kind: 'REQUIRED_DEPENDENCY', relationship: 'satisfies', direction: 'to' },
    ]);
    expect(outcome.status).toBe('FALSE');
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.fix)).toEqual([undefined, undefined]);
  });

  it('offers no column fix for a paragraph requirement either — there is no table', () => {
    const outcome = validateRequirement(
      subject({ placement: { layout: 'PARAGRAPH', anchorPath: '0.0', table: null, cells: [] } }),
      [{ kind: 'REQUIRED_PROPERTY', name: 'Priority' }],
    );
    expect(outcome.diagnostics[0]?.fix).toBeUndefined();
  });
});

describe('statusOf', () => {
  it('maps a diagnostic list to a status', () => {
    expect(statusOf([])).toBe('TRUE');
    expect(statusOf([{ code: 'TABLE_HAS_NO_HEADER', severity: 'warning', message: '', path: '' }])).toBe('WARNING');
    expect(statusOf([{ code: 'KEY_INVALID', severity: 'error', message: '', path: '' }])).toBe('FALSE');
  });
});

describe('parseRule', () => {
  it('narrows every well-formed kind', () => {
    expect(parseRule({ kind: 'REQUIRED_PROPERTY', name: ' Priority ' })).toEqual({
      kind: 'REQUIRED_PROPERTY',
      name: 'Priority',
    });
    expect(parseRule({ kind: 'REQUIRED_DEPENDENCY', relationship: 'verifies', direction: 'from' })).toEqual({
      kind: 'REQUIRED_DEPENDENCY',
      relationship: 'verifies',
      direction: 'from',
    });
    expect(parseRule({ kind: 'PROPERTY_IN', name: 'Status', values: ['A', ' B '] })).toEqual({
      kind: 'PROPERTY_IN',
      name: 'Status',
      values: ['A', 'B'],
    });
  });

  it('refuses a rule whose shape is wrong rather than passing everything', () => {
    expect(parseRule({ kind: 'REQUIRED_PROPERTY' })).toBeNull();
    expect(parseRule({ kind: 'REQUIRED_PROPERTY', name: '  ' })).toBeNull();
    expect(parseRule({ kind: 'REQUIRED_DEPENDENCY', relationship: 'x', direction: 'sideways' })).toBeNull();
    expect(parseRule({ kind: 'PROPERTY_IN', name: 'Status', values: [] })).toBeNull();
    expect(parseRule({ kind: 'PROPERTY_MATCHES', name: 'Status' })).toBeNull();
    expect(parseRule({ kind: 'NONSENSE', name: 'x' })).toBeNull();
    expect(parseRule(null)).toBeNull();
  });

  it('drops the unusable rows of a list and keeps the rest', () => {
    expect(parseRules([{ kind: 'REQUIRED_PROPERTY', name: 'A' }, null, { kind: 'bad' }])).toHaveLength(1);
    expect(parseRules('not a list')).toEqual([]);
  });
});
