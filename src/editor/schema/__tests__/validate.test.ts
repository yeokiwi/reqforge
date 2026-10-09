import { describe, expect, it } from "vitest";
import {
  MARK_ATTRIBUTE_RULES,
  MARK_NAMES,
  MAX_DOCUMENT_BYTES,
  MAX_NODE_DEPTH,
  MAX_REPORTED_ERRORS,
  NODE_ATTRIBUTE_RULES,
  NODE_NAMES,
  documentSchema,
  emptyDocument,
  validateDocumentJson,
  type ValidationResult,
} from "..";
import { ATTACHMENT_ID, IMAGE_SRC, USER_ID, doc, h, imageDoc, kitchenSink, linkDoc, p, text, typesUsed } from "./fixtures";

function expectFailure(result: ValidationResult, reason: string, path?: string) {
  if (result.ok) throw new Error(`expected ${reason}, but the document validated`);
  expect(result.reason).toBe(reason);
  if (path !== undefined) expect(result.errors.map((e) => e.path)).toContain(path);
}

function para(attrs: Record<string, unknown>) {
  return doc({ type: "paragraph", attrs, content: [text("x")] } as never);
}

function inline(node: Record<string, unknown>) {
  return doc(p(node as never));
}

describe("validateDocumentJson — accepts", () => {
  it("a document using every node and every mark of the schema", () => {
    const result = validateDocumentJson(kitchenSink(), { allowedAttachmentIds: new Set([ATTACHMENT_ID]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const used = typesUsed(result.doc);
    expect([...used.nodes].sort()).toEqual([...NODE_NAMES].sort());
    expect([...used.marks].sort()).toEqual([...MARK_NAMES].sort());
    expect(result.bytes).toBe(new TextEncoder().encode(JSON.stringify(result.doc)).length);
  });

  it("a table row with no cells: the row a whole-row merge leaves behind (RD-065)", () => {
    // One cell spanning both rows; the second row holds nothing because the cell above covers it.
    const merged = doc({
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 2 }, content: [p(text("merged"))] }] },
        { type: "tableRow", content: [] },
      ],
    } as never);
    const result = validateDocumentJson(merged);
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDocumentJson(result.doc)).toMatchObject({ ok: true, doc: result.doc });
  });

  it("the empty document, which is already canonical", () => {
    const empty = emptyDocument();
    expect(empty).toEqual({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: null, indent: 0 } }] });
    const result = validateDocumentJson(empty);
    expect(result.ok && result.doc).toEqual(empty);
    expect(emptyDocument()).not.toBe(empty);
  });

  it.each([
    ["https://example.com"],
    ["http://example.com/a?b=1#c"],
    ["HTTPS://EXAMPLE.COM/"],
    ["mailto:someone@example.com"],
    ["tel:+15551234567"],
    ["/spaces/TEAM/pages/1"],
    ["/"],
  ])("link href %j", (href) => {
    expect(validateDocumentJson(linkDoc(href)).ok).toBe(true);
  });

  it.each([["2026-10-09"], ["2024-02-29"], ["2000-02-29"], ["0001-01-01"], ["9999-12-31"]])("date %s", (value) => {
    expect(validateDocumentJson(inline({ type: "date", attrs: { value } })).ok).toBe(true);
  });

  it("status text of exactly 60 characters, counting an emoji as one", () => {
    const sixty = `${"x".repeat(59)}🙂`;
    expect(validateDocumentJson(inline({ type: "status", attrs: { text: sixty, colour: "green" } })).ok).toBe(true);
  });

  it("an image whose attachment is on the page", () => {
    const image = { attachmentId: ATTACHMENT_ID, src: IMAGE_SRC };
    expect(validateDocumentJson(imageDoc(image), { allowedAttachmentIds: new Set([ATTACHMENT_ID]) }).ok).toBe(true);
    // Without a context the id's membership is not checked, only its shape.
    expect(validateDocumentJson(imageDoc(image)).ok).toBe(true);
    // A percent-encoded filename is one segment.
    const encoded = { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/my%20file%20%E6%97%A5.png` };
    expect(validateDocumentJson(imageDoc(encoded)).ok).toBe(true);
  });

  it("colours in either case, and cell colwidths as non-negative numbers", () => {
    const table = (attrs: Record<string, unknown>) =>
      doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs, content: [p()] }] }] } as never);
    expect(validateDocumentJson(table({ background: "#AbCdEf" })).ok).toBe(true);
    expect(validateDocumentJson(table({ colspan: 2, colwidth: [0, 120.5] })).ok).toBe(true);
  });

  it("nodes nested exactly 64 deep (doc counts as 1)", () => {
    // doc(1) > 61 blockquotes (2..62) > paragraph (63) > text (64)
    let node: unknown = p(text("deep"));
    for (let i = 0; i < MAX_NODE_DEPTH - 3; i++) node = { type: "blockquote", content: [node] };
    expect(validateDocumentJson(doc(node as never)).ok).toBe(true);
  });

  it("a document of exactly 5 MiB, measured as UTF-8 JSON", () => {
    for (const filler of ["a", "日", '"', "\n", "\u0001", "🙂"]) {
      const shell = JSON.stringify({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: null, indent: 0 }, content: [{ type: "text", text: "" }] }] });
      const unit = new TextEncoder().encode(JSON.stringify(filler)).length - 2;
      const room = MAX_DOCUMENT_BYTES - new TextEncoder().encode(shell).length;
      const pad = "a".repeat(room % unit);
      const body = pad + filler.repeat(Math.floor(room / unit));
      const input = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: null, indent: 0 }, content: [{ type: "text", text: body }] }] };
      expect(new TextEncoder().encode(JSON.stringify(input)).length).toBe(MAX_DOCUMENT_BYTES);
      const ok = validateDocumentJson(input);
      expect(ok.ok && ok.bytes, `filler ${JSON.stringify(filler)}`).toBe(MAX_DOCUMENT_BYTES);

      const over = { ...input, content: [{ ...input.content[0], content: [{ type: "text", text: `${body}a` }] }] };
      expectFailure(validateDocumentJson(over), "TOO_LARGE");
    }
  });
});

describe("validateDocumentJson — refuses hostile shapes as MALFORMED", () => {
  class Doc {
    type = "doc";
  }
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", '{"type":"doc"}'],
    ["a boolean", true],
    ["an array", [{ type: "doc" }]],
    ["a Date", new Date(0)],
    ["a Map", new Map([["type", "doc"]])],
    ["a class instance", new Doc()],
  ])("%s", (_label, input) => {
    expectFailure(validateDocumentJson(input), "MALFORMED", "");
  });

  it("a cycle through content", () => {
    const d: Record<string, unknown> = { type: "doc", content: [] };
    (d.content as unknown[]).push(d);
    expectFailure(validateDocumentJson(d), "MALFORMED", "/content/0");
  });

  it("a cycle through attrs", () => {
    const attrs: Record<string, unknown> = {};
    attrs.self = attrs;
    expectFailure(validateDocumentJson(doc({ type: "paragraph", attrs } as never)), "MALFORMED", "/content/0/attrs/self");
  });

  it.each([
    ["a function", () => 1],
    ["a symbol", Symbol("x")],
    ["a bigint", BigInt(1)],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("%s as a value", (_label, value) => {
    expectFailure(validateDocumentJson(para({ indent: value })), "MALFORMED", "/content/0/attrs/indent");
  });

  it("a toJSON method (JSON.stringify would call it)", () => {
    expectFailure(validateDocumentJson({ type: "doc", content: [p()], toJSON: () => ({}) }), "MALFORMED", "/toJSON");
  });

  it("a getter that throws", () => {
    const input = { type: "doc" } as Record<string, unknown>;
    Object.defineProperty(input, "content", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expectFailure(validateDocumentJson(input), "MALFORMED");
  });

  it("a sparse array (holes are not JSON)", () => {
    expectFailure(validateDocumentJson({ type: "doc", content: new Array(2 ** 32 - 1) }), "MALFORMED", "/content/0");
  });

  it("ignores own __proto__ keys from JSON.parse and drops them", () => {
    const input: unknown = JSON.parse(
      '{"type":"doc","__proto__":{"polluted":true},"content":[{"type":"paragraph","attrs":{"__proto__":{"x":1}}}]}',
    );
    const result = validateDocumentJson(input);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok && result.doc)).not.toContain("__proto__");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// Postgres `jsonb` refuses `\u0000` ("cannot be converted to text") and unpaired UTF-16
// surrogates, which JSON.stringify writes as `\udXXX` escapes. A client slicing a string
// between the two halves of an emoji produces the latter. Validated content must be storable
// (RD-063), so both are refused here, wherever the string sits. The storability of what
// passes is checked against a real Postgres in storable.integration.test.ts.
describe("validateDocumentJson — refuses strings Postgres jsonb cannot store (RD-063)", () => {
  const NUL = "\u0000";
  const HIGH = "\ud83d"; // first half of 🙂
  const LOW = "\ude42"; // second half of 🙂
  const textPath = "/content/0/content/0/text";
  const attrPath = (name: string) => `/content/0/content/0/attrs/${name}`;

  it.each<[string, unknown, string]>([
    ["U+0000 in text", doc(p(text(`a${NUL}b`))), textPath],
    ["a lone high surrogate in text (an emoji split in half)", doc(p(text(`a${HIGH}b`))), textPath],
    ["a lone low surrogate in text", doc(p(text(`a${LOW}b`))), textPath],
    ["a high surrogate as the last character", doc(p(text(`a${HIGH}`))), textPath],
    ["a low surrogate as the first character", doc(p(text(`${LOW}a`))), textPath],
    ["a pair written low then high", doc(p(text(`${LOW}${HIGH}`))), textPath],
    ["two highs before one low", doc(p(text(`${HIGH}${HIGH}${LOW}`))), textPath],
    ["U+0000 in a mention label", inline({ type: "mention", attrs: { userId: USER_ID, label: `Al${NUL}` } }), attrPath("label")],
    ["a lone surrogate in a link href", linkDoc(`/a${LOW}`), "/content/0/content/0/marks/0/attrs/href"],
    ["U+0000 in an image alt", imageDoc({ attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, alt: `x${NUL}` }), attrPath("alt")],
    ["a lone surrogate in an image title", imageDoc({ attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, title: `x${HIGH}` }), attrPath("title")],
    ["a lone surrogate in status text", inline({ type: "status", attrs: { text: `OK${HIGH}`, colour: "green" } }), attrPath("text")],
    ["U+0000 in a code block", doc({ type: "codeBlock", content: [text(`a${NUL}`)] } as never), textPath],
    ["U+0000 in a node type", doc({ type: `paragraph${NUL}` } as never), "/content/0/type"],
    ["U+0000 in an unknown attribute, which canonicalisation would drop", para({ junk: `x${NUL}` }), "/content/0/attrs/junk"],
  ])("%s", (_label, input, path) => {
    const result = validateDocumentJson(input);
    expectFailure(result, "MALFORMED", path);
    if (!result.ok) expect(result.errors).toHaveLength(1);
  });

  it("accepts surrogate pairs, other control characters and the literal text \\u0000", () => {
    const input = doc(
      p(text(`🙂 a\u0001b ${HIGH}${LOW} \\u0000 𐀀 􏿿`)),
      p({ type: "mention", attrs: { userId: USER_ID, label: "Al 🙂" } } as never),
      p(text("x", [{ type: "link", attrs: { href: "/a/🙂" } }])),
    );
    const result = validateDocumentJson(input);
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
  });
});

describe("validateDocumentJson — limits are enforced before parsing", () => {
  it("TOO_DEEP one node past 64", () => {
    let node: unknown = p(text("deep"));
    for (let i = 0; i < MAX_NODE_DEPTH - 2; i++) node = { type: "blockquote", content: [node] };
    expectFailure(validateDocumentJson(doc(node as never)), "TOO_DEEP");
  });

  it("TOO_DEEP for 100 000 levels, without exhausting the stack", () => {
    let node: unknown = { type: "paragraph" };
    for (let i = 0; i < 100_000; i++) node = { type: "blockquote", content: [node] };
    const started = Date.now();
    expectFailure(validateDocumentJson(doc(node as never)), "TOO_DEEP");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("TOO_DEEP for deep nesting hidden in attrs", () => {
    let value: Record<string, unknown> = {};
    for (let i = 0; i < 10_000; i++) value = { x: value };
    expectFailure(validateDocumentJson(para({ junk: value })), "TOO_DEEP");
  });

  it("TOO_LARGE for one oversized text node, without scanning it all", () => {
    const big = "x".repeat(MAX_DOCUMENT_BYTES + 1);
    expectFailure(validateDocumentJson(doc(p(text(big)))), "TOO_LARGE", "");
  });

  it("TOO_LARGE for a huge flat array, early", () => {
    const one = p(text("a"));
    const content = new Array<unknown>(3_000_000).fill(one);
    const started = Date.now();
    expectFailure(validateDocumentJson({ type: "doc", content }), "TOO_LARGE");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("TOO_LARGE for an exponential graph of shared references (no 2^40 walk)", () => {
    let node: unknown = p(text("a"));
    for (let i = 0; i < 40; i++) node = { type: "blockquote", content: [node, node] };
    const started = Date.now();
    expectFailure(validateDocumentJson(doc(node as never)), "TOO_LARGE");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("TOO_LARGE for an input over 5 MiB even though its canonical form would be tiny", () => {
    // Unknown attributes are dropped by canonicalisation; they are not a way round the limit.
    // Three-byte characters: the limit is on UTF-8 bytes, not on string length.
    const junk = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`junk${i}`, "日".repeat(20_000)]));
    const input = doc({ type: "paragraph", attrs: junk, content: [text("x")] } as never);
    expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeGreaterThan(MAX_DOCUMENT_BYTES);
    expectFailure(validateDocumentJson(input), "TOO_LARGE", "");
  });

  it("TOO_LARGE when the canonical form outgrows 5 MiB although the input did not", () => {
    // `{"type":"paragraph"}` gains `"attrs":{"textAlign":null,"indent":0}` when canonicalised.
    const n = Math.floor(MAX_DOCUMENT_BYTES / 21) - 10;
    const content = Array.from({ length: n }, () => ({ type: "paragraph" }));
    expect(new TextEncoder().encode(JSON.stringify({ type: "doc", content })).length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    expectFailure(validateDocumentJson({ type: "doc", content }), "TOO_LARGE");
  });
});

describe("validateDocumentJson — SCHEMA", () => {
  it.each<[string, unknown, string]>([
    ["a top-level paragraph", p(text("x")), "/type"],
    ["a node without a type", doc({} as never), "/content/0"],
    ["an unknown node type", doc({ type: "script" } as never), "/content/0/type"],
    ["an unknown mark type", doc(p(text("x", [{ type: "blink" }]))), "/content/0/content/0/marks/0/type"],
    ["content that is not an array", { type: "doc", content: { 0: p() } }, "/content"],
    ["marks that are not an array", doc(p({ type: "text", text: "x", marks: { type: "bold" } } as never)), "/content/0/content/0/marks"],
    ["attrs that are not an object", doc({ type: "paragraph", attrs: [1] } as never), "/content/0/attrs"],
    ["an empty text node", doc(p(text(""))), "/content/0/content/0/text"],
    ["a text node with content", doc(p({ type: "text", text: "x", content: [] } as never)), "/content/0/content/0/content"],
    ["an empty doc", { type: "doc", content: [] }, ""],
    ["a doc with no content key", { type: "doc" }, ""],
    ["text directly in doc", doc(text("x")), ""],
    ["a paragraph inside a paragraph", doc(p(p(text("x")) as never)), "/content/0"],
    ["a list item that does not start with a paragraph", doc({ type: "bulletList", content: [{ type: "listItem", content: [{ type: "horizontalRule" }] }] } as never), "/content/0/content/0"],
    ["an empty bullet list", doc({ type: "bulletList", content: [] } as never), "/content/0"],
    ["a hard break with content", doc(p({ type: "hardBreak", content: [text("x")] } as never)), "/content/0/content/0"],
    ["a mark in a code block", doc({ type: "codeBlock", content: [text("x", [{ type: "bold" }])] } as never), "/content/0/content/0/marks"],
    ["bold combined with code", doc(p(text("x", [{ type: "bold" }, { type: "code" }]))), "/content/0/content/0/marks"],
    ["marks on a block node", doc({ type: "paragraph", marks: [{ type: "bold" }] } as never), "/content/0/marks"],
    ["a nested doc", doc({ type: "doc", content: [p()] } as never), "/content/0/type"],
  ])("%s", (_label, input, path) => {
    expectFailure(validateDocumentJson(input), "SCHEMA", path);
  });

  it("reports paths into the input even after adjacent text nodes merge", () => {
    // Children 0 and 1 merge into one text node; the bad mark set is on raw child 3.
    const input = doc(p(text("a"), text("b"), { type: "hardBreak" }, text("c", [{ type: "bold" }, { type: "code" }])));
    expectFailure(validateDocumentJson(input), "SCHEMA", "/content/0/content/3/marks");
  });
});

describe("validateDocumentJson — RULE: attribute values", () => {
  const table = (cellAttrs: Record<string, unknown>, tableAttrs: Record<string, unknown> = {}) =>
    doc({ type: "table", attrs: tableAttrs, content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: cellAttrs, content: [p()] }] }] } as never);
  const cellPath = "/content/0/content/0/content/0/attrs";

  it.each<[string, unknown, string]>([
    ["heading level 7", doc({ type: "heading", attrs: { level: 7 } } as never), "/content/0/attrs/level"],
    ["heading level 0", doc({ type: "heading", attrs: { level: 0 } } as never), "/content/0/attrs/level"],
    ["heading level as a string", doc({ type: "heading", attrs: { level: "2" } } as never), "/content/0/attrs/level"],
    ["heading level null", doc({ type: "heading", attrs: { level: null } } as never), "/content/0/attrs/level"],
    ["textAlign middle", para({ textAlign: "middle" }), "/content/0/attrs/textAlign"],
    ["indent 7", para({ indent: 7 }), "/content/0/attrs/indent"],
    ["indent -1", para({ indent: -1 }), "/content/0/attrs/indent"],
    ["indent 1.5", para({ indent: 1.5 }), "/content/0/attrs/indent"],
    ["code language with a space", doc({ type: "codeBlock", attrs: { language: "java script" } } as never), "/content/0/attrs/language"],
    ["code language as an object", doc({ type: "codeBlock", attrs: { language: { x: 1 } } } as never), "/content/0/attrs/language"],
    ["ordered list start -1", doc({ type: "orderedList", attrs: { start: -1 }, content: [{ type: "listItem", content: [p()] }] } as never), "/content/0/attrs/start"],
    ["ordered list start 1.5", doc({ type: "orderedList", attrs: { start: 1.5 }, content: [{ type: "listItem", content: [p()] }] } as never), "/content/0/attrs/start"],
    ["task item checked as a string", doc({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: "yes" }, content: [p()] }] } as never), "/content/0/content/0/attrs/checked"],
    ["table widthMode auto", table({}, { widthMode: "auto" }), "/content/0/attrs/widthMode"],
    ["table numberedColumn as a string", table({}, { numberedColumn: "true" }), "/content/0/attrs/numberedColumn"],
    ["cell colspan 0", table({ colspan: 0 }), `${cellPath}/colspan`],
    ["cell colspan 1001", table({ colspan: 1001 }), `${cellPath}/colspan`],
    ["cell rowspan 0", table({ rowspan: 0 }), `${cellPath}/rowspan`],
    ["colwidth of the wrong length", table({ colspan: 2, colwidth: [100] }), `${cellPath}/colwidth`],
    ["colwidth with a string", table({ colwidth: ["100"] }), `${cellPath}/colwidth`],
    ["colwidth negative", table({ colwidth: [-5] }), `${cellPath}/colwidth`],
    ["background as a name", table({ background: "red" }), `${cellPath}/background`],
    ["background #fff", table({ background: "#fff" }), `${cellPath}/background`],
    ["background with CSS injection", table({ background: "#ffffff; background-image: url(x)" }), `${cellPath}/background`],
    ["panel variant tip", doc({ type: "infoPanel", attrs: { variant: "tip" }, content: [p()] } as never), "/content/0/attrs/variant"],
    ["toc minLevel 0", doc({ type: "tableOfContents", attrs: { minLevel: 0 } } as never), "/content/0/attrs/minLevel"],
    ["toc maxLevel 7", doc({ type: "tableOfContents", attrs: { maxLevel: 7 } } as never), "/content/0/attrs/maxLevel"],
    ["toc minLevel above maxLevel", doc({ type: "tableOfContents", attrs: { minLevel: 4, maxLevel: 2 } } as never), "/content/0/attrs/minLevel"],
    ["status with no text", inline({ type: "status", attrs: { colour: "red" } }), "/content/0/content/0/attrs/text"],
    ["status with blank text", inline({ type: "status", attrs: { text: "   " } }), "/content/0/content/0/attrs/text"],
    ["status with 61 characters", inline({ type: "status", attrs: { text: "x".repeat(61) } }), "/content/0/content/0/attrs/text"],
    ["status over two lines", inline({ type: "status", attrs: { text: "TO\nDO" } }), "/content/0/content/0/attrs/text"],
    ["status colour orange", inline({ type: "status", attrs: { text: "OK", colour: "orange" } }), "/content/0/content/0/attrs/colour"],
    ["date 2026-02-29", inline({ type: "date", attrs: { value: "2026-02-29" } }), "/content/0/content/0/attrs/value"],
    ["date 1900-02-29", inline({ type: "date", attrs: { value: "1900-02-29" } }), "/content/0/content/0/attrs/value"],
    ["date 2026-04-31", inline({ type: "date", attrs: { value: "2026-04-31" } }), "/content/0/content/0/attrs/value"],
    ["date 2026-13-01", inline({ type: "date", attrs: { value: "2026-13-01" } }), "/content/0/content/0/attrs/value"],
    ["date 2026-00-10", inline({ type: "date", attrs: { value: "2026-00-10" } }), "/content/0/content/0/attrs/value"],
    ["date 0000-01-01", inline({ type: "date", attrs: { value: "0000-01-01" } }), "/content/0/content/0/attrs/value"],
    ["date 2026-10-9", inline({ type: "date", attrs: { value: "2026-10-9" } }), "/content/0/content/0/attrs/value"],
    ["date with a time", inline({ type: "date", attrs: { value: "2026-10-09T00:00:00Z" } }), "/content/0/content/0/attrs/value"],
    ["date with Arabic-Indic digits", inline({ type: "date", attrs: { value: "٢٠٢٦-١٠-٠٩" } }), "/content/0/content/0/attrs/value"],
    ["date missing", inline({ type: "date" }), "/content/0/content/0/attrs/value"],
    ["mention without userId", inline({ type: "mention", attrs: { label: "Albert" } }), "/content/0/content/0/attrs/userId"],
    ["mention userId with a slash", inline({ type: "mention", attrs: { userId: "a/b", label: "Albert" } }), "/content/0/content/0/attrs/userId"],
    ["mention with an empty label", inline({ type: "mention", attrs: { userId: USER_ID, label: "" } }), "/content/0/content/0/attrs/label"],
    ["textStyle colour red", doc(p(text("x", [{ type: "textStyle", attrs: { color: "red" } }]))), "/content/0/content/0/marks/0/attrs/color"],
    ["textStyle colour with injection", doc(p(text("x", [{ type: "textStyle", attrs: { color: "#000000;position:fixed" } }]))), "/content/0/content/0/marks/0/attrs/color"],
    ["image alt as a number", imageDoc({ attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, alt: 5 }), "/content/0/content/0/attrs/alt"],
    ["image width 0", imageDoc({ attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, width: 0 }), "/content/0/content/0/attrs/width"],
    ["image width as a string", imageDoc({ attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, width: "100%" }), "/content/0/content/0/attrs/width"],
  ])("%s", (_label, input, path) => {
    expectFailure(validateDocumentJson(input), "RULE", path);
  });

  it("collects every error, capped with a note", () => {
    const content = Array.from({ length: 200 }, () => ({ type: "heading", attrs: { level: 9 } }));
    const result = validateDocumentJson({ type: "doc", content });
    expectFailure(result, "RULE", "/content/199/attrs/level".replace("199", "0"));
    if (!result.ok) {
      expect(result.errors).toHaveLength(MAX_REPORTED_ERRORS + 1);
      expect(result.errors[1]?.path).toBe("/content/1/attrs/level");
    }
  });

  it("has a rule for every attribute of every node and mark", () => {
    for (const [name, type] of Object.entries(documentSchema.nodes)) {
      const attrs = Object.keys(type.spec.attrs ?? {});
      expect(Object.keys(NODE_ATTRIBUTE_RULES[name] ?? { missing: true }).sort(), `node ${name}`).toEqual(attrs.sort());
    }
    for (const [name, type] of Object.entries(documentSchema.marks)) {
      const attrs = Object.keys(type.spec.attrs ?? {});
      expect(Object.keys(MARK_ATTRIBUTE_RULES[name] ?? { missing: true }).sort(), `mark ${name}`).toEqual(attrs.sort());
    }
  });
});

describe("validateDocumentJson — RULE: links (RD-063)", () => {
  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    [" javascript:alert(1)"],
    ["javascript:alert(1) "],
    ["java\tscript:alert(1)"],
    ["java\nscript:alert(1)"],
    ["java\rscript:alert(1)"],
    ["\u0001javascript:alert(1)"],
    ["jav&#x09;ascript:alert(1)"],
    ["javascript%3Aalert(1)"],
    ["\u200bjavascript:alert(1)"],
    ["data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["DATA:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["ftp://example.com/"],
    ["//evil.example/path"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["https:\\\\evil.example"],
    ["/\t/evil.example"],
    ["https://exa mple.com"],
    ["https://example.com/\u202egnp.exe"],
    // DEL, the C1 controls and NBSP, in places the URL parser would otherwise accept or
    // percent-encode: a path, an internal path and a mailto address.
    ["https://example.com/a\u007fb"],
    ["https://example.com/a\u0080b"],
    ["https://example.com/a\u0085b"],
    ["https://example.com/a\u009fb"],
    ["https://example.com/\u00a0x"],
    ["/spaces\u00a0/TEAM"],
    ["/a\u0085b"],
    ["mailto:a\u00a0b@example.com"],
    ["tel:+1\u00a0555"],
    ["http://"],
    ["https:"],
    ["mailto:"],
    ["#anchor"],
    ["?query"],
    ["relative/path"],
    ["example.com"],
    [""],
  ])("refuses %j", (href) => {
    expectFailure(validateDocumentJson(linkDoc(href)), "RULE", "/content/0/content/0/marks/0/attrs/href");
  });

  it("refuses a target with U+0000 before any rule runs: Postgres could not store it", () => {
    expectFailure(validateDocumentJson(linkDoc("\u0000javascript:alert(1)")), "MALFORMED", "/content/0/content/0/marks/0/attrs/href");
  });

  it.each([[null], [42], [{ href: "https://example.com" }]])("refuses a non-string href %j", (href) => {
    expectFailure(validateDocumentJson(linkDoc(href)), "RULE", "/content/0/content/0/marks/0/attrs/href");
  });

  it("refuses a link with no attrs at all", () => {
    expectFailure(validateDocumentJson(doc(p(text("x", [{ type: "link" }])))), "RULE", "/content/0/content/0/marks/0/attrs/href");
  });

  it("finds the offending mark by its index in the input, not in schema order", () => {
    const input = doc(p(text("x", [{ type: "bold" }, { type: "italic" }, { type: "link", attrs: { href: "javascript:x" } }])));
    expectFailure(validateDocumentJson(input), "RULE", "/content/0/content/0/marks/2/attrs/href");
  });
});

describe("validateDocumentJson — RULE: images (RD-058)", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["an external URL", { attachmentId: ATTACHMENT_ID, src: "https://tracker.example/pixel.png" }, "src"],
    ["a data: URL", { attachmentId: ATTACHMENT_ID, src: "data:image/png;base64,AAAA" }, "src"],
    ["a protocol-relative URL", { attachmentId: ATTACHMENT_ID, src: `//evil.example/api/v1/attachments/${ATTACHMENT_ID}/x.png` }, "src"],
    ["another attachment's URL", { attachmentId: ATTACHMENT_ID, src: "/api/v1/attachments/clother000000000000000001/x.png" }, "src"],
    ["a URL with a query", { attachmentId: ATTACHMENT_ID, src: `${IMAGE_SRC}?v=2` }, "src"],
    ["a URL with a fragment", { attachmentId: ATTACHMENT_ID, src: `${IMAGE_SRC}#x` }, "src"],
    ["a dot-dot filename", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/..` }, "src"],
    // The WHATWG URL parser treats these as dot segments too, so the browser would fetch
    // /api/v1/attachments/ or /api/v1/attachments/{id}/ instead of the attachment.
    ["an encoded dot-dot filename", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/%2e%2e` }, "src"],
    ["a half-encoded dot-dot filename", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/.%2E` }, "src"],
    ["an encoded dot filename", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/%2E` }, "src"],
    ["an extra path segment", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/a/b.png` }, "src"],
    ["no filename", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/` }, "src"],
    ["a broken percent-encoding", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/%E0%A4%A.png` }, "src"],
    ["a filename with a space", { attachmentId: ATTACHMENT_ID, src: `/api/v1/attachments/${ATTACHMENT_ID}/my file.png` }, "src"],
    ["no attachmentId", { src: IMAGE_SRC }, "attachmentId"],
    ["an attachmentId with a slash", { attachmentId: "a/b", src: "/api/v1/attachments/a/b/x.png" }, "attachmentId"],
    ["no src", { attachmentId: ATTACHMENT_ID }, "src"],
  ])("refuses %s", (_label, attrs, attr) => {
    expectFailure(validateDocumentJson(imageDoc(attrs)), "RULE", `/content/0/content/0/attrs/${attr}`);
  });

  it("refuses an attachment that is not on this page", () => {
    const result = validateDocumentJson(imageDoc({ attachmentId: ATTACHMENT_ID, src: IMAGE_SRC }), {
      allowedAttachmentIds: new Set(["clsomethingelse0000000001"]),
    });
    expectFailure(result, "RULE", "/content/0/content/0/attrs/attachmentId");
  });
});

describe("validateDocumentJson — headings and ids in errors", () => {
  it("uses JSON Pointer paths such as /content/3/content/0", () => {
    const input = doc(p(), p(), p(), p(text("x", [{ type: "textStyle", attrs: { color: "blue" } }])));
    const result = validateDocumentJson(input);
    expectFailure(result, "RULE", "/content/3/content/0/marks/0/attrs/color");
    if (!result.ok) expect(result.errors).toHaveLength(1);
  });

  it("never echoes more than 60 characters of a hostile type name", () => {
    const result = validateDocumentJson(doc({ type: "x".repeat(10_000) } as never));
    expectFailure(result, "SCHEMA");
    if (!result.ok) expect(result.errors[0]?.message.length).toBeLessThan(120);
  });

  it("accepts a heading and keeps its level", () => {
    const result = validateDocumentJson(doc(h(3, text("Three"))));
    expect(result.ok && result.doc.content[0]?.attrs).toEqual({ textAlign: null, indent: 0, level: 3 });
  });
});
