/**
 * Key patterns and suggestion.
 * spec: 03-authoring-and-indexing.md §4.2 — a pattern such as `FN-###` where `#` runs
 * are the numeric part; research §2.3 for the advance-and-never-rewind rule.
 */
import { checkKey } from './validate';

export type KeyPattern = {
  source: string;
  prefix: string;
  /** Number of `#` characters; the numeric part is zero-padded to this width. */
  width: number;
  suffix: string;
};

export type PatternProblem = 'NO_PLACEHOLDER' | 'MULTIPLE_RUNS' | 'INVALID_EXAMPLE';

export type ParsedPattern = { ok: true; pattern: KeyPattern } | { ok: false; problem: PatternProblem; message: string };

export function parsePattern(source: string): ParsedPattern {
  const trimmed = source.trim();
  const runs = trimmed.match(/#+/g) ?? [];

  if (runs.length === 0) {
    return { ok: false, problem: 'NO_PLACEHOLDER', message: 'A key pattern needs a run of # for the number, e.g. FN-###.' };
  }
  if (runs.length > 1) {
    return { ok: false, problem: 'MULTIPLE_RUNS', message: 'A key pattern may contain only one run of #.' };
  }

  const run = runs[0]!;
  const start = trimmed.indexOf(run);
  const pattern: KeyPattern = {
    source: trimmed,
    prefix: trimmed.slice(0, start),
    width: run.length,
    suffix: trimmed.slice(start + run.length),
  };

  // A pattern that cannot produce a valid key is a configuration error, not a surprise
  // at insertion time (spec 03 §4.1).
  if (!checkKey(formatKey(pattern, 1)).ok) {
    return {
      ok: false,
      problem: 'INVALID_EXAMPLE',
      message: `A key pattern must produce valid keys; ${formatKey(pattern, 1)} is not one.`,
    };
  }

  return { ok: true, pattern };
}

export function formatKey(pattern: KeyPattern, sequence: number): string {
  return `${pattern.prefix}${String(sequence).padStart(pattern.width, '0')}${pattern.suffix}`;
}

/** The numeric part of a key under this pattern, or null when it does not match. */
export function numberOf(pattern: KeyPattern, key: string): number | null {
  const upperKey = key.toUpperCase();
  const prefix = pattern.prefix.toUpperCase();
  const suffix = pattern.suffix.toUpperCase();

  if (!upperKey.startsWith(prefix) || !upperKey.endsWith(suffix)) return null;

  const middle = upperKey.slice(prefix.length, upperKey.length - suffix.length || undefined);
  // A wider number than the pattern is still a match: FN-1000 belongs to FN-###, which is
  // what makes "highest existing number + 1" keep working past the padding width.
  if (middle.length === 0 || middle.length < pattern.width || !/^\d+$/.test(middle)) return null;

  return Number.parseInt(middle, 10);
}

export function matchesPattern(pattern: KeyPattern, key: string): boolean {
  return numberOf(pattern, key) !== null;
}

export type SuggestionInput = {
  pattern: KeyPattern;
  /** `RequirementType.nextSequence` — advances on use, never rewinds on delete. */
  nextSequence: number;
  /** Every key already seen under this pattern, live or deleted. */
  existingKeys: readonly string[];
};

/**
 * Next key = `max(nextSequence, highestExistingNumber + 1)`.
 * spec: 03-authoring-and-indexing.md §4.2 steps 2–3
 */
export function suggestNextKey(input: SuggestionInput): { key: string; sequence: number } {
  const sequence = Math.max(input.nextSequence, highestNumber(input.pattern, input.existingKeys) + 1, 1);
  return { key: formatKey(input.pattern, sequence), sequence };
}

export function highestNumber(pattern: KeyPattern, keys: readonly string[]): number {
  return keys.reduce((highest, key) => Math.max(highest, numberOf(pattern, key) ?? 0), 0);
}

/**
 * "Reset sequence" rewinds to `highestExistingNumber + 1`.
 * spec: 03 §4.2 step 4 — permitted only when `preventReusingDeletedKeys` is false.
 */
export function resetSequenceTo(pattern: KeyPattern, liveKeys: readonly string[]): number {
  return highestNumber(pattern, liveKeys) + 1;
}

/** spec: 03 §4.3 — with locking on, a key matching no configured pattern is refused. */
export function matchesAnyPattern(patterns: readonly string[], key: string): boolean {
  return patterns.some((source) => {
    const parsed = parsePattern(source);
    return parsed.ok && matchesPattern(parsed.pattern, key);
  });
}
