import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BlockDiff,
  alignReport,
  alignSequences,
  canonicalJson,
  diffDocuments,
  diffDocumentsReport,
  topLevelBlocks,
} from "@/domain/documents";

// RD-060: compare shows both versions with changed top-level blocks highlighted (added,
// removed, changed). Block identity is canonical-JSON equality.

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (text: string, level = 1) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const doc = (...blocks: unknown[]) => ({ type: "doc", content: blocks });

const statuses = (rows: BlockDiff[]) => rows.map((r) => r.status);

describe("canonicalJson", () => {
  it("sorts object keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it("makes key order irrelevant", () => {
    expect(canonicalJson({ type: "heading", attrs: { level: 2 } })).toBe(canonicalJson({ attrs: { level: 2 }, type: "heading" }));
  });

  it("follows JSON.stringify for undefined, non-finite numbers and toJSON", () => {
    expect(canonicalJson({ a: undefined, b: [undefined, Number.NaN, Number.POSITIVE_INFINITY], c: -0 })).toBe('{"b":[null,null,null],"c":0}');
    expect(canonicalJson({ toJSON: () => ({ y: 1, x: 2 }) })).toBe('{"x":2,"y":1}');
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson("é\n")).toBe(JSON.stringify("é\n"));
  });

  it("never throws: bigint as digits, a circular reference as null", () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(canonicalJson({ n: 12n })).toBe('{"n":12}');
    expect(canonicalJson(loop)).toBe('{"a":1,"self":null}');
  });

  it("agrees with JSON.stringify on plain JSON with sorted keys", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(JSON.parse(canonicalJson(v))).toEqual(JSON.parse(JSON.stringify(v)));
      }),
    );
  });
});

describe("topLevelBlocks", () => {
  it.each([
    ["null", null],
    ["a string", "doc"],
    ["a number", 3],
    ["an array", [p("x")]],
    ["an object without content", { type: "doc" }],
    ["content that is not an array", { type: "doc", content: "x" }],
  ])("treats %s as an empty document", (_label, value) => {
    expect(topLevelBlocks(value)).toEqual([]);
  });
});

describe("diffDocuments", () => {
  it("marks identical documents all same", () => {
    const a = doc(h("Intro"), p("one"), p("two"));
    expect(statuses(diffDocuments(a, a))).toEqual(["same", "same", "same"]);
  });

  it("ignores key order inside blocks", () => {
    const a = doc({ type: "heading", attrs: { level: 2 }, content: [{ text: "T", type: "text" }] });
    const b = doc({ content: [{ type: "text", text: "T" }], attrs: { level: 2 }, type: "heading" });
    expect(statuses(diffDocuments(a, b))).toEqual(["same"]);
  });

  it("finds an inserted block", () => {
    const rows = diffDocuments(doc(p("a"), p("c")), doc(p("a"), p("b"), p("c")));
    expect(rows).toEqual([
      { status: "same", left: p("a"), right: p("a"), leftIndex: 0, rightIndex: 0 },
      { status: "added", right: p("b"), rightIndex: 1 },
      { status: "same", left: p("c"), right: p("c"), leftIndex: 1, rightIndex: 2 },
    ]);
  });

  it("finds a removed block", () => {
    const rows = diffDocuments(doc(p("a"), p("b"), p("c")), doc(p("a"), p("c")));
    expect(statuses(rows)).toEqual(["same", "removed", "same"]);
    expect(rows[1]).toEqual({ status: "removed", left: p("b"), leftIndex: 1 });
  });

  it("pairs an edit in place as changed", () => {
    const rows = diffDocuments(doc(p("a"), p("b"), p("c")), doc(p("a"), p("B"), p("c")));
    expect(rows[1]).toEqual({ status: "changed", left: p("b"), right: p("B"), leftIndex: 1, rightIndex: 1 });
  });

  it("pairs removed with added in order inside a gap and leaves the surplus", () => {
    const rows = diffDocuments(doc(p("a"), p("x1"), p("x2"), p("z")), doc(p("a"), p("y1"), p("y2"), p("y3"), p("z")));
    expect(rows.map((r) => [r.status, r.leftIndex, r.rightIndex])).toEqual([
      ["same", 0, 0],
      ["changed", 1, 1],
      ["changed", 2, 2],
      ["added", undefined, 3],
      ["same", 3, 4],
    ]);
    const fewer = diffDocuments(doc(p("x1"), p("x2"), p("x3")), doc(p("y1")));
    expect(statuses(fewer)).toEqual(["changed", "removed", "removed"]);
  });

  it("aligns on the longest common subsequence, not the first match", () => {
    // Greedy matching of the leading "b" would cost the a-c-d run.
    const a = doc(p("b"), p("a"), p("c"), p("d"));
    const b = doc(p("a"), p("c"), p("d"), p("b"));
    expect(statuses(diffDocuments(a, b))).toEqual(["removed", "same", "same", "same", "added"]);
  });

  it("treats a heading level change as a change", () => {
    expect(statuses(diffDocuments(doc(h("T", 1)), doc(h("T", 2))))).toEqual(["changed"]);
  });

  it("tolerates malformed input on either side", () => {
    expect(diffDocuments(null, "nope")).toEqual([]);
    expect(statuses(diffDocuments(undefined, doc(p("a"))))).toEqual(["added"]);
    expect(statuses(diffDocuments(doc(p("a")), { type: "doc" }))).toEqual(["removed"]);
    expect(statuses(diffDocuments(doc(p("a"), 7, null), doc(p("a"), 7)))).toEqual(["same", "same", "removed"]);
  });
});

describe("alignSequences", () => {
  it("matches equal items in order", () => {
    expect(alignSequences(["a", "b", "c"], ["a", "x", "c"])).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(alignSequences([], ["a"])).toEqual([]);
  });

  it("still returns a valid common subsequence when the table would exceed the budget", () => {
    const left = ["u1", "x", "u2", "y", "u3"];
    const right = ["y", "u1", "u2", "x", "u3"];
    const tight = alignSequences(left, right, { cellBudget: 1 });
    expect(tight).toEqual([
      [0, 1],
      [2, 2],
      [4, 4],
    ]);
  });
});

describe("scale", () => {
  it("compares two 40,000-block versions with a few edits quickly", () => {
    const blocks = Array.from({ length: 40_000 }, (_, i) => p(`para ${i}`));
    const edited = [...blocks];
    edited.splice(30_000, 1, p("rewritten"));
    edited.splice(12_345, 0, p("inserted"));
    edited.splice(100, 2);
    const started = performance.now();
    const rows = diffDocuments(doc(...blocks), doc(...edited));
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(rows.filter((r) => r.status !== "same").map((r) => r.status)).toEqual(["removed", "removed", "added", "changed"]);
  });

  it("keeps the exact alignment when most blocks exist on one side only", () => {
    // 4,200 one-sided blocks each way would make a 17.6M-cell table; only the two shared
    // (and repeated, so not patience anchors) blocks need aligning.
    const side = (tag: string) => Array.from({ length: 2_100 }, (_, i) => p(`${tag}${i}`));
    const a = doc(...side("L"), p("shared"), p("shared"), ...side("L2-"));
    const b = doc(...side("R"), p("shared"), p("shared"), ...side("R2-"));
    expect(diffDocuments(a, b).filter((r) => r.status === "same")).toHaveLength(2);
  });

  it("stays bounded when the differing middle is too large for the exact table", () => {
    // 5,000 distinct blocks reversed: the exact table would be 25M cells, over the budget.
    const blocks = Array.from({ length: 5_000 }, (_, i) => p(`r${i}`));
    const rows = diffDocuments(doc(...blocks), doc(...[...blocks].reverse()));
    expect(rows.filter((r) => r.status === "same").length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((r) => r.status !== "added")).toHaveLength(5_000);
  });

  it("stays bounded when every split peels off a single anchor", () => {
    // L_N = [a_N], L_t = L_{t+1} + [a_t, a_{t+1}];  R_N = [a_N], R_t = R_{t+1} + [a_t, z_t].
    // At every level the only block unique on both sides is a_t near the end, so each
    // patience split leaves an almost unchanged region that is still over the cell budget.
    // Uncapped, this took about 56 s at n = 12,000; total work across passes is now capped.
    const { left, right } = peelingInput(12_000);
    const started = performance.now();
    const rows = diffDocuments(doc(...left), doc(...right));
    expect(performance.now() - started).toBeLessThan(3_000);
    // Still a faithful comparison: both versions survive whole and in order.
    expect(rows.filter((r) => r.status !== "added").map((r) => r.left)).toEqual(left);
    expect(rows.filter((r) => r.status !== "removed").map((r) => r.right)).toEqual(right);
    for (const r of rows) if (r.status === "same") expect(canonicalJson(r.left)).toBe(canonicalJson(r.right));
  });
});

/** The reviewer's crafted pair (see "stays bounded when every split peels off a single anchor"). */
function peelingInput(n: number): { left: unknown[]; right: unknown[] } {
  const left: unknown[] = [p(`a${n}`)];
  const right: unknown[] = [p(`a${n}`)];
  for (let t = n - 1; t >= 0; t--) {
    left.push(p(`a${t}`), p(`a${t + 1}`));
    right.push(p(`a${t}`), p(`z${t}`));
  }
  return { left, right };
}

describe("alignSequences work cap", () => {
  const peelingKeys = (n: number) => {
    const { left, right } = peelingInput(n);
    return { x: left.map(canonicalJson), y: right.map(canonicalJson) };
  };

  it("is exact on the peeling input when the cap allows it, and still valid when it does not", () => {
    const { x, y } = peelingKeys(40);
    // Over the cell budget at every level, so it peels anchor by anchor; uncapped that finds
    // all 41 a-blocks.
    const uncapped = alignSequences(x, y, { cellBudget: 50 });
    expect(isCommonSubsequence(uncapped, x, y)).toBe(true);
    expect(uncapped).toHaveLength(lcsLength(x, y));
    // A cap leaves the rest unaligned instead of continuing to peel.
    const capped = alignSequences(x, y, { cellBudget: 50, workBudget: 200 });
    expect(isCommonSubsequence(capped, x, y)).toBe(true);
    expect(capped.length).toBeLessThan(uncapped.length);
  });

  it("charges an exact table by its cells", () => {
    // Scanning the 3 + 3 items costs 6; the (3+1)·(3+1) table 16 more. No item is unique on
    // both sides, so without the table there is nothing to align.
    const x = ["a", "b", "a"];
    const y = ["b", "a", "b"];
    expect(alignSequences(x, y, { workBudget: 22 })).toHaveLength(2);
    expect(alignSequences(x, y, { workBudget: 21 })).toEqual([]);
  });

  it("still matches the common prefix and suffix after the cap is spent", () => {
    expect(alignSequences(["s", "x", "y", "e"], ["s", "y", "x", "e"], { workBudget: 0 })).toEqual([
      [0, 0],
      [3, 3],
    ]);
  });
});

// ---- properties ---------------------------------------------------------------------------

const block = fc.oneof(
  fc.constantFrom("a", "b", "c", "d", "e").map(p),
  fc.constantFrom("A", "B").map((t) => h(t)),
  // Same content as p("a") with another key order: must compare equal.
  fc.constant({ content: [{ text: "a", type: "text" }], type: "paragraph" }),
  fc.constant({ type: "horizontalRule" }),
);
const document = fc.array(block, { maxLength: 14 }).map((blocks) => doc(...blocks));

/** Reference LCS length by the textbook table. */
function lcsLength(x: readonly string[], y: readonly string[]): number {
  const t = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      t[i]![j] = x[i - 1] === y[j - 1] ? t[i - 1]![j - 1]! + 1 : Math.max(t[i - 1]![j]!, t[i]![j - 1]!);
    }
  }
  return t[x.length]![y.length]!;
}

function isCommonSubsequence<K>(m: Array<[number, number]>, x: readonly K[], y: readonly K[]): boolean {
  return m.every(([i, j], k) => {
    const prev = m[k - 1];
    return x[i] === y[j] && (prev === undefined || (i > prev[0] && j > prev[1]));
  });
}

describe("diffDocuments properties", () => {
  it("is deterministic", () => {
    fc.assert(
      fc.property(document, document, (a, b) => {
        expect(diffDocuments(a, b)).toEqual(diffDocuments(structuredClone(a), structuredClone(b)));
      }),
    );
  });

  it("diff(a, a) is all same", () => {
    fc.assert(
      fc.property(document, (a) => {
        const rows = diffDocuments(a, structuredClone(a));
        expect(rows.every((r) => r.status === "same")).toBe(true);
        expect(rows).toHaveLength(topLevelBlocks(a).length);
      }),
    );
  });

  it("left sides in order rebuild a's blocks, right sides b's, with indices 0..n-1", () => {
    fc.assert(
      fc.property(document, document, (a, b) => {
        const rows = diffDocuments(a, b);
        const lefts = rows.filter((r) => r.status !== "added");
        const rights = rows.filter((r) => r.status !== "removed");
        expect(lefts.map((r) => r.left)).toEqual(topLevelBlocks(a));
        expect(rights.map((r) => r.right)).toEqual(topLevelBlocks(b));
        lefts.forEach((r, i) => expect(r.left).toBe(topLevelBlocks(a)[i]));
        expect(lefts.map((r) => r.leftIndex)).toEqual(lefts.map((_, i) => i));
        expect(rights.map((r) => r.rightIndex)).toEqual(rights.map((_, i) => i));
      }),
    );
  });

  it("aligns a longest common subsequence; same rows are equal and changed rows are not", () => {
    fc.assert(
      fc.property(document, document, (a, b) => {
        const rows = diffDocuments(a, b);
        const ka = topLevelBlocks(a).map(canonicalJson);
        const kb = topLevelBlocks(b).map(canonicalJson);
        expect(rows.filter((r) => r.status === "same")).toHaveLength(lcsLength(ka, kb));
        for (const r of rows) {
          if (r.status === "same") expect(canonicalJson(r.left)).toBe(canonicalJson(r.right));
          if (r.status === "changed") expect(canonicalJson(r.left)).not.toBe(canonicalJson(r.right));
        }
      }),
    );
  });

  it("never leaves both a removed and an added row in the same gap", () => {
    fc.assert(
      fc.property(document, document, (a, b) => {
        const gaps = diffDocuments(a, b)
          .map((r) => r.status)
          .join(" ")
          .split("same");
        for (const gap of gaps) expect(gap.includes("removed") && gap.includes("added")).toBe(false);
      }),
    );
  });

  it("alignSequences is a valid common subsequence at any budget, and the longest within it", () => {
    const seq = fc.array(fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h"), { maxLength: 30 });
    fc.assert(
      fc.property(seq, seq, fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 400 }), (x, y, budget, work) => {
        const tight = alignSequences(x, y, { cellBudget: budget });
        expect(isCommonSubsequence(tight, x, y)).toBe(true);
        const capped = alignSequences(x, y, { cellBudget: budget, workBudget: work });
        expect(isCommonSubsequence(capped, x, y)).toBe(true);
        const exact = alignSequences(x, y);
        expect(isCommonSubsequence(exact, x, y)).toBe(true);
        expect(exact).toHaveLength(lcsLength(x, y));
      }),
      { numRuns: 300 },
    );
  });
});

describe("alignReport: whether the alignment is exact (RD-066)", () => {
  it("is exact when every region fits the budgets, whatever the answer", () => {
    expect(alignReport(["a", "b", "a"], ["b", "a", "b"]).exact).toBe(true);
    expect(alignReport([], ["a"]).exact).toBe(true);
    expect(alignReport(["a", "b"], ["a", "b"]).exact).toBe(true);
  });

  it("is not exact once the work budget leaves a region unaligned", () => {
    const report = alignReport(["s", "x", "y", "e"], ["s", "y", "x", "e"], { workBudget: 0 });
    expect(report.exact).toBe(false);
    expect(report.matches).toEqual([
      [0, 0],
      [3, 3],
    ]);
  });

  it("is not exact once the table budget forces patience anchors", () => {
    const x = ["a", "b", "a", "c", "a"];
    const y = ["a", "c", "a", "b", "a"];
    expect(alignReport(x, y).exact).toBe(true);
    expect(alignReport(x, y, { cellBudget: 4 }).exact).toBe(false);
  });

  it("alignSequences returns the same matches", () => {
    const x = ["a", "b", "c", "d"];
    const y = ["b", "a", "d", "c"];
    for (const options of [{}, { cellBudget: 4 }, { workBudget: 0 }]) {
      expect(alignSequences(x, y, options)).toEqual(alignReport(x, y, options).matches);
    }
  });
});

describe("diffDocumentsReport", () => {
  const doc = (...texts: string[]) => ({
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });

  it("returns the rows of diffDocuments, and approximate:false for an ordinary comparison", () => {
    const a = doc("one", "two", "three");
    const b = doc("one", "2", "three", "four");
    const report = diffDocumentsReport(a, b);
    expect(report.blocks).toEqual(diffDocuments(a, b));
    expect(report.approximate).toBe(false);
  });

  it("says approximate when the budget was hit, with rows that are still a valid comparison", () => {
    const a = doc("s", "x", "y", "e");
    const b = doc("s", "y", "x", "e");
    const report = diffDocumentsReport(a, b, { workBudget: 0 });
    expect(report.approximate).toBe(true);
    expect(report.blocks.map((r) => r.status)).toEqual(["same", "changed", "changed", "same"]);
  });
});
