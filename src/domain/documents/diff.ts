// Comparing two versions of a page (RD-060): side by side, with the top-level blocks that
// were added, removed or changed highlighted. Block identity is canonical-JSON equality,
// so the comparison is deterministic and cannot disagree with what is stored.

/**
 * JSON with object keys sorted (by UTF-16 code unit), so two values that differ only in key
 * order serialise identically. Otherwise follows JSON.stringify — `toJSON` is honoured,
 * `undefined`/functions/symbols are dropped from objects and become `null` in arrays,
 * non-finite numbers become `null` — except that it never throws: a bigint is written as
 * its decimal digits and a circular reference as `null`.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (block identity is canonical-JSON equality)
export function canonicalJson(value: unknown): string {
  return serialise(value, new Set()) ?? "null";
}

function serialise(input: unknown, stack: Set<object>): string | undefined {
  let value = input;
  if (typeof value === "object" && value !== null && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    value = (value as { toJSON: () => unknown }).toJSON();
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }
  if (value === null) return "null";
  const obj = value as object;
  if (stack.has(obj)) return "null";
  stack.add(obj);
  let out: string;
  if (Array.isArray(obj)) {
    out = `[${obj.map((item: unknown) => serialise(item, stack) ?? "null").join(",")}]`;
  } else {
    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const s = serialise(record[key], stack);
      if (s !== undefined) parts.push(`${JSON.stringify(key)}:${s}`);
    }
    out = `{${parts.join(",")}}`;
  }
  stack.delete(obj);
  return out;
}

export type BlockDiffStatus = "same" | "added" | "removed" | "changed";

/**
 * One row of a comparison. `same` and `changed` rows carry both sides; `removed` only the
 * left, `added` only the right. Blocks are the documents' own top-level nodes, untouched.
 */
export type BlockDiff =
  | { status: "same" | "changed"; left: unknown; right: unknown; leftIndex: number; rightIndex: number }
  | { status: "removed"; left: unknown; leftIndex: number; right?: undefined; rightIndex?: undefined }
  | { status: "added"; right: unknown; rightIndex: number; left?: undefined; leftIndex?: undefined };

/**
 * The top-level blocks of a ProseMirror document JSON: its `content` array. Anything
 * malformed — not an object, an array, no `content`, `content` not an array — is an empty
 * document.
 */
export function topLevelBlocks(doc: unknown): unknown[] {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return [];
  const content = (doc as { content?: unknown }).content;
  return Array.isArray(content) ? [...(content as unknown[])] : [];
}

/**
 * Compares the top-level blocks of two documents. Blocks are aligned by a longest common
 * subsequence under canonicalJson equality (see alignSequences); in each gap between
 * aligned blocks the i-th removed block is paired with the i-th added block as `changed`,
 * and the surplus on one side is `removed` or `added`. Reading the rows in order, the left
 * sides are exactly `a`'s blocks in order and the right sides `b`'s. Pure and deterministic.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Compare selected versions)
export function diffDocuments(a: unknown, b: unknown): BlockDiff[] {
  const left = topLevelBlocks(a);
  const right = topLevelBlocks(b);
  const matches = alignSequences(left.map(canonicalJson), right.map(canonicalJson));

  const out: BlockDiff[] = [];
  let i = 0;
  let j = 0;
  const flushGap = (iEnd: number, jEnd: number) => {
    while (i < iEnd && j < jEnd) {
      out.push({ status: "changed", left: left[i], right: right[j], leftIndex: i, rightIndex: j });
      i++;
      j++;
    }
    for (; i < iEnd; i++) out.push({ status: "removed", left: left[i], leftIndex: i });
    for (; j < jEnd; j++) out.push({ status: "added", right: right[j], rightIndex: j });
  };
  for (const [mi, mj] of matches) {
    flushGap(mi, mj);
    out.push({ status: "same", left: left[mi], right: right[mj], leftIndex: mi, rightIndex: mj });
    i = mi + 1;
    j = mj + 1;
  }
  flushGap(left.length, right.length);
  return out;
}

export interface AlignOptions {
  /**
   * Largest (n+1)·(m+1) table the exact LCS may build for one unresolved region. Beyond it
   * the region is split on blocks that occur exactly once on each side (patience anchors)
   * and each piece is retried. Default 4,194,304 cells (8 MiB).
   */
  cellBudget?: number;
  /**
   * Total work allowed across all regions: a region is charged one unit per item it scans,
   * one per item it considers for anchors, and one per table cell. A region that would
   * overrun what is left keeps its matched common prefix and suffix (linear in total) and is
   * otherwise left unaligned. Without this cap, splitting can peel one anchor per pass off an
   * almost unchanged region and take quadratic time. Default 16,777,216.
   */
  workBudget?: number;
}

const DEFAULT_CELL_BUDGET = 4_194_304;
const DEFAULT_WORK_BUDGET = 16_777_216;

/**
 * Matched index pairs [i, j] with left[i] === right[j] (SameValueZero), strictly
 * increasing in both coordinates. Exact longest common subsequence whenever the region
 * left after trimming the common prefix and suffix, and dropping items absent from the
 * other side, fits the cell budget and the whole run fits the work budget. That holds for
 * any realistic page comparison. Past either budget the result is still a valid common
 * subsequence, built from patience anchors or left with gaps, but it may not be the
 * longest. Run time is O((n + m) log(n + m) + workBudget) whatever the input. Deterministic.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (changed top-level blocks highlighted)
export function alignSequences<K>(
  left: readonly K[],
  right: readonly K[],
  options: AlignOptions = {},
): Array<[number, number]> {
  const budget = options.cellBudget ?? DEFAULT_CELL_BUDGET;
  let workLeft = options.workBudget ?? DEFAULT_WORK_BUDGET;
  /** Spends `cost` if it fits in what is left of the work budget. */
  const charge = (cost: number) => {
    if (cost > workLeft) return false;
    workLeft -= cost;
    return true;
  };
  const ids = new Map<K, number>();
  const intern = (k: K) => {
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size;
      ids.set(k, id);
    }
    return id;
  };
  const x = left.map(intern);
  const y = right.map(intern);
  // Scratch indexed by item id, shared by every pass. A pass marks with its own stamp, so
  // nothing is cleared or reallocated between passes and each charged unit of work stays a
  // few array reads: the work budget then bounds time, not just steps.
  const inX = new Uint32Array(ids.size);
  const inY = new Uint32Array(ids.size);
  const scratch: AnchorScratch = {
    countX: new Uint32Array(ids.size),
    countY: new Uint32Array(ids.size),
    posY: new Uint32Array(ids.size),
  };
  let stamp = 0;

  const matches: Array<[number, number]> = [];
  const work: Array<[number, number, number, number]> = [[0, x.length, 0, y.length]];
  while (work.length > 0) {
    const [xs0, xe0, ys0, ye0] = work.pop() as [number, number, number, number];
    let xs = xs0;
    let xe = xe0;
    let ys = ys0;
    let ye = ye0;
    while (xs < xe && ys < ye && x[xs] === y[ys]) matches.push([xs++, ys++]);
    while (xs < xe && ys < ye && x[xe - 1] === y[ye - 1]) matches.push([--xe, --ye]);
    if (xs === xe || ys === ye) continue;
    if (!charge(xe - xs + (ye - ys))) continue; // out of work: leave this region unaligned

    // Only items present on both sides can be matched; the rest are gaps whatever happens.
    stamp++;
    for (let q = ys; q < ye; q++) inY[y[q] as number] = stamp;
    for (let p = xs; p < xe; p++) inX[x[p] as number] = stamp;
    const xi: number[] = [];
    for (let p = xs; p < xe; p++) if (inY[x[p] as number] === stamp) xi.push(p);
    const yi: number[] = [];
    for (let q = ys; q < ye; q++) if (inX[y[q] as number] === stamp) yi.push(q);
    if (xi.length === 0 || yi.length === 0) continue;

    const cells = (xi.length + 1) * (yi.length + 1);
    if (cells <= budget && charge(cells)) {
      for (const m of lcsTable(xi, yi, x, y)) matches.push(m);
      continue;
    }

    if (!charge(xi.length + yi.length)) continue;
    const anchors = patienceAnchors(xi, yi, x, y, scratch);
    if (anchors.length === 0) continue; // over budget and nothing unique to split on: leave unaligned
    let px = xs;
    let py = ys;
    for (const [ax, ay] of anchors) {
      matches.push([ax, ay]);
      work.push([px, ax, py, ay]);
      px = ax + 1;
      py = ay + 1;
    }
    work.push([px, xe, py, ye]);
  }
  return matches.sort((m1, m2) => m1[0] - m2[0]);
}

/** Exact LCS over the filtered positions, by a suffix-length table and a forward walk. */
function lcsTable(xi: readonly number[], yi: readonly number[], x: readonly number[], y: readonly number[]): Array<[number, number]> {
  const n = xi.length;
  const m = yi.length;
  const w = m + 1;
  const table = Math.min(n, m) < 0xffff ? new Uint16Array((n + 1) * w) : new Uint32Array((n + 1) * w);
  const at = (i: number) => x[xi[i] as number] as number;
  const bt = (j: number) => y[yi[j] as number] as number;
  for (let i = n - 1; i >= 0; i--) {
    const ai = at(i);
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] =
        ai === bt(j)
          ? (table[(i + 1) * w + j + 1] as number) + 1
          : Math.max(table[(i + 1) * w + j] as number, table[i * w + j + 1] as number);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (at(i) === bt(j)) {
      out.push([xi[i] as number, yi[j] as number]);
      i++;
      j++;
    } else if ((table[(i + 1) * w + j] as number) >= (table[i * w + j + 1] as number)) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/** Per-id counters for patienceAnchors, sized to the number of distinct items and reused. */
interface AnchorScratch {
  countX: Uint32Array;
  countY: Uint32Array;
  posY: Uint32Array;
}

/**
 * Items occurring exactly once on each side, kept in the longest run increasing on both
 * sides (patience diff). Positions are distinct, so the result has no ties to break.
 * O(xi + yi + k log k) for k candidate pairs; only the counters of ids in this region are
 * touched.
 */
function patienceAnchors(
  xi: readonly number[],
  yi: readonly number[],
  x: readonly number[],
  y: readonly number[],
  { countX, countY, posY }: AnchorScratch,
): Array<[number, number]> {
  for (const p of xi) countX[x[p] as number] = 0;
  for (const q of yi) countY[y[q] as number] = 0;
  for (const p of xi) {
    const id = x[p] as number;
    countX[id] = (countX[id] as number) + 1;
  }
  for (const q of yi) {
    const id = y[q] as number;
    countY[id] = (countY[id] as number) + 1;
    posY[id] = q;
  }
  const pairs: Array<[number, number]> = [];
  for (const p of xi) {
    const id = x[p] as number;
    if (countX[id] === 1 && countY[id] === 1) pairs.push([p, posY[id] as number]);
  }
  // Longest strictly increasing subsequence of the right positions (pairs are in left order).
  const tails: number[] = [];
  const prev: number[] = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, q], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((pairs[tails[mid] as number] as [number, number])[1] < q) lo = mid + 1;
      else hi = mid;
    }
    prev[k] = lo > 0 ? (tails[lo - 1] as number) : -1;
    tails[lo] = k;
  });
  const out: Array<[number, number]> = [];
  for (let k = tails.length > 0 ? (tails[tails.length - 1] as number) : -1; k !== -1; k = prev[k] as number) {
    out.push(pairs[k] as [number, number]);
  }
  return out.reverse();
}
