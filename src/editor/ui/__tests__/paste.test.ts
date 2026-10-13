// @vitest-environment jsdom
// What may come into the editor from outside it (paste.ts, the paste filter in extensions.ts):
// text the database cannot hold is stripped (RD-068), pasted HTML is sanitised, a remote <img>
// keeps its text and drops the image (RD-058), a code block's language the server refuses is
// cleared (RD-068), and files are uploaded instead of pasted. Each check ends where it matters:
// the editor's document still validates against the server's schema.
import type { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { describe, expect, it, vi } from "vitest";
import { validateDocumentJson } from "@/editor/schema";
import { pasteFromCodeEditor } from "../extensions";
import { cleanPastedSlice, filesToUpload, imageAttachmentIds, sanitizeHtml, stripUnstorable } from "../paste";
import { EditorUiBridge } from "../ui-bridge";
import { doc, newEditor, p, text } from "./editor-harness";

const HIGH = "\uD83D"; // the first half of 😀
const LOW = "\uDE00"; // the second half

function json(editor: Editor): string {
  return JSON.stringify(editor.getJSON());
}

function expectStorable(editor: Editor): void {
  const result = validateDocumentJson(editor.getJSON());
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

/** A fake clipboard: what a ClipboardEvent's clipboardData offers (jsdom has none). */
function clipboard(data: Record<string, string>, files: File[] = []): Pick<DataTransfer, "getData" | "files"> {
  return {
    getData: (format: string) => data[format] ?? "",
    files: Object.assign([...files], { item: (i: number) => files[i] ?? null }) as unknown as FileList,
  };
}

function pasteEvent(data: Record<string, string>, files: File[] = []): ClipboardEvent {
  return { clipboardData: clipboard(data, files), preventDefault: () => undefined } as unknown as ClipboardEvent;
}

describe("stripUnstorable (RD-068: what PostgreSQL jsonb cannot hold)", () => {
  it("removes U+0000", () => {
    expect(stripUnstorable("a\u0000b\u0000")).toBe("ab");
  });

  it("removes half an emoji, either half, wherever it is", () => {
    expect(stripUnstorable(`x${HIGH}y`)).toBe("xy");
    expect(stripUnstorable(`x${LOW}y`)).toBe("xy");
    expect(stripUnstorable(`${HIGH}`)).toBe("");
    expect(stripUnstorable(`end${HIGH}`)).toBe("end");
    expect(stripUnstorable(`${LOW}${HIGH}`)).toBe(""); // a reversed pair is two halves
  });

  it("keeps whole emoji, astral characters and other control characters the database can hold", () => {
    expect(stripUnstorable(`${HIGH}${LOW} 😀 𝔘 日本語`)).toBe("😀 😀 𝔘 日本語");
    expect(stripUnstorable("tab\tnewline\nbell\u0007")).toBe("tab\tnewline\nbell\u0007");
  });
});

describe("sanitizeHtml", () => {
  it("drops a remote <img> and keeps the text around it (RD-058)", () => {
    const out = sanitizeHtml('<p>before <img src="https://tracker.example/pixel.png" alt="x"> after</p>');
    expect(out).not.toContain("<img");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("drops data:, protocol-relative and relative images, keeps an attachment image", () => {
    const out = sanitizeHtml(
      '<p><img src="data:image/png;base64,AAAA"><img src="//evil/x.png"><img src="x.png"><img src="/api/v1/attachments/att1/a.png" alt="ok"></p>',
    );
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(out).toContain('src="/api/v1/attachments/att1/a.png"');
  });

  it("removes script, style, iframes, SVG and other active or foreign content with what is inside", () => {
    const out = sanitizeHtml(
      "<p>a</p><script>alert(1)</script><style>p{}</style><iframe src=x></iframe><svg><text>s</text></svg><object>o</object><p>b</p>",
    );
    expect(out).toBe("<p>a</p><p>b</p>");
  });

  it("removes event handlers and URL-bearing attributes, keeps the schema's data attributes", () => {
    const out = sanitizeHtml('<p onclick="x()" data-indent="2" style="text-align:center">t<a href="https://a.example" onmouseover="y()" ping="https://p">l</a></p>');
    expect(out).not.toMatch(/onclick|onmouseover|ping=/);
    expect(out).toContain('data-indent="2"');
    expect(out).toContain('href="https://a.example"');
  });

  it("unwraps links the schema refuses, keeping their text", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "#frag", "relative/path", "//host/x"]) {
      const out = sanitizeHtml(`<p>see <a href="${href}">this</a></p>`);
      expect(out, href).toBe("<p>see this</p>");
    }
  });

  it("drops a code language class the server would refuse, keeps a good one", () => {
    const long = "x".repeat(65);
    expect(sanitizeHtml(`<pre><code class="language-${long}">a</code></pre>`)).toBe("<pre><code>a</code></pre>");
    expect(sanitizeHtml('<pre><code class="language-ts">a</code></pre>')).toBe('<pre><code class="language-ts">a</code></pre>');
  });

  it("strips U+0000 and half surrogates from the HTML too", () => {
    expect(sanitizeHtml(`<p>a\u0000b${HIGH}c</p>`)).toBe("<p>abc</p>");
  });

  it("turns marked's task lists into the schema's, when asked", () => {
    const out = sanitizeHtml('<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox" disabled> todo</li></ul>', {
      taskLists: true,
    });
    expect(out).toContain('data-type="taskList"');
    expect(out).toContain('data-checked="true"');
    expect(out).toContain('data-checked="false"');
    expect(out).not.toContain("<input");
  });
});

describe("cleanPastedSlice", () => {
  it("drops images of attachments this page does not have, keeps the others and the text", () => {
    const editor = newEditor();
    const schema = editor.schema;
    const image = (id: string) => schema.nodes.image?.create({ attachmentId: id, src: `/api/v1/attachments/${id}/a.png` });
    const paragraph = schema.nodes.paragraph?.create(null, [schema.text("a"), image("mine") as never, schema.text("b"), image("theirs") as never]);
    const slice = new Slice(schema.nodes.doc?.create(null, paragraph).content as never, 0, 0);
    const cleaned = cleanPastedSlice(slice, { keepImage: (id) => id === "mine" });
    const ids: string[] = [];
    cleaned.content.descendants((node) => {
      if (node.type.name === "image") ids.push(node.attrs.attachmentId as string);
    });
    expect(ids).toEqual(["mine"]);
    expect(cleaned.content.textBetween(0, cleaned.content.size)).toBe("ab");
  });

  it("clears a code block language the server would refuse, and leaves an unchanged slice alone", () => {
    const editor = newEditor();
    const schema = editor.schema;
    const bad = schema.nodes.codeBlock?.create({ language: "a b" }, schema.text("x"));
    const good = schema.nodes.codeBlock?.create({ language: "ts" }, schema.text("y"));
    const slice = new Slice(schema.nodes.doc?.create(null, [bad as never, good as never]).content as never, 0, 0);
    const cleaned = cleanPastedSlice(slice, { keepImage: () => true });
    expect(cleaned.content.child(0).attrs.language).toBeNull();
    expect(cleaned.content.child(1).attrs.language).toBe("ts");
    const fine = new Slice(schema.nodes.doc?.create(null, [good as never]).content as never, 0, 0);
    expect(cleanPastedSlice(fine, { keepImage: () => true })).toBe(fine);
  });

  it("imageAttachmentIds lists the images a document references", () => {
    const editor = newEditor(
      doc(p(text("a"), { type: "image", attrs: { attachmentId: "att1", src: "/api/v1/attachments/att1/a.png" } }), p({ type: "image", attrs: { attachmentId: "att2", src: "/api/v1/attachments/att2/b.png" } })),
    );
    expect([...imageAttachmentIds(editor.state.doc)].sort()).toEqual(["att1", "att2"]);
  });
});

describe("filesToUpload", () => {
  const png = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });

  it("uploads files that come alone (a copied image, a file from the desktop)", () => {
    expect(filesToUpload(clipboard({}, [png]))).toEqual([png]);
  });

  it("does not upload when text comes with the files (a spreadsheet's cells come with a picture of them)", () => {
    expect(filesToUpload(clipboard({ "text/plain": "A1\tB1" }, [png]))).toEqual([]);
  });

  it("uploads nothing without files, or without a transfer", () => {
    expect(filesToUpload(clipboard({ "text/plain": "x" }))).toEqual([]);
    expect(filesToUpload(null)).toEqual([]);
    expect(filesToUpload(undefined)).toEqual([]);
  });

  it("treats a getData that throws as no text", () => {
    const transfer = {
      files: Object.assign([png], { item: () => png }) as unknown as FileList,
      getData: () => {
        throw new Error("denied");
      },
    };
    expect(filesToUpload(transfer)).toEqual([png]);
  });
});

describe("a hostile data-pm-slice context (RD-085)", () => {
  // ProseMirror builds the context's wrapper nodes with type.create(attrs): no parseHTML rule runs.
  const hostile = (context: string) => `<span data-pm-slice='2 2 ${context}'>Pasted</span>`;

  it("sanitizeHtml keeps the two open depths and drops the context", () => {
    const out = sanitizeHtml(hostile('["blockquote",{},"paragraph",{"textAlign":"left;position:fixed"}]'));
    expect(out).toContain('data-pm-slice="2 2 []"');
    expect(out).not.toContain("position:fixed");
    expect(sanitizeHtml('<p data-pm-slice="garbage [">x</p>')).not.toContain("data-pm-slice");
  });

  it.each([
    ['a style smuggled through textAlign', '["blockquote",{},"paragraph",{"textAlign":"left;position:fixed;inset:0;background:url(https://evil.example/x)"}]'],
    ["an out-of-range heading level", '["heading",{"level":9}]'],
    ["a task item with a non-boolean checked", '["taskList",{},"taskItem",{"checked":"yes"}]'],
  ])("pasting %s leaves a document the server accepts, with no style or remote URL", (_label, context) => {
    const editor = newEditor(doc(p()));
    editor.view.pasteHTML(hostile(context), pasteEvent({}));
    expectStorable(editor);
    const html = editor.view.dom.innerHTML;
    expect(html).not.toContain("position");
    expect(html).not.toContain("evil.example");
    expect(editor.getText()).toBe("Pasted");
  });
});

describe("pasting into the editor", () => {
  it("strips U+0000 and half an emoji from pasted plain text (transformPastedText)", () => {
    const editor = newEditor(doc(p()));
    editor.view.pasteText(`a\u0000b${HIGH}c ${HIGH}${LOW}`, pasteEvent({}));
    expect(editor.getText()).toBe("abc 😀");
    expectStorable(editor);
  });

  it("keeps the text of pasted HTML and drops its remote image (RD-058)", () => {
    const editor = newEditor(doc(p()));
    editor.view.pasteHTML('<p>before <img src="https://example.com/a.png"> after</p>', pasteEvent({}));
    expect(json(editor)).not.toContain('"image"');
    expect(editor.getText()).toBe("before after"); // the parser collapses HTML whitespace
    expectStorable(editor);
  });

  it("keeps a pasted image of this page's attachment, drops one of another page's", () => {
    const ui = new EditorUiBridge();
    ui.rememberAttachment("mine");
    const editor = newEditor(doc(p()), ui);
    editor.view.pasteHTML('<p>x<img src="/api/v1/attachments/mine/a.png">y<img src="/api/v1/attachments/theirs/b.png">z</p>', pasteEvent({}));
    const ids = [...imageAttachmentIds(editor.state.doc)];
    expect(ids).toEqual(["mine"]);
    expect(editor.getText()).toBe("xyz");
  });

  it("normalises a pasted code block's over-long language, so the next autosave is not a 422 (RD-068)", () => {
    const editor = newEditor(doc(p()));
    editor.view.pasteHTML(`<pre><code class="language-${"k".repeat(200)}">let x = 1;</code></pre>`, pasteEvent({}));
    const block = editor.state.doc.firstChild;
    expect(block?.type.name).toBe("codeBlock");
    expect(block?.attrs.language).toBeNull();
    expectStorable(editor);
  });

  it("a paste from VS Code becomes a code block with a checked language and stripped text", () => {
    const editor = newEditor(doc(p()));
    const ok = pasteFromCodeEditor(editor.view, clipboard({ "vscode-editor-data": JSON.stringify({ mode: "typescript" }), "text/plain": `const a\u0000 = 1;\r\nb${HIGH}` }));
    expect(ok).toBe(true);
    const block = editor.state.doc.firstChild;
    expect(block?.type.name).toBe("codeBlock");
    expect(block?.attrs.language).toBe("typescript");
    expect(block?.textContent).toBe("const a = 1;\nb");
    expectStorable(editor);
  });

  it("a VS Code mode the server would refuse becomes no language", () => {
    const editor = newEditor(doc(p()));
    pasteFromCodeEditor(editor.view, clipboard({ "vscode-editor-data": JSON.stringify({ mode: "m".repeat(100) }), "text/plain": "x" }));
    expect(editor.state.doc.firstChild?.attrs.language).toBeNull();
    expectStorable(editor);
  });

  it("the VS Code path declines junk and leaves the paste to the normal path", () => {
    const editor = newEditor(doc(p()));
    expect(pasteFromCodeEditor(editor.view, clipboard({ "vscode-editor-data": "{not json", "text/plain": "x" }))).toBe(false);
    expect(pasteFromCodeEditor(editor.view, clipboard({ "text/plain": "x" }))).toBe(false);
    expect(pasteFromCodeEditor(editor.view, null)).toBe(false);
  });

  it("pasted files go to the upload path, and their text is not pasted", () => {
    const ui = new EditorUiBridge();
    const uploadFiles = vi.fn();
    ui.setHandlers({ uploadFiles });
    const editor = newEditor(doc(p(text("x"))), ui);
    const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });
    const handled = editor.view.someProp("handlePaste", (f) => f(editor.view, pasteEvent({}, [file]), Slice.empty));
    expect(handled).toBe(true);
    expect(uploadFiles).toHaveBeenCalledWith([file], null);
  });

  it("dropped files go to the upload path at the drop point; a move inside the editor does not", () => {
    const ui = new EditorUiBridge();
    const uploadFiles = vi.fn();
    ui.setHandlers({ uploadFiles });
    const editor = newEditor(doc(p(text("x"))), ui);
    const file = new File([new Uint8Array([1])], "spec.pdf", { type: "application/pdf" });
    editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
    const drop = { dataTransfer: clipboard({}, [file]), clientX: 1, clientY: 1 } as unknown as DragEvent;
    expect(editor.view.someProp("handleDrop", (f) => f(editor.view, drop, Slice.empty, false))).toBe(true);
    expect(uploadFiles).toHaveBeenCalledWith([file], 1);
    uploadFiles.mockClear();
    expect(editor.view.someProp("handleDrop", (f) => f(editor.view, drop, Slice.empty, true)) ?? false).toBe(false);
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it("without an upload handler (headless), pasted files are left to ProseMirror", () => {
    const editor = newEditor(doc(p(text("x"))));
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    expect(editor.view.someProp("handlePaste", (f) => f(editor.view, pasteEvent({}, [file]), Slice.empty)) ?? false).toBe(false);
  });
});

describe("the paste backstop", () => {
  it("clears a refused code language that a paste handler wrote past every transform (RD-068)", () => {
    const editor = newEditor(doc(p()));
    const codeBlock = editor.schema.nodes.codeBlock;
    if (!codeBlock) throw new Error("no codeBlock");
    editor.view.dispatch(editor.state.tr.replaceSelectionWith(codeBlock.create({ language: "z".repeat(100) })).setMeta("paste", true));
    expect(editor.state.doc.firstChild?.attrs.language).toBeNull();
    expectStorable(editor);
  });

  it("leaves typed edits alone (it only runs after a paste or a drop)", () => {
    const editor = newEditor(doc(p()));
    const codeBlock = editor.schema.nodes.codeBlock;
    if (!codeBlock) throw new Error("no codeBlock");
    editor.view.dispatch(editor.state.tr.replaceSelectionWith(codeBlock.create({ language: "ts" })));
    expect(editor.state.doc.firstChild?.attrs.language).toBe("ts");
  });
});
