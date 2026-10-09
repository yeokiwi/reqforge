import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateDocumentJson, type ValidationResult } from "..";
import type { MarkJson, NodeJson } from "../types";
import { ATTACHMENT_ID, doc, kitchenSink, p, text } from "./fixtures";

function canonical(input: unknown): NodeJson & { content: NodeJson[] } {
  const result = validateDocumentJson(input);
  if (!result.ok) throw new Error(`did not validate: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

function expectIdempotent(first: ValidationResult) {
  if (!first.ok) throw new Error(`did not validate: ${JSON.stringify(first.errors)}`);
  const second = validateDocumentJson(first.doc);
  if (!second.ok) throw new Error(`canonical output did not validate: ${JSON.stringify(second.errors)}`);
  expect(second.doc).toEqual(first.doc);
  expect(JSON.stringify(second.doc)).toBe(JSON.stringify(first.doc));
  expect(second.bytes).toBe(first.bytes);
}

describe("canonical form (03 §1.5)", () => {
  it("drops unknown attributes and unknown keys", () => {
    const out = canonical({
      type: "doc",
      extra: 1,
      content: [{ type: "paragraph", onclick: "x", attrs: { textAlign: "center", style: "x", class: "y" }, content: [text("a")] }],
    });
    expect(out).toEqual({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center", indent: 0 }, content: [{ type: "text", text: "a" }] }] });
  });

  it("drops a link's target, rel and class: only href is stored", () => {
    const out = canonical(doc(p(text("x", [{ type: "link", attrs: { href: "https://example.com", target: "_self", rel: "opener", class: "evil" } }]))));
    expect(out.content[0]?.content?.[0]?.marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
  });

  it("drops TipTap's ordered-list type attribute", () => {
    const out = canonical(doc({ type: "orderedList", attrs: { start: 2, type: "a" }, content: [{ type: "listItem", content: [p()] }] }));
    expect(out.content[0]?.attrs).toEqual({ start: 2 });
  });

  it("fills defaults and fixes key order, whatever the input order", () => {
    const scrambled = JSON.parse(
      '{"content":[{"attrs":{"level":2},"content":[{"text":"T","type":"text"}],"type":"heading"}],"type":"doc"}',
    ) as unknown;
    expect(JSON.stringify(canonical(scrambled))).toBe(
      '{"type":"doc","content":[{"type":"heading","attrs":{"textAlign":null,"indent":0,"level":2},"content":[{"type":"text","text":"T"}]}]}',
    );
  });

  it("merges adjacent text nodes with identical marks, and orders marks by schema rank", () => {
    const out = canonical(
      doc(
        p(
          text("a", [{ type: "italic" }, { type: "bold" }]),
          text("b", [{ type: "bold" }, { type: "italic" }]),
          text("c", [{ type: "bold" }]),
          text("d"),
          text("e"),
        ),
      ),
    );
    expect(out.content[0]?.content).toEqual([
      { type: "text", marks: [{ type: "bold" }, { type: "italic" }], text: "ab" },
      { type: "text", marks: [{ type: "bold" }], text: "c" },
      { type: "text", text: "de" },
    ]);
  });

  it("is idempotent on the kitchen-sink document", () => {
    expectIdempotent(validateDocumentJson(kitchenSink(), { allowedAttachmentIds: new Set([ATTACHMENT_ID]) }));
  });

  it("returns plain objects (no null prototypes from ProseMirror's attrs)", () => {
    const out = canonical(kitchenSink());
    expect(Object.getPrototypeOf(out.content[0]?.attrs)).toBe(Object.prototype);
  });
});

// ---------------------------------------------------------------- property-based

const safeText = fc
  .string({ unit: fc.constantFrom("a", "b", " ", "日", "🙂", "<", ">", "&", '"', "'", "\\", "\n", "é"), minLength: 1, maxLength: 12 })
  .filter((s) => s.length > 0);

const hexColour = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`);

const href = fc.constantFrom("https://example.com/", "http://example.com/a?b=1", "mailto:a@example.com", "tel:+1555", "/spaces/X/pages/1");

const junkAttrs = fc.dictionary(fc.constantFrom("junk", "onclick", "style", "data-x"), fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
  maxKeys: 2,
});

// Marks that can share a text node (code excludes every other mark, so it travels alone).
const markSet: fc.Arbitrary<MarkJson[]> = fc.oneof(
  { weight: 1, arbitrary: fc.constant([{ type: "code" }]) },
  {
    weight: 6,
    arbitrary: fc
      .record(
        {
          bold: fc.boolean(),
          italic: fc.boolean(),
          underline: fc.boolean(),
          strike: fc.boolean(),
          subscript: fc.boolean(),
          superscript: fc.boolean(),
          link: fc.option(href, { nil: undefined }),
          color: fc.option(hexColour, { nil: undefined }),
        },
        { requiredKeys: [] },
      )
      .chain((r) =>
        fc.shuffledSubarray(
          [
            ...(r.bold ? [{ type: "bold" }] : []),
            ...(r.italic ? [{ type: "italic" }] : []),
            ...(r.underline ? [{ type: "underline" }] : []),
            ...(r.strike ? [{ type: "strike" }] : []),
            ...(r.subscript ? [{ type: "subscript" }] : []),
            ...(r.superscript ? [{ type: "superscript" }] : []),
            ...(r.link ? [{ type: "link", attrs: { href: r.link } }] : []),
            ...(r.color ? [{ type: "textStyle", attrs: { color: r.color } }] : []),
          ] as MarkJson[],
          { minLength: 0 },
        ),
      ),
  },
);

const textNode: fc.Arbitrary<NodeJson> = fc
  .tuple(safeText, markSet)
  .map(([t, marks]) => (marks.length ? { type: "text", text: t, marks } : { type: "text", text: t }));

const inlineContent = fc.array(fc.oneof({ weight: 8, arbitrary: textNode }, { weight: 1, arbitrary: fc.constant<NodeJson>({ type: "hardBreak" }) }), {
  maxLength: 6,
});

const alignment = fc.constantFrom(null, "left", "center", "right", "justify");

const paragraph: fc.Arbitrary<NodeJson> = fc
  .record({ content: inlineContent, textAlign: alignment, indent: fc.integer({ min: 0, max: 6 }), junk: junkAttrs })
  .map(({ content, textAlign, indent, junk }) => ({ type: "paragraph", attrs: { ...junk, textAlign, indent }, content }));

const heading: fc.Arbitrary<NodeJson> = fc
  .record({ content: inlineContent, level: fc.integer({ min: 1, max: 6 }), indent: fc.integer({ min: 0, max: 6 }) })
  .map(({ content, level, indent }) => ({ type: "heading", attrs: { level, indent }, content }));

const { block } = fc.letrec<{ block: NodeJson; list: NodeJson }>((tie) => ({
  block: fc.oneof({ depthSize: "small", withCrossShrink: true }, paragraph, heading, tie("list")),
  list: fc
    .record({
      ordered: fc.boolean(),
      start: fc.integer({ min: 0, max: 50 }),
      items: fc.array(fc.tuple(paragraph, fc.array(tie("block"), { maxLength: 2 })), { minLength: 1, maxLength: 3 }),
    })
    .map(({ ordered, start, items }) => ({
      type: ordered ? "orderedList" : "bulletList",
      ...(ordered ? { attrs: { start } } : {}),
      content: items.map(([first, rest]) => ({ type: "listItem", content: [first, ...rest] })),
    })),
}));

const document = fc.array(block, { minLength: 1, maxLength: 6 }).map((content) => ({ type: "doc", content }));

function plainText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const rec = node as Record<string, unknown>;
  if (typeof rec.text === "string") return rec.text;
  return Array.isArray(rec.content) ? rec.content.map(plainText).join("") : "";
}

function hasJunk(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const rec = node as Record<string, unknown>;
  const attrs = rec.attrs as Record<string, unknown> | undefined;
  if (attrs && ["junk", "onclick", "style", "data-x"].some((k) => k in attrs)) return true;
  return Array.isArray(rec.content) && rec.content.some(hasJunk);
}

describe("canonical form — properties", () => {
  it("generated documents validate, canonicalise idempotently, keep their text and lose unknown attributes", () => {
    fc.assert(
      fc.property(document, (input) => {
        const first = validateDocumentJson(input);
        if (!first.ok) throw new Error(JSON.stringify(first.errors));
        expectIdempotent(first);
        expect(plainText(first.doc)).toBe(plainText(input));
        expect(hasJunk(first.doc)).toBe(false);
        expect(first.bytes).toBe(new TextEncoder().encode(JSON.stringify(first.doc)).length);
      }),
      { numRuns: 300 },
    );
  });

  it("never throws, whatever it is given", () => {
    fc.assert(
      fc.property(fc.anything({ withNullPrototype: true, withBigInt: true, withDate: true, withMap: true, withSet: true }), (input) => {
        const result = validateDocumentJson(input);
        expect(typeof result.ok).toBe("boolean");
        if (result.ok) expectIdempotent(result);
      }),
      { numRuns: 500 },
    );
  });

  it("never throws on node-shaped garbage", () => {
    const nodeish = fc.letrec<{ node: unknown }>((tie) => ({
      node: fc.record(
        {
          type: fc.oneof(fc.constantFrom("doc", "paragraph", "text", "heading", "table", "tableRow", "image", "link", "bold"), fc.string()),
          attrs: fc.oneof(fc.dictionary(fc.string(), fc.jsonValue()), fc.jsonValue()),
          content: fc.oneof(fc.array(tie("node"), { maxLength: 3 }), fc.jsonValue()),
          marks: fc.oneof(fc.array(fc.record({ type: fc.constantFrom("bold", "link", "code", "x"), attrs: fc.jsonValue() }), { maxLength: 2 }), fc.jsonValue()),
          text: fc.oneof(fc.string(), fc.jsonValue()),
        },
        { requiredKeys: ["type"] },
      ),
    }));
    fc.assert(
      fc.property(nodeish.node, (input) => {
        const result = validateDocumentJson(input);
        expect(typeof result.ok).toBe("boolean");
        if (result.ok) expectIdempotent(result);
      }),
      { numRuns: 500 },
    );
  });
});
