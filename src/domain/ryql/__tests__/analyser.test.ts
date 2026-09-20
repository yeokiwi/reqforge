import { describe, expect, it } from 'vitest';
import { FIELDS } from '../fields';
import { printExpr } from '../print';
import { parseAndAnalyse } from '..';
import { RESEARCH_EXAMPLES, TRAVERSAL_EXAMPLES } from './corpus/examples';

const context = { spaceKey: 'SJ', isolated: false };
const run = (query: string, overrides: Partial<typeof context> & { crossSpace?: boolean; defaultBaseline?: number | string | null } = {}) =>
  parseAndAnalyse(query, { ...context, ...overrides });

const codes = (query: string, overrides = {}) => {
  const result = run(query, overrides);
  return result.ok ? result.warnings.map((w) => w.code) : result.errors.map((e) => e.code);
};

describe('corpus 1 — the research examples analyse as documented', () => {
  it.each(RESEARCH_EXAMPLES.concat(TRAVERSAL_EXAMPLES))('$query is $expect', ({ query, expect: expectation }) => {
    const result = run(query);
    if (expectation === 'not-implemented') {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.map((error) => error.code)).toContain('NOT_IMPLEMENTED');
      return;
    }
    if (!result.ok) {
      throw new Error(`${query} failed: ${result.errors.map((error) => error.message).join('; ')}`);
    }
    if (expectation === 'warns') {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe('corpus 3 — every field × every invalid operator reports BAD_OPERATOR_FOR_FIELD', () => {
  const sample = (fieldName: string) => {
    switch (fieldName) {
      case 'property':
        return "@Category";
      case 'ext':
        return 'ext@Category';
      case 'rulestatus':
        return 'rulestatus';
      default:
        return fieldName;
    }
  };
  const valueFor = (fieldName: string) =>
    fieldName === 'status' ? "'ACTIVE'" : fieldName === 'rulestatus' ? "'true'" : "'x'";

  const allOperators = ['=', '!=', '~', 'NOT LIKE', '<', '<=', '>', '>='] as const;

  for (const field of FIELDS) {
    for (const operator of allOperators) {
      const supported = field.operators.includes(operator);
      const query = `${sample(field.name)} ${operator} ${valueFor(field.name)}`;

      it(`${query} → ${supported ? 'accepted' : 'BAD_OPERATOR_FOR_FIELD'}`, () => {
        const result = run(query);
        if (supported) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.errors.map((error) => error.code)).toContain('BAD_OPERATOR_FOR_FIELD');
        }
      });
    }
  }

  it('refuses IN on fields that do not support it', () => {
    expect(codes("text IN ('a', 'b')")).toContain('BAD_OPERATOR_FOR_FIELD');
    expect(run("status IN ('ACTIVE')").ok).toBe(true);
  });

  it('allows IS NULL and IS NOT NULL on every field (RD-006)', () => {
    for (const field of FIELDS) {
      const name = field.name === 'property' ? '@Category' : field.name === 'ext' ? 'ext@Category' : field.name;
      expect(run(`${name} IS NOT NULL`).ok).toBe(true);
    }
  });
});

describe('field errors (spec 02 §9)', () => {
  it('suggests the nearest field for a typo', () => {
    const result = run("stats = 'ACTIVE'");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code: 'UNKNOWN_FIELD', offset: 0, length: 5 });
      expect(result.errors[0]!.hint).toBe('Did you mean status?');
    }
  });

  it('explains the Atlassian-specific fields instead of guessing (RD-022)', () => {
    for (const query of ["jira = 'X'", "project = 'X'", "excel = '1'", "variant = 'a'"]) {
      const result = run(query);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]!.code).toBe('NOT_IMPLEMENTED');
    }
  });

  it('treats page and pageHistory as deprecated aliases, not errors (RD-002)', () => {
    const result = run('page = 467382');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings[0]).toMatchObject({ code: 'UNKNOWN_FIELD', severity: 'warning' });
      expect(result.warnings[0]!.hint).toBe('Use document instead.');
    }
  });

  it('rejects an invalid enum value with a suggestion', () => {
    const result = run("status = 'ACTIV'");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code: 'TYPE_MISMATCH' });
      expect(result.errors[0]!.hint).toBe("Did you mean 'ACTIVE'?");
    }
  });

  it('requires a qualifier where the field needs one, and refuses one where it does not', () => {
    expect(codes("ext = 'x'")).toContain('TYPE_MISMATCH');
    expect(codes("key@something = 'x'")).toContain('TYPE_MISMATCH');
    expect(run("to = 'BR-001'").ok).toBe(true);
  });

  it('reports unknown and unimplemented functions distinctly', () => {
    expect(codes("isModifyed('1')")).toContain('UNKNOWN_FUNCTION');
    expect(codes("hasTest('%ok%')")).toContain('NOT_IMPLEMENTED');
    expect(codes('isModified()')).toContain('TYPE_MISMATCH');
  });
});

describe('traversal (spec 02 §5.1, RD-021)', () => {
  it('accepts four hops and refuses five', () => {
    expect(run("to -> to -> to -> to -> key = 'X'").ok).toBe(true);
    const result = run("to -> to -> to -> to -> to -> key = 'X'");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('TRAVERSAL_TOO_DEEP');
  });

  it('refuses -> on a field that is not a dependency', () => {
    expect(codes("text -> key = 'X'")).toContain('BAD_OPERATOR_FOR_FIELD');
  });
});

describe('precedence warning (RD-018)', () => {
  it('warns when AND and OR are mixed without parentheses', () => {
    const result = run("key = 'a' AND text ~ 'b' OR title = 'c'");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const warning = result.warnings.find((w) => w.code === 'AMBIGUOUS_PRECEDENCE');
      expect(warning?.severity).toBe('warning');
      expect(warning?.hint).toBe('Reqforge reads it as (a AND b) OR c.');
    }
  });

  it('does not warn once the query is parenthesised', () => {
    const result = run("(key = 'a' AND text ~ 'b') OR title = 'c'");
    expect(result.ok && result.warnings.map((w) => w.code)).not.toContain('AMBIGUOUS_PRECEDENCE');
  });
});

describe('default scope (spec 02 §8)', () => {
  const scopeOf = (query: string, overrides = {}) => {
    const result = run(query, overrides);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    return { printed: printExpr(result.query.expr), injected: result.query.injected };
  };

  it('scopes to the current space, live rows and ACTIVE status', () => {
    const { injected } = scopeOf("key = 'FN-001'");
    expect(injected).toEqual(["spaceKey = 'SJ'", 'baseline IS NULL', "status = 'ACTIVE'"]);
  });

  it('injects into the AST, so the scope is visible and testable', () => {
    expect(scopeOf("key = 'FN-001'").printed).toBe(
      "(status = 'ACTIVE' AND (baseline IS NULL AND (spacekey = 'SJ' AND key = 'FN-001')))",
    );
  });

  it('leaves the space alone when the query names one, or cross-space search is on', () => {
    expect(scopeOf("spaceKey = 'OTHER'").injected).not.toContain("spaceKey = 'SJ'");
    expect(scopeOf("key = 'a'", { crossSpace: true }).injected).not.toContain("spaceKey = 'SJ'");
  });

  it('drops the status default when the query names a baseline (research §3.1)', () => {
    const { injected } = scopeOf('baseline = 3');
    expect(injected).not.toContain("status = 'ACTIVE'");
    expect(injected).not.toContain('baseline IS NULL');
  });

  it("applies the UI's baseline dropdown as a default an explicit baseline overrides", () => {
    expect(scopeOf("key = 'a'", { defaultBaseline: 3 }).injected).toContain('baseline = 3');
    expect(scopeOf('baseline = 5', { defaultBaseline: 3 }).injected).not.toContain('baseline = 3');
  });

  it('keeps an isolated space isolated, even with cross-space search on (spec 07 §3)', () => {
    expect(scopeOf("key = 'a'", { isolated: true, crossSpace: true }).injected).toContain("spaceKey = 'SJ'");

    const result = run("spaceKey = 'OTHER'", { isolated: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('CROSS_SPACE_NOT_ALLOWED');
  });

  it('counts a baseline named inside a traversal as the outer query naming one', () => {
    // A traversal's right-hand side is a different requirement, so it must not satisfy
    // the outer scope: the outer query still gets its baseline default.
    const { injected } = scopeOf("to -> baseline = 3");
    expect(injected).toContain('baseline IS NULL');
  });
});
