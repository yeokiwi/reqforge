/**
 * Field-level detail.
 * spec: 05-baselines-and-diff.md §5.2 step 5 — "word-level diff for title and body, set
 * diff for properties and dependencies".
 *
 * Presentation only: the verdict was already reached by `classifyPair`. Nothing here may
 * change whether a pair counts as modified, or the diff and `isModified()` would part.
 */

export type Segment = { kind: 'same' | 'removed' | 'added'; text: string };

/** Words, keeping the whitespace that follows each so a rejoin reproduces the input. */
function tokenise(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/**
 * A longest-common-subsequence word diff. The table is O(n·m); bodies are excerpts rather
 * than documents, and the cap below keeps a pathological pair from costing a page render.
 */
const MAX_TOKENS = 1_200;

export function wordDiff(before: string, after: string): Segment[] {
  const left = tokenise(before);
  const right = tokenise(after);

  if (left.length > MAX_TOKENS || right.length > MAX_TOKENS) {
    // Too large to align word by word; showing both sides whole is honest and cheap.
    return compact([
      { kind: 'removed', text: before },
      { kind: 'added', text: after },
    ]);
  }

  // lengths[i][j] = LCS length of left[i…] and right[j…].
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        left[i] === right[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const segments: Segment[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      segments.push({ kind: 'same', text: left[i]! });
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      segments.push({ kind: 'removed', text: left[i]! });
      i += 1;
    } else {
      segments.push({ kind: 'added', text: right[j]! });
      j += 1;
    }
  }
  while (i < left.length) segments.push({ kind: 'removed', text: left[i++]! });
  while (j < right.length) segments.push({ kind: 'added', text: right[j++]! });

  return compact(segments);
}

/** Runs of the same kind become one segment, so the rendering is not one span per word. */
function compact(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    if (segment.text.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.kind === segment.kind) last.text += segment.text;
    else out.push({ ...segment });
  }
  return out;
}

export type SetChange = { added: string[]; removed: string[]; kept: string[] };

/** spec 05 §5.2 step 5 — properties and dependencies compare as sets, not sequences. */
export function setDiff(before: readonly string[], after: readonly string[]): SetChange {
  const left = new Set(before);
  const right = new Set(after);

  return {
    added: [...right].filter((entry) => !left.has(entry)).sort(),
    removed: [...left].filter((entry) => !right.has(entry)).sort(),
    kept: [...left].filter((entry) => right.has(entry)).sort(),
  };
}

/** `name=value` lines, which is how a property set is shown beside its counterpart. */
export function propertyLines(
  properties: ReadonlyArray<{ searchName: string; value: string }>,
): string[] {
  return properties.map((property) => `${property.searchName}=${property.value}`);
}

export function dependencyLines(
  dependencies: ReadonlyArray<{ relationship: string; targetKey: string }>,
): string[] {
  return dependencies.map((edge) => `${edge.relationship} → ${edge.targetKey}`);
}
