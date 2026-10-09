// @vitest-environment jsdom
// What a user can produce by typing. Input rules turn typed text into nodes and attributes,
// so every rule the schema extensions carry must produce content the server stores: an
// autosave that fails validation fails on every keystroke until the user finds the node.
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { STARTER_KIT_BEHAVIOUR_ONLY, schemaExtensions, validateDocumentJson } from "..";
import { ATTACHMENT_ID, typesUsed } from "./fixtures";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

/** The editor UI's extension list (10 §5.1): the schema plus StarterKit's behaviour only. */
function newEditor(): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...schemaExtensions, StarterKit.configure(STARTER_KIT_BEHAVIOUR_ONLY)],
  });
  editors.push(editor);
  return editor;
}

/** Types `keys` one character at a time, as the browser's text input would. */
function type(editor: Editor, keys: string): void {
  const view = editor.view;
  for (const ch of keys) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(ch, from, to);
    const handled = view.someProp("handleTextInput", (handler) => handler(view, from, to, ch, insert));
    if (!handled) view.dispatch(insert());
  }
}

function typed(keys: string): unknown {
  const editor = newEditor();
  type(editor, keys);
  return editor.getJSON();
}

function expectStorable(json: unknown): void {
  const result = validateDocumentJson(json);
  expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
}

describe("input rules never create content the server refuses", () => {
  it("the harness fires input rules: typing '# ' makes a heading and '3. ' a list starting at 3", () => {
    expect(typed("# Title")).toEqual({
      type: "doc",
      content: [{ type: "heading", attrs: { textAlign: null, indent: 0, level: 1 }, content: [{ type: "text", text: "Title" }] }],
    });
    const list = typed("3. x") as { content: Array<{ type: string; attrs?: unknown }> };
    expect(list.content[0]?.type).toBe("orderedList");
    expect(list.content[0]?.attrs).toEqual({ start: 3 });
  });

  it.each([
    ["an external image", "![x](https://evil.example/p.png) "],
    ["an image with a title", '![x](https://evil.example/p.png "t") '],
    ["even an attachment URL (an image needs its attachmentId)", `![x](/api/v1/attachments/${ATTACHMENT_ID}/x.png) `],
  ])("Markdown image syntax stays text: %s", (_label, keys) => {
    const json = typed(keys);
    expect(typesUsed(json).nodes.has("image")).toBe(false);
    expectStorable(json);
    expect(JSON.stringify(json)).toContain(JSON.stringify(keys.trimEnd()).slice(1, -1));
  });

  it("an ordered list start beyond a safe integer stays text", () => {
    const json = typed("99999999999999999999. ");
    expect(typesUsed(json).nodes.has("orderedList")).toBe(false);
    expectStorable(json);
  });

  it("a fifteen-digit start still makes a list, with that start", () => {
    const json = typed("999999999999999. x") as { content: Array<{ type: string; attrs?: unknown }> };
    expect(json.content[0]?.type).toBe("orderedList");
    expect(json.content[0]?.attrs).toEqual({ start: 999999999999999 });
    expectStorable(json);
  });

  it.each([["```"], ["~~~"]])("a %s code fence with an over-long language stays text", (fence) => {
    const json = typed(`${fence}${"a".repeat(65)} `);
    expect(typesUsed(json).nodes.has("codeBlock")).toBe(false);
    expectStorable(json);
  });

  it.each([["```"], ["~~~"]])("a %s code fence with a 64-letter language makes a code block", (fence) => {
    const json = typed(`${fence}${"a".repeat(64)} `) as { content: Array<{ type: string; attrs?: unknown }> };
    expect(json.content[0]).toEqual({ type: "codeBlock", attrs: { language: "a".repeat(64) } });
    expectStorable(json);
  });

  // Every input rule StarterKit and the schema extensions carry, at its edge.
  it.each([
    ["# h"],
    ["###### h"],
    ["> q"],
    ["- b"],
    ["* b"],
    ["1. o"],
    ["0. o"],
    ["[ ] t"],
    ["[x] t"],
    ["---"],
    ["```ts x"],
    ["~~~ x"],
    ["**b** "],
    ["__b__ "],
    ["*i* "],
    ["_i_ "],
    ["~~s~~ "],
    ["`c` "],
    ["www.example.com "],
    ["a@example.com "],
  ])("typing %j produces storable content", (keys) => {
    expectStorable(typed(keys));
  });
});
