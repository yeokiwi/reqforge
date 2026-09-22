import { describe, expect, it } from 'vitest';
import { compile, compilePredicate, toLikePattern } from '../compiler';
import { parse } from '../parser';
import { analyse } from '../analyser';
import { raw, render } from '../sql';
import { FIELDS } from '../fields';

const context = { visibility: raw('TRUE') };

const predicateOf = (query: string) => render(compilePredicate(parse(query), 'r', context));

describe('corpus 2 — every field × every valid operator compiles', () => {
  const sample = (name: string) => (name === 'property' ? '@Category' : name === 'ext' ? 'ext@Category' : name);
  const valueFor = (name: string) =>
    name === 'status' ? "'ACTIVE'" : name === 'rulestatus' ? "'true'" : name === 'baseline' ? '3' : "'x'";

  const cases = FIELDS.flatMap((field) =>
    field.operators.map((operator) => `${sample(field.name)} ${operator} ${valueFor(field.name)}`),
  );

  it.each(cases)('%s', (query) => {
    const { text, params } = predicateOf(query);
    expect(text.length).toBeGreaterThan(0);
    // The compiler never string-interpolates a user value (spec 02 §1).
    expect(text).not.toContain("'x'");
    expect(params.length).toBeGreaterThan(0);
  });

  it('pins the SQL of one query per field', () => {
    expect(
      FIELDS.map((field) => {
        const query = `${sample(field.name)} ${field.operators[0]} ${valueFor(field.name)}`;
        const { text, params } = predicateOf(query);
        return `${query}\n  ${text}\n  params: ${JSON.stringify(params)}`;
      }),
    ).toMatchSnapshot();
  });
});

describe('parameterisation', () => {
  it('binds every user value and numbers placeholders in order', () => {
    const { text, params } = predicateOf("key = 'FN-001' AND @Category = 'Functional'");
    expect(params).toEqual(['FN-001', 'INLINE', 'category', 'Functional']);
    expect(text).toContain('$1');
    expect(text).toContain('$4');
  });

  it('cannot be injected through a value', () => {
    const { text, params } = predicateOf("title = 'x\\'; DROP TABLE \"Requirement\"; --'");
    expect(text).not.toContain('DROP TABLE');
    expect(params[0]).toContain('DROP TABLE');
  });

  it('escapes _ and honours \\% as a literal percent (RD-019)', () => {
    expect(toLikePattern('a_b')).toBe('a\\_b');
    expect(toLikePattern('100\\%')).toBe('100\\%');
    expect(toLikePattern('FN-%')).toBe('FN-%');
    expect(predicateOf("text ~ 'FN-%'").text).toContain("ILIKE $1 ESCAPE '\\'");
  });
});

describe('two-valued logic, absence-as-false (spec 02 §7, RD-020)', () => {
  it('compiles NOT as a plain complement over EXISTS, never SQL three-valued logic', () => {
    const { text } = predicateOf("NOT (@Category = 'Functional')");
    expect(text.startsWith('(NOT (')).toBe(true);
    expect(text).toContain('EXISTS');
    // Not SQL three-valued logic: nothing tests for NULL truth values.
    expect(text).not.toContain('IS NOT TRUE');
    expect(text).not.toContain('IS DISTINCT FROM');
  });

  it('compiles != as NOT(=), so a missing property matches', () => {
    expect(predicateOf("@Category != 'Functional'").text).toContain('NOT');
  });

  it('IS NULL on an EXISTS field means no row exists', () => {
    const { text, params } = predicateOf('@Category IS NULL');
    expect(text).toContain('NOT');
    expect(text).toContain('EXISTS');
    expect(params).toContain('%');
  });

  it('IS NOT NULL is the complement of IS NULL, on any field (RD-006)', () => {
    expect(predicateOf('baseline IS NOT NULL').text).toBe('(NOT (r."baselineId" IS NULL))');
  });
});

describe('dependency direction (invariant P1)', () => {
  it('to/parent walks child → parent', () => {
    const { text } = predicateOf("to = 'BR-01'");
    expect(text).toContain('other.id = d."parentId"');
    expect(text).toContain('d."childId" = r.id');
  });

  it('from/child walks parent → child', () => {
    const { text } = predicateOf("from = 'BR-01'");
    expect(text).toContain('other.id = d."childId"');
    expect(text).toContain('d."parentId" = r.id');
  });

  it('a bare to matches any relationship; to@rel filters it', () => {
    expect(predicateOf("to = 'BR-01'").text).not.toContain('d.relationship');
    const qualified = predicateOf("to@refines = 'BR-01'");
    expect(qualified.text).toContain('d.relationship = $1');
    expect(qualified.params[0]).toBe('refines');
  });
});

describe('traversal compiles to joins, not recursion (RD-021)', () => {
  it('nests one EXISTS per hop', () => {
    const { text } = predicateOf("to -> to -> key = 'BR-01'");
    expect(text.match(/EXISTS/g)?.length).toBe(2);
    expect(text).not.toContain('RECURSIVE');
  });

  it('carries the visibility predicate into every hop (rule X3)', () => {
    const { text } = render(
      compilePredicate(parse("to -> key = 'BR-01'"), 'r', { visibility: raw('$alias."spaceId" = \'space-1\'') }),
    );
    expect(text).toContain('"spaceId" = \'space-1\'');
    expect(text).not.toContain('$alias');
  });
});

describe('the full query', () => {
  const analysed = (query: string) =>
    analyse(parse(query), { spaceKey: 'SJ', isolated: false });

  it('selects requirement columns, applies visibility, orders and pages', () => {
    const compiled = compile(analysed("key ~ 'FN-%'").expr, { ...context, limit: 50, offset: 100 });
    expect(compiled.text).toContain('FROM "Requirement" r');
    expect(compiled.text).toContain('ORDER BY r."upperKey" ASC');
    expect(compiled.params).toContain(50);
    expect(compiled.params).toContain(100);
    expect(compiled.countText).toContain('COUNT(*)');
  });

  it('caps the page size at the spec 07 §4 maximum of 600', () => {
    const compiled = compile(analysed("key ~ '%'").expr, { ...context, limit: 5000 });
    expect(compiled.params).toContain(600);
  });

  it('still refuses what belongs to a later slice, with a code the UI can show', () => {
    // `baseline was` and `isModified()` compile as of slice 14; the testing module does not.
    expect(() => compile(analysed("hasTest('%ok%')").expr, context)).toThrowError();
  });
});
