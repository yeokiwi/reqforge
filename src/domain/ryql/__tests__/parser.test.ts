import { describe, expect, it } from 'vitest';
import { parse } from '../parser';
import { printExpr } from '../print';
import { RESEARCH_EXAMPLES, TRAVERSAL_EXAMPLES } from './corpus/examples';
import { PRECEDENCE_CASES } from './corpus/precedence';

describe('corpus 1 — every example query from research §3.8 parses', () => {
  it.each([...RESEARCH_EXAMPLES, ...TRAVERSAL_EXAMPLES])('parses $query', ({ query }) => {
    expect(() => parse(query)).not.toThrow();
  });

  it('pins the AST of the representative examples', () => {
    expect(RESEARCH_EXAMPLES.map(({ query }) => `${query}  =>  ${printExpr(parse(query))}`)).toMatchSnapshot();
  });
});

describe('corpus 4 — precedence and associativity (RD-018)', () => {
  it.each(PRECEDENCE_CASES)('$query', ({ query, tree }) => {
    expect(printExpr(parse(query))).toBe(tree);
  });
});

describe('parser shapes', () => {
  it('builds a comparison with field, operator and value', () => {
    expect(parse("key = 'IG-1'")).toMatchObject({
      kind: 'comparison',
      field: { name: 'key', qualifier: null },
      operator: '=',
      value: { kind: 'string', value: 'IG-1' },
    });
  });

  it('treats a bare @Name as the property field', () => {
    expect(parse("@Category = 'Functional'")).toMatchObject({
      kind: 'comparison',
      field: { name: 'property', qualifier: 'Category' },
    });
  });

  it('keeps ext@ and to@ qualifiers on their own fields', () => {
    expect(parse("ext@Category = 'F'")).toMatchObject({ field: { name: 'ext', qualifier: 'Category' } });
    expect(parse("to@refines = 'X'")).toMatchObject({ field: { name: 'to', qualifier: 'refines' } });
  });

  it('parses LIKE and NOT LIKE as ~ and its negation', () => {
    expect(parse("text LIKE '%a%'")).toMatchObject({ operator: '~' });
    expect(parse("text NOT LIKE '%a%'")).toMatchObject({ operator: 'NOT LIKE' });
  });

  it('parses IS NULL, IS NOT NULL, IN and NOT IN', () => {
    expect(parse('baseline IS NULL')).toMatchObject({ kind: 'nullTest', negated: false });
    expect(parse('baseline IS NOT NULL')).toMatchObject({ kind: 'nullTest', negated: true });
    expect(parse("status IN ('ACTIVE', 'DELETED')")).toMatchObject({ kind: 'inTest', negated: false });
    expect(parse("status NOT IN ('DELETED')")).toMatchObject({ kind: 'inTest', negated: true });
  });

  it('parses baseline was, which is not a comparison', () => {
    expect(parse('baseline was 3')).toMatchObject({ kind: 'baselineWas', value: { kind: 'number', value: 3 } });
  });

  it('parses function predicates and the user() value function', () => {
    expect(parse("isModified('7')")).toMatchObject({ kind: 'call', name: 'ismodified' });
    expect(parse("@Owner = user('ada')")).toMatchObject({ value: { kind: 'call', name: 'user' } });
  });

  it('is case-insensitive for keywords and field names, but not for values', () => {
    expect(printExpr(parse("KEY = 'a' And Status = 'ACTIVE'"))).toBe("(key = 'a' AND status = 'ACTIVE')");
    expect(parse("key = 'MiXeD'")).toMatchObject({ value: { value: 'MiXeD' } });
  });

  it('reports syntax errors with an offset', () => {
    expect(() => parse("key = ")).toThrowError(/Expected a value/);
    expect(() => parse("key 'x'")).toThrowError(/Expected an operator/);
    expect(() => parse("(key = 'x'")).toThrowError(/closing parenthesis/);
    expect(() => parse("key = 'x' key = 'y'")).toThrowError(/after the end of the query/);
  });
});
