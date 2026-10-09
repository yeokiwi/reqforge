import { describe, expect, it } from "vitest";
import { HEADING_ID_PREFIX, collectHeadings, documentSchema, indexHeadings, slugify } from "..";
import { MAX_NODE_DEPTH } from "../rules";
import { doc, h, p, text } from "./fixtures";

describe("slugify (GitHub style)", () => {
  it.each([
    ["Hello World", "hello-world"],
    ["Hello, World!", "hello-world"],
    ["C++ & C#", "c--c"],
    ["REQ-004(§2.5)", "req-00425"],
    ["snake_case stays", "snake_case-stays"],
    ["日本語の見出し", "日本語の見出し"],
    ["حروف عربية", "حروف-عربية"],
    ["Ünïcödé Straße", "ünïcödé-straße"],
    ["Ἀρχή", "ἀρχή"],
    ["🙂 Emoji", "-emoji"],
  ])("%s → %s", (input, slug) => {
    expect(slugify(input)).toBe(slug);
  });
});

describe("collectHeadings", () => {
  it("lists headings in document order with level, text and unique ids", () => {
    const d = doc(
      h(1, text("Intro")),
      p(text("body")),
      h(2, text("Intro")),
      h(2, text("Intro")),
      h(3, text("Intro-1")),
      h(2, text("Mixed "), text("marks", [{ type: "bold" }]), { type: "hardBreak" }, text("and  breaks ")),
    );
    expect(collectHeadings(d)).toEqual([
      { level: 1, text: "Intro", id: `${HEADING_ID_PREFIX}intro` },
      { level: 2, text: "Intro", id: `${HEADING_ID_PREFIX}intro-1` },
      { level: 2, text: "Intro", id: `${HEADING_ID_PREFIX}intro-2` },
      { level: 3, text: "Intro-1", id: `${HEADING_ID_PREFIX}intro-1-1` },
      { level: 2, text: "Mixed marks and breaks", id: `${HEADING_ID_PREFIX}mixed-marks-and-breaks` },
    ]);
  });

  // Heading ids share the page's id namespace with the application shell (`<main id="main">`,
  // the `global-search` field) and with a second view of the page (the history compare,
  // RD-060). A bare slug would let a heading called "Main" capture the TOC link.
  it("prefixes every id, so a heading never takes an id the application shell uses", () => {
    const ids = collectHeadings(doc(h(1, text("Main")), h(2, text("Global search")), h(2, text("Main")))).map((e) => e.id);
    expect(HEADING_ID_PREFIX).toMatch(/^[a-z][a-z0-9-]*-$/);
    expect(ids).toEqual([`${HEADING_ID_PREFIX}main`, `${HEADING_ID_PREFIX}global-search`, `${HEADING_ID_PREFIX}main-1`]);
    expect(ids).not.toContain("main");
    expect(ids).not.toContain("global-search");
  });

  it("takes another prefix, so two views on one screen get distinct ids", () => {
    const d = doc(h(1, text("Introduction")), h(1, text("Introduction")));
    const left = collectHeadings(d, { idPrefix: "rf-v3-h-" }).map((e) => e.id);
    const right = collectHeadings(d, { idPrefix: "rf-v5-h-" }).map((e) => e.id);
    expect(left).toEqual(["rf-v3-h-introduction", "rf-v3-h-introduction-1"]);
    expect(right).toEqual(["rf-v5-h-introduction", "rf-v5-h-introduction-1"]);
    expect(indexHeadings(d, { idPrefix: "rf-v3-h-" }).entries.map((e) => e.id)).toEqual(left);
  });

  it("is deterministic", () => {
    const d = doc(h(1, text("A")), h(1, text("A")), h(1, text("B")));
    expect(collectHeadings(d)).toEqual(collectHeadings(JSON.parse(JSON.stringify(d))));
  });

  it("names headings with no letters or digits, uniquely", () => {
    expect(collectHeadings(doc(h(1), h(2, text("!!!")))).map((e) => e.id)).toEqual([`${HEADING_ID_PREFIX}heading`, `${HEADING_ID_PREFIX}heading-1`]);
  });

  it("finds headings inside containers, in order", () => {
    const d = doc(
      { type: "infoPanel", attrs: { variant: "note" }, content: [h(2, text("In panel"))] },
      {
        type: "table",
        content: [{ type: "tableRow", content: [{ type: "tableCell", content: [h(3, text("In cell"))] }] }],
      },
      { type: "blockquote", content: [h(4, text("Quoted"))] },
    );
    expect(collectHeadings(d).map((e) => e.text)).toEqual(["In panel", "In cell", "Quoted"]);
  });

  it("skips headings whose level is not 1–6", () => {
    const d = { type: "doc", content: [{ type: "heading", attrs: { level: 9 }, content: [text("x")] }, h(2, text("ok"))] };
    expect(collectHeadings(d).map((e) => e.text)).toEqual(["ok"]);
  });

  it("accepts a ProseMirror node", () => {
    const node = documentSchema.nodeFromJSON(doc(h(1, text("From PM"))));
    expect(collectHeadings(node)).toEqual([{ level: 1, text: "From PM", id: `${HEADING_ID_PREFIX}from-pm` }]);
  });

  it("maps heading nodes to their entries by identity", () => {
    const first = h(1, text("Same"));
    const second = h(1, text("Same"));
    const index = indexHeadings(doc(first, second));
    expect(index.entryFor(first)?.id).toBe(`${HEADING_ID_PREFIX}same`);
    expect(index.entryFor(second)?.id).toBe(`${HEADING_ID_PREFIX}same-1`);
    expect(index.entryFor({})).toBeUndefined();
  });

  it.each([[null], [undefined], [42], ["doc"], [[]], [{ type: "doc", content: "x" }], [{ content: [null, 1, "x", { type: "heading" }] }]])(
    "tolerates garbage %j",
    (input) => {
      expect(() => collectHeadings(input)).not.toThrow();
    },
  );

  it("survives cycles and ignores anything below the depth limit", () => {
    const cyclic: Record<string, unknown> = { type: "doc", content: [] };
    (cyclic.content as unknown[]).push(cyclic, h(1, text("Top")));
    expect(collectHeadings(cyclic).map((e) => e.text)).toContain("Top");

    let node: unknown = h(1, text("Too deep"));
    for (let i = 0; i < MAX_NODE_DEPTH; i++) node = { type: "blockquote", content: [node] };
    expect(collectHeadings(doc(node as never))).toEqual([]);
  });
});
