import { describe, expect, it } from 'vitest';
import type { ExternalTypeMap } from '@/domain/properties/external';
import { analyse } from '../analyser';
import { compilePredicate } from '../compiler';
import { parse } from '../parser';
import { raw, render } from '../sql';

/**
 * Corpus additions for RD-037: `ext@Name` compares in the property's declared type.
 * spec: 02-query-language.md §4 (ext@ is a typed comparison), §10 (the corpus is the test)
 */
const TYPES: ExternalTypeMap = {
  riskscore: { dataType: 'NUMBER', enumValues: [] },
  approval: { dataType: 'ENUM', enumValues: ['Pending', 'Signed off'] },
  released: { dataType: 'DATE', enumValues: [] },
  waived: { dataType: 'BOOLEAN', enumValues: [] },
  owner: { dataType: 'STRING', enumValues: [] },
};

/** `null` means "no definitions loaded at all", which is not the same as an empty map. */
const errorsOf = (query: string, types: ExternalTypeMap | null = TYPES) =>
  analyse(parse(query), {
    spaceKey: 'ENG',
    isolated: false,
    ...(types === null ? {} : { externalTypes: types }),
  }).diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

const sqlOf = (query: string) =>
  render(compilePredicate(parse(query), 'r', { visibility: raw('TRUE'), externalTypes: TYPES }));

describe('corpus — ext@ analysed against its declared type', () => {
  it('accepts a value of the declared type', () => {
    expect(errorsOf('ext@RiskScore > 3')).toEqual([]);
    expect(errorsOf("ext@Approval = 'Signed off'")).toEqual([]);
    expect(errorsOf("ext@Released <= '2026-06-30'")).toEqual([]);
    expect(errorsOf("ext@Waived = 'true'")).toEqual([]);
    expect(errorsOf("ext@Owner = 'anyone at all'")).toEqual([]);
  });

  it('reports TYPE_MISMATCH for a value the type cannot hold', () => {
    for (const query of [
      "ext@RiskScore > 'high'",
      "ext@Approval = 'Approved'",
      "ext@Released < '30/06/2026'",
      "ext@Waived = 'maybe'",
    ]) {
      const [error] = errorsOf(query);
      expect(error?.code, query).toBe('TYPE_MISMATCH');
    }
  });

  it('underlines the value, not the field', () => {
    const [error] = errorsOf("ext@RiskScore > 'high'");
    expect(error?.offset).toBe("ext@RiskScore > ".length);
    expect(error?.length).toBe("'high'".length);
  });

  it('names the enum members in the message', () => {
    const [error] = errorsOf("ext@Approval = 'Approved'");
    expect(error?.message).toContain('Pending, Signed off');
  });

  it('refuses an ordered comparison on a yes-or-no property', () => {
    const [error] = errorsOf("ext@Waived > 'false'");
    expect(error?.code).toBe('TYPE_MISMATCH');
    expect(error?.message).toContain('yes-or-no');
  });

  it('checks every member of an IN list', () => {
    expect(errorsOf("ext@Approval IN ('Pending', 'Signed off')")).toEqual([]);
    expect(errorsOf("ext@Approval IN ('Pending', 'Approved')")[0]?.code).toBe('TYPE_MISMATCH');
  });

  it('leaves a pattern alone: ~ takes a pattern, not a value', () => {
    expect(errorsOf("ext@Released ~ '2026-%'")).toEqual([]);
    expect(errorsOf("ext@RiskScore ~ '1%'")).toEqual([]);
  });

  it('leaves an undeclared property as a plain string comparison', () => {
    expect(errorsOf("ext@NotDefinedYet = 'whatever'")).toEqual([]);
    expect(errorsOf("ext@RiskScore > 'high'", null)).toEqual([]);
  });

  it('leaves IS NULL alone whatever the type (RD-006)', () => {
    expect(errorsOf('ext@RiskScore IS NULL')).toEqual([]);
    expect(errorsOf('ext@Waived IS NOT NULL')).toEqual([]);
  });

  it('still requires a name after @', () => {
    expect(errorsOf("ext = 'x'")[0]?.code).toBe('TYPE_MISMATCH');
  });
});

describe('corpus — ext@ compiles in its declared type', () => {
  it('compares a NUMBER property numerically, guarded by a shape test', () => {
    const { text, params } = sqlOf('ext@RiskScore > 3');
    expect(text).toContain('(p.value)::numeric >');
    expect(text).toContain("p.value ~ '^-?[0-9]+(\\.[0-9]+)?$'");
    expect(params).toEqual(['EXTERNAL', 'riskscore', 3]);
  });

  it('compares a DATE property as a date', () => {
    const { text, params } = sqlOf("ext@Released <= '2026-06-30'");
    expect(text).toContain('(p.value)::date <=');
    expect(text).toContain("p.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(params).toEqual(['EXTERNAL', 'released', '2026-06-30']);
  });

  it('compares a BOOLEAN property as a boolean', () => {
    const { text } = sqlOf("ext@Waived = 'true'");
    expect(text).toContain('(p.value)::boolean =');
    expect(text).toContain("p.value IN ('true', 'false')");
  });

  it('leaves STRING and ENUM as a plain equality', () => {
    expect(sqlOf("ext@Owner = 'Ada'").text).toContain('p.value = $');
    expect(sqlOf("ext@Approval = 'Pending'").text).toContain('p.value = $');
  });

  it('never interpolates the value, whatever the type', () => {
    for (const query of ['ext@RiskScore > 3', "ext@Released <= '2026-06-30'", "ext@Waived = 'true'"]) {
      const { text } = render(compilePredicate(parse(query), 'r', { visibility: raw('TRUE'), externalTypes: TYPES }));
      expect(text, query).not.toContain('2026-06-30');
      expect(text, query).toContain('$1');
    }
  });

  it('falls back to the shape heuristic when no type is declared', () => {
    const { text } = render(compilePredicate(parse('ext@RiskScore > 3'), 'r', { visibility: raw('TRUE') }));
    expect(text).toContain('::numeric');
    const untyped = render(compilePredicate(parse("ext@Owner > 'Ada'"), 'r', { visibility: raw('TRUE') }));
    expect(untyped.text).toContain('COLLATE "C"');
  });

  it('pins the SQL of one query per data type', () => {
    expect(
      ['ext@RiskScore > 3', "ext@Released <= '2026-06-30'", "ext@Waived = 'true'", "ext@Approval = 'Pending'"].map(
        (query) => {
          const { text, params } = sqlOf(query);
          return `${query}\n  ${text}\n  params: ${JSON.stringify(params)}`;
        },
      ),
    ).toMatchSnapshot();
  });
});
