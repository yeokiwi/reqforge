/**
 * Rewriting requirement keys inside a saved query.
 * Pure: parses, locates by the grammar, and splices by offset. No database.
 *
 * spec: 03-authoring-and-indexing.md §5 — "every saved matrix query that references the
 * key literally". `RD-052`: located by the AST so that a key appearing in a title filter
 * or a property value is never touched, and spliced into the original text so the
 * author's spacing survives. `key ~ 'FN-%'` is a pattern rather than a reference and is
 * deliberately left alone.
 */
import type { KeyMapping } from '@/domain/keys/rename';
import { walkExpr, type Expr, type Value } from './ast';
import { RqlSyntaxError } from './errors';
import { parse } from './parser';

const KEY_FIELDS = new Set(['key', 'key_case_sensitive']);

export type RewriteResult =
  | { ok: true; query: string; changed: number }
  | { ok: false; reason: string };

function quote(key: string): string {
  return `'${key.replace(/'/g, "\\'")}'`;
}

function replacementFor(field: string, value: Value, mapping: KeyMapping): string | null {
  if (value.kind !== 'string') return null;
  const next =
    field === 'key_case_sensitive'
      ? mapping.exact.get(value.value)
      : mapping.byUpper.get(value.value.toUpperCase());
  return next === undefined ? null : quote(next);
}

/** Every literal key reference in the query, as a span and its replacement text. */
function edits(expr: Expr, mapping: KeyMapping): Array<{ offset: number; length: number; text: string }> {
  const found: Array<{ offset: number; length: number; text: string }> = [];

  for (const node of walkExpr(expr)) {
    if (node.kind === 'comparison') {
      // `~` and `NOT LIKE` take a pattern, not a key: `key ~ 'FN-%'` still means "every
      // key starting FN-" after the rename, and rewriting it would change the question.
      if (node.operator !== '=' && node.operator !== '!=') continue;
      if (!KEY_FIELDS.has(node.field.name)) continue;
      const text = replacementFor(node.field.name, node.value, mapping);
      if (text !== null) found.push({ offset: node.value.offset, length: node.value.length, text });
      continue;
    }

    if (node.kind === 'inTest' && KEY_FIELDS.has(node.field.name)) {
      for (const value of node.values) {
        const text = replacementFor(node.field.name, value, mapping);
        if (text !== null) found.push({ offset: value.offset, length: value.length, text });
      }
    }
  }

  return found;
}

/**
 * Returns the query with every literal key reference replaced, or a reason it was left
 * alone. A saved query that no longer parses is reported rather than mangled: a blind
 * textual substitution is exactly what this function exists to avoid.
 *
 * spec: 03-authoring-and-indexing.md §5 (propagation)
 */
export function rewriteKeyLiterals(query: string, mapping: KeyMapping): RewriteResult {
  let expr: Expr;
  try {
    expr = parse(query);
  } catch (error) {
    if (error instanceof RqlSyntaxError) return { ok: false, reason: error.diagnostic.message };
    throw error;
  }

  const found = edits(expr, mapping);
  if (found.length === 0) return { ok: true, query, changed: 0 };

  // Right to left, so an earlier edit never moves a later offset.
  let next = query;
  for (const edit of [...found].sort((a, b) => b.offset - a.offset)) {
    next = next.slice(0, edit.offset) + edit.text + next.slice(edit.offset + edit.length);
  }

  return { ok: true, query: next, changed: found.length };
}
