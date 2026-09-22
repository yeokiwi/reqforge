/**
 * Renaming: the prefix/middle/suffix decomposition and the plan a rename job executes.
 * Pure — no database, no ProseMirror. spec: 03-authoring-and-indexing.md §5.
 *
 * Requirement Yogi's batch rename (research §2.8) decomposes the selected keys into a
 * prefix common to all of them, a variable middle, and a common suffix. The user edits
 * only the first line; every other line follows with the same transformation.
 */
import { checkKey, upperKey } from './validate';
import { matchesAnyPattern } from './pattern';

/** RD-054 — one transaction is the spec's requirement; an unbounded one is an outage. */
export const RENAME_MAX_REQUIREMENTS = 2_000;
export const RENAME_MAX_DOCUMENTS = 1_000;

export type Decomposition = {
  prefix: string;
  /** One per input key, in the same order. Never empty — see `decompose`. */
  middles: string[];
  suffix: string;
};

function commonPrefix(values: readonly string[]): string {
  if (values.length === 0) return '';
  let result = values[0]!;
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < result.length && index < value.length && result[index] === value[index]) index += 1;
    result = result.slice(0, index);
  }
  return result;
}

function commonSuffix(values: readonly string[]): string {
  if (values.length === 0) return '';
  let result = values[0]!;
  for (const value of values.slice(1)) {
    let index = 0;
    while (
      index < result.length &&
      index < value.length &&
      result[result.length - 1 - index] === value[value.length - 1 - index]
    ) {
      index += 1;
    }
    result = result.slice(result.length - index);
  }
  return result;
}

/**
 * Splits the selection into `prefix + middle + suffix`.
 *
 * Every middle is non-empty by construction: the common prefix and suffix are shortened
 * until they are, because an empty middle would leave `applyTransform` with nothing to
 * anchor the edited first line on. `FN-1` and `FN-12` therefore decompose as
 * `FN-` + {`1`, `12`} + `` rather than `FN-1` + {``, `2`} + ``.
 *
 * spec: 03-authoring-and-indexing.md §5 (batch rename)
 */
export function decompose(keys: readonly string[]): Decomposition {
  if (keys.length === 0) return { prefix: '', middles: [], suffix: '' };
  if (keys.length === 1) return { prefix: '', middles: [keys[0]!], suffix: '' };

  let prefix = commonPrefix(keys);
  let suffix = commonSuffix(keys.map((key) => key.slice(prefix.length)));

  const middlesFor = (p: string, s: string): string[] =>
    keys.map((key) => key.slice(p.length, key.length - s.length));

  while (middlesFor(prefix, suffix).some((middle) => middle.length === 0)) {
    if (suffix.length > 0) suffix = suffix.slice(1);
    else if (prefix.length > 0) prefix = prefix.slice(0, -1);
    else break;
  }

  return { prefix, middles: middlesFor(prefix, suffix), suffix };
}

export type Transform =
  | { anchored: true; prefix: string; suffix: string; keys: string[] }
  | { anchored: false; middle: string; message: string };

/**
 * Applies the first line's edit to every other line.
 *
 * The edited text is read as `newPrefix + middle + newSuffix`, where `middle` is the first
 * key's variable part. Where the middle occurs more than once — editing `FN-1-1` to
 * `SYS-1-1` — the occurrence nearest its original position wins, so the transformation is
 * the one the reader is looking at rather than the leftmost match.
 *
 * spec: 03-authoring-and-indexing.md §5 (the rest transform live)
 */
export function applyTransform(edited: string, decomposition: Decomposition): Transform {
  const { middles, prefix } = decomposition;
  const middle = middles[0];
  if (middle === undefined) return { anchored: true, prefix: '', suffix: '', keys: [] };

  const positions: number[] = [];
  for (let index = edited.indexOf(middle); index !== -1; index = edited.indexOf(middle, index + 1)) {
    positions.push(index);
  }

  if (positions.length === 0) {
    return {
      anchored: false,
      middle,
      message: `The other lines can only follow while the first one still contains its variable part, “${middle}”. Rename this one on its own, or change the selection.`,
    };
  }

  const chosen = positions.reduce((best, index) =>
    Math.abs(index - prefix.length) < Math.abs(best - prefix.length) ? index : best,
  );

  const newPrefix = edited.slice(0, chosen);
  const newSuffix = edited.slice(chosen + middle.length);
  return {
    anchored: true,
    prefix: newPrefix,
    suffix: newSuffix,
    keys: middles.map((part) => `${newPrefix}${part}${newSuffix}`),
  };
}

export type RenameProblem =
  | 'INVALID_KEY'
  | 'PATTERN_MISMATCH'
  | 'DUPLICATE_TARGET'
  | 'UNCHANGED';

export type RenameRow = {
  from: string;
  to: string;
  /** Absent when the row is fine to run. */
  problem?: RenameProblem;
  message?: string;
};

export type RenamePlan = {
  rows: RenameRow[];
  /** The rows a job would actually execute — every row without a problem. */
  pairs: Array<{ from: string; to: string }>;
  problems: number;
};

export type PlanInput = {
  pairs: ReadonlyArray<{ from: string; to: string }>;
  /** The space's locked key patterns, empty when the space is not locked (spec 03 §4.3). */
  lockedPatterns?: readonly string[];
  limit?: number;
};

/**
 * Validates a whole batch before anything is written: an invalid target, a target the
 * space's locked patterns forbid, and two rows racing for the same key are all caught
 * here rather than half-way through the transaction.
 *
 * spec: 03-authoring-and-indexing.md §5 (validate, run); §4.3 (locked patterns)
 */
export function planRename(input: PlanInput): RenamePlan {
  const patterns = input.lockedPatterns ?? [];
  const seen = new Map<string, number>();
  for (const pair of input.pairs) {
    const upper = upperKey(pair.to.trim());
    seen.set(upper, (seen.get(upper) ?? 0) + 1);
  }

  const rows: RenameRow[] = input.pairs.map(({ from, to }) => {
    const target = to.trim();

    if (upperKey(target) === upperKey(from) && target === from) {
      return { from, to: target, problem: 'UNCHANGED' as const, message: 'This key is already what it would be renamed to.' };
    }

    const checked = checkKey(target);
    if (!checked.ok) {
      return { from, to: target, problem: 'INVALID_KEY' as const, message: checked.message };
    }

    if (patterns.length > 0 && !matchesAnyPattern(patterns, checked.key)) {
      return {
        from,
        to: checked.key,
        problem: 'PATTERN_MISMATCH' as const,
        message: `This space only accepts keys matching ${patterns.join(', ')}.`,
      };
    }

    if ((seen.get(checked.upperKey) ?? 0) > 1) {
      return {
        from,
        to: checked.key,
        problem: 'DUPLICATE_TARGET' as const,
        message: 'Two of the selected requirements would end up with this key.',
      };
    }

    return { from, to: checked.key };
  });

  return {
    rows,
    pairs: rows.filter((row) => row.problem === undefined).map((row) => ({ from: row.from, to: row.to })),
    problems: rows.filter((row) => row.problem !== undefined).length,
  };
}

export const PREVIEW_LIMIT = 50;

/** spec: 03-authoring-and-indexing.md §5 — "at most 50 with a count of the remainder". */
export function previewRows(plan: RenamePlan, limit = PREVIEW_LIMIT): { rows: RenameRow[]; remainder: number } {
  return { rows: plan.rows.slice(0, limit), remainder: Math.max(plan.rows.length - limit, 0) };
}

/**
 * A rename as the two lookups its consumers need: case-insensitive, which is how a
 * requirement key is compared everywhere (`RD-001`), and exact, for the one field that is
 * deliberately case-sensitive.
 */
export type KeyMapping = {
  /** upper-cased old key → new key, as written. */
  byUpper: ReadonlyMap<string, string>;
  /** old key exactly as written → new key. */
  exact: ReadonlyMap<string, string>;
};

export function buildMapping(pairs: ReadonlyArray<{ from: string; to: string }>): KeyMapping {
  const byUpper = new Map<string, string>();
  const exact = new Map<string, string>();
  for (const { from, to } of pairs) {
    byUpper.set(upperKey(from), to);
    exact.set(from, to);
  }
  return { byUpper, exact };
}
