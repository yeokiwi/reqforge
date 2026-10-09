// @vitest-environment jsdom
// parseHTML and renderHTML of every node and mark, in a DOM: what the editor renders parses
// back to the same document, and what a user pastes never becomes content the server refuses.
import { DOMParser as PMDOMParser, DOMSerializer } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { NODE_NAMES, MARK_NAMES, documentSchema, validateDocumentJson } from "..";
import { ATTACHMENT_ID, kitchenSink, typesUsed } from "./fixtures";

function toHtml(json: unknown): string {
  const node = documentSchema.nodeFromJSON(json);
  const container = document.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(documentSchema).serializeFragment(node.content, { document }));
  return container.innerHTML;
}

function fromHtml(html: string): unknown {
  const container = document.createElement("div");
  container.innerHTML = html;
  return PMDOMParser.fromSchema(documentSchema).parse(container).toJSON();
}

function canonical(input: unknown) {
  const result = validateDocumentJson(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

describe("renderHTML → parseHTML round trip", () => {
  it("reproduces the kitchen-sink document exactly, through every node and mark", () => {
    const original = canonical(kitchenSink());
    const reparsed = fromHtml(toHtml(original));
    expect(canonical(reparsed)).toEqual(original);
    const used = typesUsed(reparsed);
    expect([...used.nodes].sort()).toEqual([...NODE_NAMES].sort());
    expect([...used.marks].sort()).toEqual([...MARK_NAMES].sort());
  });

  it("renders the classes and data attributes content.css styles", () => {
    const html = toHtml(canonical(kitchenSink()));
    for (const fragment of [
      'class="rf-table rf-table--fixed rf-table--numbered"',
      'data-type="infoPanel"',
      'class="rf-panel rf-panel--warning"',
      'class="rf-status rf-status--blue"',
      'data-type="tableOfContents"',
      'class="rf-date"',
      'datetime="2026-10-09"',
      ">Oct 9, 2026<",
      'class="rf-mention"',
      ">@Albert<",
      'data-indent="2"',
      'style="text-align: center;"',
      'data-background="#ffeeaa"',
      `data-attachment-id="${ATTACHMENT_ID}"`,
      'data-type="taskList"',
    ]) {
      expect(html, fragment).toContain(fragment);
    }
  });
});

describe("pasted HTML", () => {
  it.each<[string, string, unknown]>([
    ["a javascript: link keeps its text and loses the link", '<p><a href="javascript:alert(1)">x</a></p>', [{ type: "text", text: "x" }]],
    ["a protocol-relative link loses the link", '<p><a href="//evil.example">x</a></p>', [{ type: "text", text: "x" }]],
    ["an external image is dropped, the text stays", '<p>before<img src="https://tracker.example/p.png">after</p>', [{ type: "text", text: "beforeafter" }]],
    ["a data: image is dropped", '<p>a<img src="data:image/png;base64,AAAA">b</p>', [{ type: "text", text: "ab" }]],
    [
      "an rgb() colour becomes #rrggbb",
      '<p><span style="color: rgb(255, 0, 0)">red</span></p>',
      [{ type: "text", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }], text: "red" }],
    ],
    [
      "a named colour is dropped",
      '<p><span style="color: red">red</span></p>',
      [{ type: "text", marks: [{ type: "textStyle", attrs: { color: null } }], text: "red" }],
    ],
    ["a blank status is not a status", '<p><span data-type="status">   </span>after</p>', [{ type: "text", text: "after" }]],
    ["an impossible date stays text", '<p><time data-type="date" datetime="2026-02-30">soon</time></p>', [{ type: "text", text: "soon" }]],
    ["a mention without a user id stays text", '<p><span data-type="mention" data-label="Al">@Al</span></p>', [{ type: "text", text: "@Al" }]],
  ])("%s", (_label, html, inline) => {
    const parsed = canonical(fromHtml(html));
    expect(parsed.content[0]?.content).toEqual(inline);
  });

  it("normalises attributes it cannot store", () => {
    const parsed = canonical(
      fromHtml(
        [
          '<ol start="abc" type="a"><li><p>x</p></li></ol>',
          '<table><tr><td colspan="2.5" rowspan="-1" colwidth="a,b" style="background-color: rgb(1, 2, 3)"><p>x</p></td></tr></table>',
          '<div data-type="infoPanel" data-variant="evil"><p>x</p></div>',
          '<nav data-type="tableOfContents" data-min-level="5" data-max-level="2"></nav>',
          `<p><img src="/api/v1/attachments/${ATTACHMENT_ID}/x.png" width="99999" data-attachment-id="spoofed"></p>`,
          '<p data-indent="9" style="text-align: middle">x</p>',
          '<pre><code class="language-ts">a\nb</code></pre>',
        ].join(""),
      ),
    );
    const [list, table, panel, toc, image, paragraph, code] = parsed.content;
    expect(list?.attrs).toEqual({ start: 1 });
    expect(table?.content?.[0]?.content?.[0]?.attrs).toEqual({ colspan: 1, rowspan: 1, colwidth: null, background: "#010203" });
    expect(panel?.attrs).toEqual({ variant: "info" });
    expect(toc?.attrs).toEqual({ minLevel: 2, maxLevel: 5 });
    expect(image?.content?.[0]?.attrs).toEqual({
      attachmentId: ATTACHMENT_ID,
      src: `/api/v1/attachments/${ATTACHMENT_ID}/x.png`,
      alt: null,
      title: null,
      width: null,
    });
    expect(paragraph?.attrs).toEqual({ textAlign: null, indent: 0 });
    expect(code?.attrs).toEqual({ language: "ts" });
  });

  it("maps a pasted status, date and mention onto their nodes", () => {
    const parsed = canonical(
      fromHtml(
        '<p><span data-type="status" data-colour="green">  Done   and  dusted </span>' +
          '<time data-type="date" datetime="2026-10-09">whatever</time>' +
          '<span data-type="mention" data-user-id="clu1" data-label="Albert">@Albert</span></p>',
      ),
    );
    expect(parsed.content[0]?.content).toEqual([
      { type: "status", attrs: { text: "Done and dusted", colour: "green" } },
      { type: "date", attrs: { value: "2026-10-09" } },
      { type: "mention", attrs: { userId: "clu1", label: "Albert" } },
    ]);
  });
});
