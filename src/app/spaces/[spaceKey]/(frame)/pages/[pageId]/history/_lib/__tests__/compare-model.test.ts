// The compare view model (RD-060, RD-066): one aligned row per BlockDiff, the counts, identical
// content, the title flag, the sides' headers and the approximate-alignment flag.
import { describe, expect, it } from "vitest";
import { diffDocuments } from "@/domain/documents";
import { blockDoc, buildCompareModel, cellIdPrefix, compareRows, countRows, readApproximate } from "../compare-model";
import { bob, detail, doc, p, page } from "./fixtures";

function model(leftDoc: unknown, rightDoc: unknown, over: { leftTitle?: string; rightTitle?: string; approximate?: boolean } = {}) {
  const left = detail(2, leftDoc, { title: over.leftTitle ?? "Specifications", message: null });
  const right = detail(5, rightDoc, { title: over.rightTitle ?? "Specifications", current: true, author: bob, message: "Restored from v. 1" });
  return buildCompareModel({
    space: { key: "TEAM" },
    page: page(),
    left,
    right,
    blocks: diffDocuments(left.content, right.content),
    approximate: over.approximate ?? false,
  });
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
