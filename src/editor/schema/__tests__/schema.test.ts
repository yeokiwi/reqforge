// The schema against the table in docs/specs/03-authoring-and-indexing.md §1.4. If this test
// fails, either the code or the spec is wrong: fix the one that is, and say which.
import { describe, expect, it } from "vitest";
import { MARK_NAMES, NODE_NAMES, documentSchema, schemaExtensions } from "..";

interface NodeRow {
  group: string | null;
  content: string | null;
  inline?: boolean;
  atom?: boolean;
  attrs: Record<string, unknown>;
}

const SPEC_NODES: Record<string, NodeRow> = {
  doc: { group: null, content: "block+", attrs: {} },
  paragraph: { group: "block", content: "inline*", attrs: { textAlign: null, indent: 0 } },
  heading: { group: "block", content: "inline*", attrs: { level: 1, textAlign: null, indent: 0 } },
  blockquote: { group: "block", content: "block+", attrs: {} },
  codeBlock: { group: "block", content: "text*", attrs: { language: null } },
  horizontalRule: { group: "block", content: null, atom: true, attrs: {} },
  bulletList: { group: "block list", content: "listItem+", attrs: {} },
  orderedList: { group: "block list", content: "listItem+", attrs: { start: 1 } },
  listItem: { group: null, content: "paragraph block*", attrs: {} },
  taskList: { group: "block list", content: "taskItem+", attrs: {} },
  taskItem: { group: null, content: "paragraph block*", attrs: { checked: false } },
  table: { group: "block", content: "tableRow+", attrs: { widthMode: "responsive", numberedColumn: false } },
  tableRow: { group: null, content: "(tableCell | tableHeader)*", attrs: {} },
  tableHeader: { group: null, content: "block+", attrs: { colspan: 1, rowspan: 1, colwidth: null, background: null } },
  tableCell: { group: null, content: "block+", attrs: { colspan: 1, rowspan: 1, colwidth: null, background: null } },
  infoPanel: { group: "block", content: "block+", attrs: { variant: "info" } },
  tableOfContents: { group: "block", content: null, atom: true, attrs: { minLevel: 1, maxLevel: 6 } },
  image: { group: "inline", content: null, inline: true, atom: true, attrs: { attachmentId: null, src: null, alt: null, title: null, width: null } },
  status: { group: "inline", content: null, inline: true, atom: true, attrs: { text: "", colour: "grey" } },
  date: { group: "inline", content: null, inline: true, atom: true, attrs: { value: null } },
  mention: { group: "inline", content: null, inline: true, atom: true, attrs: { userId: null, label: null } },
  hardBreak: { group: "inline", content: null, inline: true, attrs: {} },
  text: { group: "inline", content: null, inline: true, attrs: {} },
};

const SPEC_MARKS: Record<string, Record<string, unknown>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  subscript: {},
  superscript: {},
  link: { href: null },
  textStyle: { color: null },
};

function defaults(spec: { attrs?: Record<string, { default?: unknown }> }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec.attrs ?? {}).map(([name, attr]) => [name, attr.default]));
}

describe("the document schema (03 §1.4)", () => {
  it("has exactly the spec's nodes and marks", () => {
    expect([...NODE_NAMES].sort()).toEqual(Object.keys(SPEC_NODES).sort());
    expect([...MARK_NAMES].sort()).toEqual(Object.keys(SPEC_MARKS).sort());
    expect(documentSchema.topNodeType.name).toBe("doc");
  });

  it.each(Object.entries(SPEC_NODES))("node %s matches its row", (name, row) => {
    const type = documentSchema.nodes[name];
    if (!type) throw new Error(`missing node ${name}`);
    expect(type.spec.group ?? null).toBe(row.group);
    expect(type.spec.content ?? null).toBe(row.content);
    expect(type.isInline).toBe(row.inline ?? false);
    if (row.atom) expect(type.isAtom).toBe(true);
    expect(defaults(type.spec as { attrs?: Record<string, { default?: unknown }> })).toEqual(row.attrs);
  });

  it.each(Object.entries(SPEC_MARKS))("mark %s has attributes %j", (name, attrs) => {
    const type = documentSchema.marks[name];
    if (!type) throw new Error(`missing mark ${name}`);
    expect(defaults(type.spec as { attrs?: Record<string, { default?: unknown }> })).toEqual(attrs);
  });

  it("forbids marks in code blocks and lets code exclude every other mark", () => {
    expect(documentSchema.nodes.codeBlock?.spec.marks).toBe("");
    expect(documentSchema.marks.code?.spec.excludes).toBe("_");
  });

  it("makes paragraph the default block, so an empty document is one empty paragraph", () => {
    expect(documentSchema.topNodeType.createAndFill()?.firstChild?.type.name).toBe("paragraph");
  });

  it("is headless: the extension list carries no history, drop cursor or gap cursor", () => {
    const names = schemaExtensions.map((e) => e.name);
    expect(names).not.toContain("history");
    expect(names).not.toContain("dropcursor");
    expect(names).not.toContain("gapcursor");
    expect(names).not.toContain("starterKit");
    expect(new Set(names).size).toBe(names.length);
  });
});
