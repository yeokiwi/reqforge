/**
 * What a diff compares, and what it ignores.
 * spec: 05-baselines-and-diff.md §5.1 — the request is **two queries**, not two
 * baselines: "selecting two baselines merely pre-fills them" (research §5.5), which is
 * what makes "diff a subset" free.
 */

export type CompareSet = {
  title: boolean;
  body: boolean;
  inlineProperties: boolean;
  externalProperties: boolean;
  dependencies: boolean;
};

export type IgnoreSet = {
  formatting: boolean;
  images: boolean;
  hyperlinks: boolean;
};

export type DiffClass = 'added' | 'removed' | 'modified' | 'unchanged';

export type DiffRequest = {
  left: string;
  right: string;
  compare: CompareSet;
  ignore: IgnoreSet;
  filter: DiffClass[];
  limit: number;
};

/**
 * spec 05 §5.1 — the documented defaults. `RD-013` names this set as the one
 * `isModified()` uses, which is why it lives here rather than in the screen.
 */
export const DEFAULT_COMPARE: CompareSet = {
  title: true,
  body: true,
  inlineProperties: true,
  externalProperties: false,
  dependencies: false,
};

export const DEFAULT_IGNORE: IgnoreSet = {
  formatting: true,
  images: true,
  hyperlinks: true,
};

export const ALL_CLASSES: readonly DiffClass[] = ['added', 'removed', 'modified', 'unchanged'];

/** spec 07 §4 — diff rows, interactive. Beyond `EXPORT_REQUIRED` the UI refuses (05 §5.4). */
export const DEFAULT_LIMIT = 600;
export const EXPORT_REQUIRED_ABOVE = 2_000;

/**
 * True when the request asks for exactly the field set `isModified()` is defined over
 * (`RD-013`, `RD-047`). The screen shows a note when it is, because that is the case in
 * which the diff and the search predicate are guaranteed to agree.
 */
export function isDefaultFieldSet(compare: CompareSet, ignore: IgnoreSet): boolean {
  return (
    compare.title === DEFAULT_COMPARE.title &&
    compare.body === DEFAULT_COMPARE.body &&
    compare.inlineProperties === DEFAULT_COMPARE.inlineProperties &&
    compare.externalProperties === DEFAULT_COMPARE.externalProperties &&
    compare.dependencies === DEFAULT_COMPARE.dependencies &&
    ignore.formatting === DEFAULT_IGNORE.formatting &&
    ignore.images === DEFAULT_IGNORE.images &&
    ignore.hyperlinks === DEFAULT_IGNORE.hyperlinks
  );
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'on') return true;
  if (value === 'false') return false;
  return fallback;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Narrows an untrusted request, as `parseMatrixConfig` does for the matrix. */
export function parseDiffRequest(value: unknown): DiffRequest {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const compare = (record.compare ?? {}) as Record<string, unknown>;
  const ignore = (record.ignore ?? {}) as Record<string, unknown>;

  const filter = Array.isArray(record.filter)
    ? ALL_CLASSES.filter((candidate) => record.filter && (record.filter as unknown[]).includes(candidate))
    : [...ALL_CLASSES];

  const limit =
    typeof record.limit === 'number' && Number.isFinite(record.limit)
      ? Math.min(Math.max(Math.trunc(record.limit), 1), EXPORT_REQUIRED_ABOVE)
      : DEFAULT_LIMIT;

  return {
    left: asString(record.left),
    right: asString(record.right),
    compare: {
      title: asBoolean(compare.title, DEFAULT_COMPARE.title),
      body: asBoolean(compare.body, DEFAULT_COMPARE.body),
      inlineProperties: asBoolean(compare.inlineProperties, DEFAULT_COMPARE.inlineProperties),
      externalProperties: asBoolean(compare.externalProperties, DEFAULT_COMPARE.externalProperties),
      dependencies: asBoolean(compare.dependencies, DEFAULT_COMPARE.dependencies),
    },
    ignore: {
      formatting: asBoolean(ignore.formatting, DEFAULT_IGNORE.formatting),
      images: asBoolean(ignore.images, DEFAULT_IGNORE.images),
      hyperlinks: asBoolean(ignore.hyperlinks, DEFAULT_IGNORE.hyperlinks),
    },
    filter: filter.length > 0 ? filter : [...ALL_CLASSES],
    limit,
  };
}
