// The compare view model (RD-060, RD-066): one aligned row per BlockDiff, the counts, identical
// content, the title flag, the sides' headers and the approximate-alignment flag.
import { describe, expect, it } from "vitest";
import { alignSequences, type BlockDiff, canonicalJson, diffDocuments, topLevelBlocks } from "@/domain/documents";
import { alignmentCutShort, blockDoc, buildCompareModel, cellIdPrefix, compareRows, countRows, readApproximate } from "../compare-model";
import { bob, detail, doc, p, page } from "./fixtures";

function model(
  leftDoc: unknown,
  rightDoc: unknown,
  over: { leftTitle?: string; rightTitle?: string; approximate?: boolean; blocks?: readonly BlockDiff[] } = {},
) {
  const left = detail(2, leftDoc, { title: over.leftTitle ?? "Specifications", message: null });
  const right = detail(5, rightDoc, { title: over.rightTitle ?? "Specifications", current: true, author: bob, message: "Restored from v. 1" });
  return buildCompareModel({
    space: { key: "TEAM" },
    page: page(),
    left,
    right,
    blocks: over.blocks ?? diffDocuments(left.content, right.content),
    approximate: over.approximate ?? false,
  });
}

/**
 * A crafted pair that exhausts RD-066's default work budget (16,777,216 units). Both sides are
 * U0, then four runs of 2,047 alternating paragraphs each followed by U1…U4. The left runs start
 * A, the right ones B. Patience splits on U1–U3. Each run then costs a 2,048 × 2,048 LCS table
 * (4,194,304 units, exactly the cell budget), so three runs fit and the fourth is left unaligned.
 */
function workCapPair() {
  const run = (first: string, second: string) => Array.from({ length: 2047 }, (_, i) => p(i % 2 === 0 ? first : second));
  const left: unknown[] = [p("U0")];
  const right: unknown[] = [p("U0")];
  for (let k = 1; k <= 4; k++) {
    left.push(...run("A", "B"), p(`U${k}`));
    right.push(...run("B", "A"), p(`U${k}`));
  }
  return { left: doc(...left), right: doc(...right) };
}

describe("compareRows", () => {
  it("keeps one row per block diff in order, with the missing side null", () => {
    const rows = compareRows(diffDocuments(doc(p("A"), p("B"), p("C")), doc(p("A"), p("B2"), p("C"), p("D"))));
    expect(rows.map((r) => [r.status, r.leftIndex, r.rightIndex])).toEqual([
      ["same", 0, 0],
      ["changed", 1, 1],
      ["same", 2, 2],
      ["added", null, 3],
    ]);
    expect(rows[3]?.left).toBeNull();
    expect(rows[3]?.right).toEqual(p("D"));
  });

  it("gives removed rows an empty right side", () => {
    const rows = compareRows(diffDocuments(doc(p("A"), p("B")), doc(p("A"))));
    expect(rows[1]).toMatchObject({ status: "removed", left: p("B"), leftIndex: 1, right: null, rightIndex: null });
  });

  it("gives every row a distinct key", () => {
    const rows = compareRows(diffDocuments(doc(p("1"), p("2"), p("3")), doc(p("x"), p("y"), p("z"), p("w"), p("v"))));
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe("buildCompareModel", () => {
  it("counts added, removed and changed blocks", () => {
    const m = model(doc(p("A"), p("B"), p("C")), doc(p("A"), p("B2"), p("D"), p("E")));
    expect(m.counts).toEqual({ added: 1, removed: 0, changed: 2, same: 1 });
    expect(m.identical).toBe(false);
    expect(countRows(m.rows)).toEqual(m.counts);
  });

  it("is not identical when blocks were only added, or only removed", () => {
    const addedToEmpty = model(doc(), doc(p("First words")));
    expect(addedToEmpty.counts).toEqual({ added: 1, removed: 0, changed: 0, same: 0 });
    expect(addedToEmpty.identical).toBe(false);
    expect(model(doc(p("A")), doc(p("A"), p("B"))).identical).toBe(false);

    const removedToEmpty = model(doc(p("Last words")), doc());
    expect(removedToEmpty.counts).toEqual({ added: 0, removed: 1, changed: 0, same: 0 });
    expect(removedToEmpty.identical).toBe(false);
    expect(model(doc(p("A"), p("B")), doc(p("A"))).identical).toBe(false);
  });

  it("is identical when every block is the same, even if key order differs", () => {
    const m = model(doc({ type: "paragraph", attrs: { indent: 0, textAlign: null } }), doc({ attrs: { textAlign: null, indent: 0 }, type: "paragraph" }));
    expect(m.identical).toBe(true);
    expect(m.titleChanged).toBe(false);
  });

  it("treats two empty documents as identical, with no rows and both sides empty", () => {
    const m = model(doc(), doc());
    expect(m.rows).toEqual([]);
    expect(m.identical).toBe(true);
    expect(m.left.empty).toBe(true);
    expect(m.right.empty).toBe(true);
  });

  it("flags a title that differs between the versions", () => {
    expect(model(doc(p("A")), doc(p("A")), { leftTitle: "Spec", rightTitle: "Specifications" }).titleChanged).toBe(true);
  });

  it("describes each side: label, read-only link, title, published, author, change note", () => {
    const m = model(doc(p("A")), doc(p("B")));
    expect(m.left).toMatchObject({
      number: 2,
      label: "v. 2",
      href: "/spaces/TEAM/pages/p-spec?version=2",
      published: "Jul 25, 2023 10:00",
      author: "Alice Admin",
      comment: null,
      empty: false,
    });
    expect(m.right).toMatchObject({
      number: 5,
      label: "CURRENT (v. 5)",
      href: "/spaces/TEAM/pages/p-spec",
      author: "Bob Editor",
      comment: "Restored from v. 1",
    });
    expect(m.historyHref).toBe("/spaces/TEAM/pages/p-spec/history");
    expect(m.crumbs.at(-1)).toEqual({ label: "Specifications", href: "/spaces/TEAM/pages/p-spec" });
  });

  it("carries the approximate flag through", () => {
    expect(model(doc(p("A")), doc(p("B")), { approximate: true }).approximate).toBe(true);
    expect(model(doc(p("A")), doc(p("B"))).approximate).toBe(false);
  });

  it("flags a comparison RD-066's work cap cut short, though the server does not say so", () => {
    const pair = workCapPair();
    // The pair really does hit the default cap: uncapped, the alignment is longer.
    const keys = (d: unknown) => topLevelBlocks(d).map(canonicalJson);
    const capped = alignSequences(keys(pair.left), keys(pair.right));
    const uncapped = alignSequences(keys(pair.left), keys(pair.right), { workBudget: Number.MAX_SAFE_INTEGER });
    expect(capped.length).toBeLessThan(uncapped.length);

    const m = model(pair.left, pair.right, { approximate: false });
    expect(m.identical).toBe(false);
    expect(m.approximate).toBe(true);
  });
});

describe("alignmentCutShort (RD-066)", () => {
  const rows = (blocks: readonly BlockDiff[]) => compareRows(blocks);
  const A = p("A");
  const B = p("B");

  it("is true when a run of non-same rows pairs equal blocks off as changed", () => {
    // [A, B] → [B, A] left unaligned: an exact alignment would keep one of them.
    expect(
      alignmentCutShort(
        rows([
          { status: "changed", left: A, right: B, leftIndex: 0, rightIndex: 0 },
          { status: "changed", left: B, right: A, leftIndex: 1, rightIndex: 1 },
        ]),
      ),
    ).toBe(true);
  });

  it("is true when a block is removed and an equal one added in the same run, by canonical JSON", () => {
    const reordered = { content: [{ text: "A", type: "text" }], type: "paragraph" };
    expect(
      alignmentCutShort(
        rows([
          { status: "same", left: B, right: B, leftIndex: 0, rightIndex: 0 },
          { status: "changed", left: p("X"), right: p("Y"), leftIndex: 1, rightIndex: 1 },
          { status: "removed", left: A, leftIndex: 2 },
          { status: "added", right: reordered, rightIndex: 2 },
        ]),
      ),
    ).toBe(true);
  });

  it("is false when equal blocks fall in different runs, as a move does", () => {
    expect(
      alignmentCutShort(
        rows([
          { status: "removed", left: A, leftIndex: 0 },
          { status: "same", left: B, right: B, leftIndex: 1, rightIndex: 0 },
          { status: "added", right: A, rightIndex: 1 },
        ]),
      ),
    ).toBe(false);
  });

  it("is never true for an exact alignment", () => {
    const exact = (l: unknown[], r: unknown[]) => alignmentCutShort(compareRows(diffDocuments(doc(...l), doc(...r))));
    expect(exact([], [])).toBe(false);
    expect(exact([A, B], [A, B])).toBe(false);
    expect(exact([A, B], [B, A])).toBe(false);
    expect(exact([A, A, B], [A, B, B])).toBe(false);
    expect(exact([A, B, A, B, A], [B, A, B, A, B])).toBe(false);
    expect(exact([p("x"), p("y")], [p("z")])).toBe(false);
    expect(exact([], [A, A])).toBe(false);
  });
});

describe("helpers", () => {
  it("wraps a block in a one-block document", () => {
    expect(blockDoc(p("A"))).toEqual({ type: "doc", content: [p("A")] });
  });

  it("gives each cell its own heading-anchor prefix", () => {
    expect(cellIdPrefix("a", 3)).toBe("rf-h-a3-");
    expect(cellIdPrefix("b", 3)).not.toBe(cellIdPrefix("a", 3));
  });

  it("reads approximate only when the comparison says true", () => {
    expect(readApproximate({})).toBe(false);
    expect(readApproximate({ approximate: false })).toBe(false);
    expect(readApproximate({ approximate: "yes" })).toBe(false);
    expect(readApproximate({ approximate: true })).toBe(true);
  });
});
