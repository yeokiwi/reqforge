import { describe, expect, it } from 'vitest';
import { analyse } from '../analyser';
import { compilePredicate } from '../compiler';
import { parse } from '../parser';
import { raw, render } from '../sql';

/**
 * Corpus additions for slice 14: `isModified()` and `baseline was`, which parsed and
 * analysed since slice 5 and threw `NOT_IMPLEMENTED` from the compiler until now.
 * spec: 02-query-language.md §4, §6, §10; 05-baselines-and-diff.md §5.3; RD-013, RD-047
 */

const context = { visibility: raw('TRUE') };
const sqlOf = (query: string) =>
  render(compilePredicate(analyse(parse(query), { spaceKey: 'ENG', isolated: false }).userExpr, 'r', context));

describe('isModified(baseline)', () => {
  it('compares the live row against its snapshot in that baseline', () => {
    const { text } = sqlOf("isModified('3')");

    expect(text).toContain('"Baseline"');
    expect(text).toContain('snap.title IS DISTINCT FROM r.title');
    // RD-047 — bodySearch is markup-free, so comparing it is the default ignore set.
    expect(text).toContain('snap."bodySearch" IS DISTINCT FROM r."bodySearch"');
    expect(text).toContain('p.kind = \'INLINE\'');
  });

  it('accepts a baseline by number and by name, as the baseline field does', () => {
    expect(sqlOf('isModified(3)').params).toContain(3);
    expect(sqlOf("isModified('Release 1.3c')").params).toContain('Release 1.3c');
  });

  it('joins the snapshot on space and key, not on id — snapshots have their own ids', () => {
    const { text } = sqlOf('isModified(3)');
    expect(text).toContain('s."spaceId" = r."spaceId"');
    expect(text).toContain('s."upperKey" = r."upperKey"');
  });

  it('orders the property set canonically, so column order is not a change', () => {
    const { text } = sqlOf('isModified(3)');
    expect(text).toContain('ORDER BY p."searchName", p."valueIndex", p.value');
  });

  it('never interpolates the baseline it was given', () => {
    const { text, params } = sqlOf("isModified('Release 1.3c')");
    expect(text).not.toContain('Release 1.3c');
    expect(params).toContain('Release 1.3c');
  });

  it('negates as the complement, under two-valued logic (RD-020)', () => {
    const { text } = sqlOf('NOT isModified(3)');
    expect(text).toContain('NOT EXISTS');
  });

  it('composes with the rest of a query, which is why it is a SQL predicate', () => {
    const { text } = sqlOf("key ~ 'FN-%' AND isModified(3)");
    expect(text).toContain('ILIKE');
    expect(text).toContain('IS DISTINCT FROM');
  });
});

describe('baseline was N (spec 05 §5.3)', () => {
  it('asks whether this requirement has a snapshot in that baseline', () => {
    const { text, params } = sqlOf('baseline was 3');
    expect(text).toContain('EXISTS');
    expect(text).toContain('b.number =');
    expect(params).toContain(3);
  });

  it('accepts a name too', () => {
    expect(sqlOf("baseline was 'Release 1.3c'").params).toContain('Release 1.3c');
  });

  it('NOT (baseline was N) is how spec 05 §5.3 finds what is new since N', () => {
    const { text } = sqlOf('NOT (baseline was 3)');
    expect(text).toContain('NOT');
    expect(text).toContain('EXISTS');
  });

  it('combines with a baseline predicate, as research §3.8 example 12 does', () => {
    const { text } = sqlOf('baseline = 4 and baseline was 3');
    expect(text).toContain('AND');
    expect(text).toMatch(/b\.number/);
  });

  it('pins the SQL of both predicates', () => {
    expect(
      ['isModified(3)', "isModified('Release 1.3c')", 'baseline was 3'].map((query) => {
        const { text, params } = sqlOf(query);
        return `${query}\n  ${text}\n  params: ${JSON.stringify(params)}`;
      }),
    ).toMatchSnapshot();
  });
});
