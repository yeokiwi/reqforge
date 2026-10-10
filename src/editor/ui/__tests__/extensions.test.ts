// @vitest-environment jsdom
// The editor's extension list adds behaviour only: its schema must be exactly the server's
// (RD-063), or the editor could produce documents the server refuses, or fail to open ones it
// stores.
import type { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { MARK_NAMES, NODE_NAMES, documentSchema, emptyDocument, validateDocumentJson } from "@/editor/schema";
import { stripUnstorable } from "../extensions";
import { doc, newEditor, p, table, text } from "./editor-harness";

function describeSchema(schema: Schema) {
  const nodes = Object.fromEntries(
    Object.entries(schema.nodes).map(([name, type]) => [
      name,
      {
        content: type.spec.content ?? null,
        group: type.spec.group ?? null,
        inline: type.isInline,
        atom: type.isAtom,
        marks: type.spec.marks ?? null,
        attrs: Object.fromEntries(Object.entries(type.spec.attrs ?? {}).map(([attr, spec]) => [attr, spec.default])),
      },
    ]),
  );
  const marks = Object.fromEntries(
    Object.entries(schema.marks).map(([name, type]) => [
      name,
      {
        inclusive: type.spec.inclusive ?? null,
        excludes: type.spec.excludes ?? null,
        attrs: Object.fromEntries(Object.entries(type.spec.attrs ?? {}).map(([attr, spec]) => [attr, spec.default])),
      },
    ]),
  );
  return { nodes, marks, top: schema.topNodeType.name };
}

describe("the editor's schema", () => {
  it("is exactly the shared schema the server validates with: same nodes, marks, content, attributes and defaults", () => {
    const editor = newEditor();
    expect(Object.keys(editor.schema.nodes)).toEqual([...NODE_NAMES]);
    expect(Object.keys(editor.schema.marks)).toEqual([...MARK_NAMES]);
    expect(describeSchema(editor.schema)).toEqual(describeSchema(documentSchema));
  });

  it("opens an empty document and produces one the server stores", () => {
    const editor = newEditor(emptyDocument());
    expect(validateDocumentJson(editor.getJSON()).ok).toBe(true);
  });

  it("round-trips canonical content unchanged", () => {
    const content = doc(p(text("x")), table({ widthMode: "fixed", numberedColumn: true }, [120, 80]));
    const result = validateDocumentJson(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const editor = newEditor(result.doc);
    expect(editor.getJSON()).toEqual(result.doc);
  });
});

describe("behaviour added on top", () => {
  it("links do not navigate when clicked while editing", () => {
    const editor = newEditor();
    const link = editor.extensionManager.extensions.find((extension) => extension.name === "link");
    expect((link?.options as { openOnClick?: unknown } | undefined)?.openOnClick).toBe(false);
  });

  it("tables are resizable and rendered by the editor's own table view", () => {
    const editor = newEditor(doc(table({ numberedColumn: true })));
    const wrapper = editor.view.dom.querySelector(".rf-table-wrapper");
    expect(wrapper).not.toBeNull();
    const tableEl = wrapper?.querySelector("table");
    expect(tableEl?.className).toBe("rf-table rf-table--responsive rf-table--numbered");
    expect(tableEl?.querySelector("colgroup > col.rf-table__number-col")).not.toBeNull();
  });

  it("an empty document shows the placeholder", () => {
    const editor = newEditor();
    const paragraph = editor.view.dom.querySelector("p");
    expect(paragraph?.getAttribute("data-placeholder")).toBe("Type here");
    expect(paragraph?.classList.contains("is-editor-empty")).toBe(true);
  });

  it("has undo history (StarterKit behaviour) without duplicating any schema extension", () => {
    const editor = newEditor(doc(p(text("x"))));
    const names = editor.extensionManager.extensions.map((extension) => extension.name);
    expect(names).toContain("history");
    expect(names).toContain("placeholder");
    expect(names).toContain("rfPasteFilter");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the paste filter (RD-068)", () => {
  it("strips U+0000 and unpaired surrogates, which the database cannot hold", () => {
    expect(stripUnstorable("a\u0000b")).toBe("ab");
    expect(stripUnstorable("x\uD800y\uDC00z")).toBe("xyz");
    expect(stripUnstorable("emoji 😀 stays")).toBe("emoji 😀 stays");
  });

  it("applies to pasted text and pasted HTML", () => {
    const editor = newEditor(doc(p()));
    const text = editor.view.someProp("transformPastedText", (f) => f("a\u0000b", false, editor.view));
    const html = editor.view.someProp("transformPastedHTML", (f) => f("<p>c\u0000d</p>", editor.view));
    expect(text).toBe("ab");
    expect(html).toBe("<p>cd</p>");
  });
});
