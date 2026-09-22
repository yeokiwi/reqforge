import { describe, expect, it } from 'vitest';
import { buildMapping } from '@/domain/keys/rename';
import { rewriteKeyLiterals } from '../rewrite';

const mapping = buildMapping([
  { from: 'FN-1', to: 'SYS-1' },
  { from: 'FN-2', to: 'SYS-2' },
]);

const rewrite = (query: string) => rewriteKeyLiterals(query, mapping);

/** spec: 03-authoring-and-indexing.md §5 (propagation); RD-052. */
describe('rewriteKeyLiterals', () => {
  it('rewrites an equality against key', () => {
    expect(rewrite("key = 'FN-1'")).toEqual({ ok: true, query: "key = 'SYS-1'", changed: 1 });
  });

  it('rewrites an inequality', () => {
    expect(rewrite("key != 'FN-1'")).toEqual({ ok: true, query: "key != 'SYS-1'", changed: 1 });
  });

  it('rewrites every member of an IN list, and leaves the ones it does not know', () => {
    expect(rewrite("key IN ('FN-1', 'FN-9', 'FN-2')")).toEqual({
      ok: true,
      query: "key IN ('SYS-1', 'FN-9', 'SYS-2')",
      changed: 2,
    });
  });

  it('matches key case-insensitively, as the field itself does', () => {
    expect(rewrite("key = 'fn-1'")).toMatchObject({ ok: true, query: "key = 'SYS-1'" });
  });

  it('matches key_case_sensitive exactly, as the field itself does', () => {
    expect(rewrite("key_case_sensitive = 'FN-1'")).toMatchObject({ query: "key_case_sensitive = 'SYS-1'" });
    expect(rewrite("key_case_sensitive = 'fn-1'")).toEqual({
      ok: true,
      query: "key_case_sensitive = 'fn-1'",
      changed: 0,
    });
  });

  it('leaves a LIKE pattern alone: it is a question, not a reference', () => {
    expect(rewrite("key ~ 'FN-1'")).toEqual({ ok: true, query: "key ~ 'FN-1'", changed: 0 });
    expect(rewrite("key ~ 'FN-%'")).toEqual({ ok: true, query: "key ~ 'FN-%'", changed: 0 });
  });

  it('leaves the same text alone when it is not a key', () => {
    expect(rewrite("@Category = 'FN-1'")).toEqual({ ok: true, query: "@Category = 'FN-1'", changed: 0 });
    expect(rewrite("title = 'FN-1'")).toEqual({ ok: true, query: "title = 'FN-1'", changed: 0 });
  });

  it('rewrites inside a traversal and under a negation', () => {
    expect(rewrite("NOT (key = 'FN-1')")).toMatchObject({ query: "NOT (key = 'SYS-1')" });
    expect(rewrite("implements -> (key = 'FN-2')")).toMatchObject({ query: "implements -> (key = 'SYS-2')" });
  });

  it('keeps the author`s spacing, because it splices rather than re-prints', () => {
    const query = "key   =    'FN-1'   AND   @Category = 'Safety'";
    expect(rewrite(query)).toMatchObject({ query: "key   =    'SYS-1'   AND   @Category = 'Safety'" });
  });

  it('rewrites several literals in one query without disturbing the offsets', () => {
    expect(rewrite("key = 'FN-1' OR key = 'FN-2'")).toEqual({
      ok: true,
      query: "key = 'SYS-1' OR key = 'SYS-2'",
      changed: 2,
    });
  });

  it('reports a query it cannot parse rather than mangling it', () => {
    const result = rewrite("key = 'FN-1' AND AND");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.length).toBeGreaterThan(0);
  });

  it('returns the query untouched when nothing matches', () => {
    const query = "@Category = 'Safety'";
    expect(rewrite(query)).toEqual({ ok: true, query, changed: 0 });
  });
});
