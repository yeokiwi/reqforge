/**
 * Planning a freeze: which requirements are members, and which of their dependencies
 * survive into the snapshot.
 * spec: 05-baselines-and-diff.md §3.2 steps 1, 2 and 5
 *
 * Pure. The caller resolves the query and loads the edges; everything here is set work,
 * so "what would this freeze contain?" is answerable without a database.
 */

/** One dependency edge, by key, in invariant P1's direction: child → parent. */
export type Edge = { childKey: string; parentKey: string; relationship: string };

/** spec 05 §3.2 step 2 — the closure is bounded, because a dependency graph has cycles. */
export const MAX_CLOSURE_DEPTH = 10;

/** spec 07 §4 — requirements per baseline. */
export const MAX_MEMBERS = 12_000;

export type Closure = {
  /** Every member key, in stable order: the seeds as given, then what each hop added. */
  keys: string[];
  /** How many keys the closure added beyond the seeds — the freeze summary reports it. */
  added: number;
  /** True when the walk stopped at the depth cap rather than at a fixed point. */
  truncated: boolean;
};

/**
 * Adds the parents of every member, transitively, to a fixed point or the depth cap.
 * spec 05 §3.2 step 2 — "repeat until fixed point or depth 10".
 *
 * A cycle terminates at the cap rather than spinning, the same guarantee `RD-021` gives
 * traversal in the query engine.
 */
export function closeOverParents(
  seeds: readonly string[],
  edges: readonly Edge[],
  options: { maxDepth?: number } = {},
): Closure {
  const maxDepth = options.maxDepth ?? MAX_CLOSURE_DEPTH;
  const parentsOf = new Map<string, string[]>();
  for (const edge of edges) {
    parentsOf.set(edge.childKey, [...(parentsOf.get(edge.childKey) ?? []), edge.parentKey]);
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    seen.add(seed);
    keys.push(seed);
  }

  let frontier = [...keys];
  let depth = 0;
  let truncated = false;

  while (frontier.length > 0) {
    if (depth >= maxDepth) {
      // Something was still reachable when the cap was hit, so the closure is partial
      // and the freeze summary says so.
      truncated = frontier.some((key) => (parentsOf.get(key) ?? []).some((parent) => !seen.has(parent)));
      break;
    }

    const next: string[] = [];
    for (const key of frontier) {
      for (const parent of parentsOf.get(key) ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        keys.push(parent);
        next.push(parent);
      }
    }
    frontier = next;
    depth += 1;
  }

  return { keys, added: keys.length - seeds.filter((seed, index) => seeds.indexOf(seed) === index).length, truncated };
}

export type Partitioned = {
  /** Edges whose child *and* parent are both members — copied into the baseline. */
  internal: Edge[];
  /**
   * Edges pointing outside the member set. Recorded rather than dropped, so the diff can
   * explain them later (spec 05 §3.2 step 5, §3.3).
   */
  dangling: Edge[];
};

/** spec 05 §3.2 step 5 — "dependencies pointing outside the baseline are recorded". */
export function partitionDependencies(edges: readonly Edge[], memberKeys: readonly string[]): Partitioned {
  const members = new Set(memberKeys);
  const internal: Edge[] = [];
  const dangling: Edge[] = [];

  for (const edge of edges) {
    // Only an edge *from* a member is this baseline's business: an edge from a
    // non-member into a member belongs to whatever contains that non-member.
    if (!members.has(edge.childKey)) continue;
    if (members.has(edge.parentKey)) internal.push(edge);
    else dangling.push(edge);
  }

  return { internal, dangling };
}

export type FreezeRefusal = {
  ok: false;
  message: string;
  /** Set when the refusal is the baseline-size limit (spec 07 §4), so it can be named. */
  overLimit?: { limit: number; actual: number };
};
export type FreezeCheck = { ok: true; count: number } | FreezeRefusal;

/**
 * spec 05 §3.2 step 1 — "refuse if empty; refuse above the space's requirement limit".
 * The limit is named in the message, as spec 07 §4 requires of every hard limit.
 */
export function checkFreezeable(memberKeys: readonly string[], limit = MAX_MEMBERS): FreezeCheck {
  if (memberKeys.length === 0) {
    return {
      ok: false,
      message: 'That query selects no requirements. A baseline of nothing cannot be frozen.',
    };
  }
  if (memberKeys.length > limit) {
    // Member resolution stops at limit + 1, so "more than" is all that is known — and all
    // that matters.
    return {
      ok: false,
      message: `That query selects more than ${limit} requirements; a baseline may hold at most ${limit}.`,
      overLimit: { limit, actual: memberKeys.length },
    };
  }
  return { ok: true, count: memberKeys.length };
}
