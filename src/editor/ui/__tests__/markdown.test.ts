// @vitest-environment jsdom
// The Markup dialog's conversion (10 §5.5: "paste Markdown or HTML and convert"): Markdown with
// `marked`, then the paste sanitiser, then the schema's own parser. A remote image is never
// inserted (RD-058) and what lands always validates against the server's schema (RD-063).
import { describe, expect, it } from "vitest";
import { validateDocumentJson } from "@/editor/schema";
import { insertMarkupHtml, isEmptySlice, markdownToHtml, markupSlice, markupToHtml } from "../markdown";
import { EditorUiBridge } from "../ui-bridge";
import { doc, newEditor, p, text } from "./editor-harness";

const keepNone = { keepImage: () => false };

function insertMarkdown(source: string) {
  const editor = newEditor(doc(p()));
  const ok = insertMarkupHtml(editor, markdownToHtml(source), keepNone);
  return { editor, ok, json: editor.getJSON() };
}

describe("markdownToHtml", () => {
  it("converts GitHub-flavoured Markdown: headings, emphasis, lists, tables, fenced code with a language", () => {
    const html = markdownToHtml("# Title\n\n**bold** _it_ `code`\n\n- a\n- b\n\n1. one\n\n| H | I |\n|---|---|\n| 1 | 2 |\n\n```ts\nlet x = 1;\n```\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<table>");
    expect(html).toContain('<code class="language-ts">');
  });

  it("drops a remote image and keeps the text around it (RD-058)", () => {
    const html = markdownToHtml("before ![tracking](https://evil.example/p.png) after");
    expect(html).not.toContain("<img");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("drops raw HTML that carries script, and links the schema refuses keep their text", () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n[click](javascript:alert(1)) <img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<script|onerror|javascript:|<img/);
    expect(html).toContain("click");
  });

  it("turns task lists into the schema's task list", () => {
    expect(markdownToHtml("- [x] done\n- [ ] todo")).toContain('data-type="taskList"');
  });

  it("strips U+0000 and half an emoji from the source (RD-068)", () => {
    expect(markdownToHtml("a\u0000b\uD83D")).toBe("<p>ab</p>\n");
  });

  it("HTML format is sanitised the same way", () => {
    expect(markupToHtml('<p onclick="x">a<img src="https://x/y.png"></p>', "html")).toBe("<p>a</p>");
    expect(markupToHtml("*a*", "markdown")).toContain("<em>a</em>");
    expect(markupToHtml("*a*", "html")).toBe("*a*");
  });
});

describe("inserting markup through the schema's parser", () => {
  it("inserts Markdown as structured content that the server stores", () => {
    const { ok, json, editor } = insertMarkdown("## Scope\n\nSome **text** with [a link](https://example.com).\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    expect(ok).toBe(true);
    const types = (json.content ?? []).map((n) => n.type);
    expect(types).toContain("heading");
    expect(types).toContain("bulletList");
    expect(types).toContain("table");
    expect(JSON.stringify(json)).toContain('"href":"https://example.com"');
    expect(validateDocumentJson(editor.getJSON()).ok).toBe(true);
  });

  it("never inserts a remote image, whichever format it came in", () => {
    const md = insertMarkdown("x ![a](https://example.com/a.png) y");
    expect(JSON.stringify(md.json)).not.toContain('"image"');
    expect(md.editor.getText()).toContain("x");
    const editor = newEditor(doc(p()));
    insertMarkupHtml(editor, markupToHtml('<p>x<img src="https://example.com/a.png">y</p>', "html"), keepNone);
    expect(JSON.stringify(editor.getJSON())).not.toContain('"image"');
  });

  it("drops an image of an attachment the page does not have, keeps one it has", () => {
    const ui = new EditorUiBridge();
    ui.rememberAttachment("mine");
    const editor = newEditor(doc(p()), ui);
    const html = markupToHtml('<p><img src="/api/v1/attachments/mine/a.png"><img src="/api/v1/attachments/other/b.png">t</p>', "html");
    expect(insertMarkupHtml(editor, html, { keepImage: (id) => ui.isKnownAttachment(id) })).toBe(true);
    const images: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") images.push(node.attrs.attachmentId as string);
    });
    expect(images).toEqual(["mine"]);
  });

  it("clears a fenced code language longer than the server stores (RD-068)", () => {
    const { json, editor } = insertMarkdown(`\`\`\`${"x".repeat(80)}\ncode\n\`\`\`\n`);
    const block = (json.content ?? []).find((n) => n.type === "codeBlock");
    expect(block?.attrs?.language ?? null).toBeNull();
    expect(validateDocumentJson(editor.getJSON()).ok).toBe(true);
  });

  it("is one undo step", () => {
    const editor = newEditor(doc(p(text("start"))));
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const before = editor.getJSON();
    insertMarkupHtml(editor, markdownToHtml("# A\n\nb\n\nc"), keepNone);
    expect(editor.getJSON()).not.toEqual(before);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(before);
  });

  it("refuses markup that yields nothing, changing nothing", () => {
    const editor = newEditor(doc(p(text("keep"))));
    const before = editor.getJSON();
    for (const source of ["", "   ", "<script>x</script>", '<img src="https://x/y.png">', "<p></p>"]) {
      expect(insertMarkupHtml(editor, markupToHtml(source, "html"), keepNone), source).toBe(false);
    }
    expect(editor.getJSON()).toEqual(before);
  });

  it("isEmptySlice: text or a non-break atom is content; empty blocks and line breaks are not", () => {
    const editor = newEditor();
    const slice = (html: string) => markupSlice(editor.schema, html, keepNone);
    expect(isEmptySlice(slice("<p></p><p><br></p>") as never)).toBe(true);
    expect(isEmptySlice(slice("<hr>") as never)).toBe(false);
    expect(isEmptySlice(slice("<p>a</p>") as never)).toBe(false);
  });
});

describe("where markup lands", () => {
  it("several blocks stay blocks: a heading after the caret's paragraph is still a heading, and the paragraph keeps its text", () => {
    const editor = newEditor(doc(p(text("Hello world"))));
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    insertMarkupHtml(editor, markdownToHtml("## Scope\n\n- one\n- two"), keepNone);
    const content = editor.getJSON().content ?? [];
    expect(content[0]?.type).toBe("paragraph");
    expect(content[0]?.content?.[0]?.text).toBe("Hello world");
    expect(content.map((n) => n.type)).toContain("heading");
    expect(content.map((n) => n.type)).toContain("bulletList");
    expect(validateDocumentJson(editor.getJSON()).ok).toBe(true);
  });

  it("a single paragraph flows into the text at the caret, keeping its marks", () => {
    const editor = newEditor(doc(p(text("ab"))));
    editor.commands.setTextSelection(2);
    insertMarkupHtml(editor, markdownToHtml("**X**"), keepNone);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe("aXb");
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');
  });
});
