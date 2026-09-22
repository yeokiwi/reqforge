import {
  comparableBody,
  comparableDependencies,
  comparableProperties,
  type ComparableRow,
} from './normalise';
import type { CompareSet, DiffClass, IgnoreSet } from './options';

/**
 * Classifying one pair, and pairing two sides.
 * spec: 05-baselines-and-diff.md §5.2 — "resolve both sides to maps keyed by requirement
 * **key** (not id — the whole point is comparing across snapshots)".
 *
 * This is the single definition of "modified". `isModified()` compiles to the same
 * comparison over the same stored columns (`RD-047`), and a property-based test asserts
 * the two never disagree.
 */

/** Which enabled fields differ. Empty means the pair is unchanged. */
export type ChangedField = 'title' | 'body' | 'inlineProperties' | 'externalProperties' | 'dependencies';

export type PairVerdict = { kind: DiffClass; changed: ChangedField[] };

export function classifyPair(
  left: ComparableRow | undefined,
  right: ComparableRow | undefined,
  compare: CompareSet,
  ignore: IgnoreSet,
): PairVerdict {
  if (!left && !right) return { kind: 'unchanged', changed: [] };
  if (!left) return { kind: 'added', changed: [] };
  if (!right) return { kind: 'removed', changed: [] };

  const changed: ChangedField[] = [];

  if (compare.title && left.title !== right.title) changed.push('title');
  if (compare.body && comparableBody(left, ignore) !== comparableBody(right, ignore)) changed.push('body');
  if (
    compare.inlineProperties &&
    comparableProperties(left.inlineProperties) !== comparableProperties(right.inlineProperties)
  ) {
    changed.push('inlineProperties');
  }
  if (
    compare.externalProperties &&
    comparableProperties(left.externalProperties) !== comparableProperties(right.externalProperties)
  ) {
    changed.push('externalProperties');
  }
  if (
    compare.dependencies &&
    comparableDependencies(left.dependencies) !== comparableDependencies(right.dependencies)
  ) {
    changed.push('dependencies');
  }

  return { kind: changed.length > 0 ? 'modified' : 'unchanged', changed };
}

export type DiffRow = {
  key: string;
  kind: DiffClass;
  changed: ChangedField[];
  left: ComparableRow | undefined;
  right: ComparableRow | undefined;
};

export type DiffSummary = Record<DiffClass, number>;

export type DiffOutcome = { rows: DiffRow[]; summary: DiffSummary; total: number };

/**
 * Pairs two result sets by key and classifies every pair.
 * `added` is right-only and `removed` is left-only (spec 05 §5.2 step 2), so the left
 * side is "before" and the right side is "after" — which is why the baseline pages
 * pre-fill the older baseline on the left.
 */
export function diffSides(
  leftRows: readonly ComparableRow[],
  rightRows: readonly ComparableRow[],
  compare: CompareSet,
  ignore: IgnoreSet,
  filter: readonly DiffClass[],
  limit: number,
): DiffOutcome {
  const left = new Map(leftRows.map((row) => [row.key.toUpperCase(), row]));
  const right = new Map(rightRows.map((row) => [row.key.toUpperCase(), row]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();

  const summary: DiffSummary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const wanted = new Set(filter);
  const rows: DiffRow[] = [];
  let total = 0;

  for (const key of keys) {
    const before = left.get(key);
    const after = right.get(key);
    const verdict = classifyPair(before, after, compare, ignore);
    summary[verdict.kind] += 1;

    if (!wanted.has(verdict.kind)) continue;
    total += 1;
    // The summary counts every pair; `rows` stops at the limit, so a truncated page still
    // reports the true totals (spec 05 §5.4).
    if (rows.length < limit) {
      rows.push({
        key: (after ?? before)!.key,
        kind: verdict.kind,
        changed: verdict.changed,
        left: before,
        right: after,
      });
    }
  }

  return { rows, summary, total };
}

/** The keys a diff calls `modified` — what `isModified()` must return for the same pair. */
export function modifiedKeys(outcome: DiffOutcome): string[] {
  return outcome.rows
    .filter((row) => row.kind === 'modified')
    .map((row) => row.key.toUpperCase())
    .sort();
}
