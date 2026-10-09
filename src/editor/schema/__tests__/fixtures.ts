// Shared fixtures for the schema and renderer tests. Not a test file itself.
import type { MarkJson, NodeJson } from "../types";

export const ATTACHMENT_ID = "clattachment0000000000001";
export const IMAGE_SRC = `/api/v1/attachments/${ATTACHMENT_ID}/diagram.png`;
export const USER_ID = "cluser00000000000000000001";

export function text(value: string, marks?: MarkJson[]): NodeJson {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

export function p(...content: NodeJson[]): NodeJson {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

export function h(level: number, ...content: NodeJson[]): NodeJson {
  return { type: "heading", attrs: { level }, content };
}

export function doc(...content: NodeJson[]): { type: "doc"; content: NodeJson[] } {
  return { type: "doc", content };
}

export function cell(type: "tableCell" | "tableHeader", attrs: Record<string, unknown>, ...content: NodeJson[]): NodeJson {
  return { type, attrs: attrs as NodeJson["attrs"], content: content.length ? content : [p()] };
}

export function link(href: string): MarkJson {
  return { type: "link", attrs: { href } };
}

/** A paragraph holding one text node with one link mark. */
export function linkDoc(href: unknown): unknown {
  return doc(p({ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] } as NodeJson));
}

/** An image node in a paragraph. */
export function imageDoc(attrs: Record<string, unknown>): unknown {
  return doc(p({ type: "image", attrs } as NodeJson));
}

/** A raw (non-canonical) document that uses every node and every mark of the schema. */
export function kitchenSink(): { type: "doc"; content: NodeJson[] } {
  return doc(
    h(1, text("Specifications")),
    { type: "tableOfContents", attrs: { minLevel: 1, maxLevel: 3 } },
    { type: "paragraph", attrs: { textAlign: "center", indent: 2 }, content: [text("Centred and indented")] },
    { type: "heading", attrs: { level: 2, textAlign: "right", indent: 1 }, content: [text("Marks")] },
    p(
      text("bold", [{ type: "bold" }]),
      text(" italic", [{ type: "italic" }]),
      text(" underline", [{ type: "underline" }]),
      text(" strike", [{ type: "strike" }]),
      text(" code", [{ type: "code" }]),
      text(" H"),
      text("2", [{ type: "subscript" }]),
      text("O x"),
      text("2", [{ type: "superscript" }]),
      text(" internal", [link("/spaces/TEAM/pages/1")]),
      text(" external", [link("https://example.com/a?b=1#c")]),
      text(" red", [{ type: "textStyle", attrs: { color: "#a11911" } }]),
      { type: "hardBreak" },
      text("after break"),
    ),
    { type: "blockquote", content: [p(text("Quoted"))] },
    { type: "codeBlock", attrs: { language: "typescript" }, content: [text("const a = 1;\nconst b = 2;")] },
    { type: "horizontalRule" },
    { type: "bulletList", content: [{ type: "listItem", content: [p(text("bullet one"))] }] },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        { type: "listItem", content: [p(text("third")), { type: "bulletList", content: [{ type: "listItem", content: [p(text("nested"))] }] }] },
      ],
    },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [p(text("done"))] },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p(text("todo")), { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [p(text("sub"))] }] }],
        },
      ],
    },
    {
      type: "table",
      attrs: { widthMode: "fixed", numberedColumn: true },
      content: [
        {
          type: "tableRow",
          content: [
            cell("tableHeader", { colwidth: [120] }, p(text("Requirement"))),
            cell("tableHeader", { colspan: 2, colwidth: [200, 80] }, p(text("Description"))),
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("tableCell", { rowspan: 2, background: "#ffeeaa" }, p(text("BR-01"))),
            cell("tableCell", {}, p(text("Lorem"))),
            cell("tableCell", {}, p(text("Albert"))),
          ],
        },
        { type: "tableRow", content: [cell("tableCell", { colspan: 2 }, p(text("Spans two")))] },
      ],
    },
    ...(["info", "note", "success", "warning", "error"] as const).map(
      (variant): NodeJson => ({ type: "infoPanel", attrs: { variant }, content: [p(text(`A ${variant} panel`))] }),
    ),
    h(3, text("Inline atoms")),
    p(
      text("Image "),
      { type: "image", attrs: { attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, alt: "A diagram", title: "Diagram", width: 320 } },
      text(" status "),
      { type: "status", attrs: { text: "In progress", colour: "blue" } },
      text(" date "),
      { type: "date", attrs: { value: "2026-10-09" } },
      text(" mention "),
      { type: "mention", attrs: { userId: USER_ID, label: "Albert" } },
    ),
  );
}

/** Every node type name and mark type name used anywhere in a JSON tree. */
export function typesUsed(node: unknown): { nodes: Set<string>; marks: Set<string> } {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  const visit = (n: unknown) => {
    if (typeof n !== "object" || n === null) return;
    const rec = n as Record<string, unknown>;
    if (typeof rec.type === "string") nodes.add(rec.type);
    if (Array.isArray(rec.marks)) for (const m of rec.marks) if (typeof m?.type === "string") marks.add(m.type as string);
    if (Array.isArray(rec.content)) rec.content.forEach(visit);
  };
  visit(node);
  return { nodes, marks };
}
