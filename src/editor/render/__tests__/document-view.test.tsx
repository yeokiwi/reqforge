import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLASS, HEADING_ID_PREFIX, NUMBER_COLUMN_WIDTH, collectHeadings, documentSchema, validateDocumentJson } from "@/editor/schema";
import {
  ATTACHMENT_ID,
  IMAGE_SRC,
  USER_ID,
  doc,
  h,
  imageDoc,
  kitchenSink,
  linkDoc,
  p,
  text,
} from "@/editor/schema/__tests__/fixtures";
import { DocumentView, NODE_RENDERERS, RENDERED_MARK_TYPES, type ContentNode } from "../document-view";
import { renderDocumentHtml } from "../to-html";

function html(content: unknown): string {
  return renderToStaticMarkup(<DocumentView content={content} />);
}

function canonical(input: unknown) {
  const result = validateDocumentJson(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

const H = HEADING_ID_PREFIX;
const NUM = NUMBER_COLUMN_WIDTH;

const sink = canonical(kitchenSink());
const sinkHtml = html(sink);

// What each node and mark looks like when rendered from the kitchen-sink fixture. A node or
// mark that the schema has but this table lacks fails the parity test below.
const NODE_SIGNATURES: Record<string, string> = {
  doc: `<div class="rf-content"><h1 id="${H}specifications">`,
  paragraph: '<p style="text-align:center" data-indent="2">Centred and indented</p>',
  heading: `<h2 id="${H}marks" style="text-align:right" data-indent="1">Marks</h2>`,
  blockquote: "<blockquote><p>Quoted</p></blockquote>",
  codeBlock: '<pre data-language="typescript"><code class="language-typescript">const a = 1;\nconst b = 2;</code></pre>',
  horizontalRule: "<hr/>",
  bulletList: "<ul><li><p>bullet one</p></li></ul>",
  orderedList: '<ol start="3"><li><p>third</p><ul><li><p>nested</p></li></ul></li></ol>',
  listItem: "<li><p>bullet one</p></li>",
  taskList: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">',
  taskItem:
    '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" disabled="" readOnly="" checked=""/><span></span></label><div><p>done</p></div></li>',
  // Numbered: the number column gets its own <col>, and its width counts in the fixed total.
  table: `<div class="rf-table-wrapper"><table class="rf-table rf-table--fixed rf-table--numbered" style="width:${400 + NUM}px" data-width-mode="fixed" data-numbered-column="true"><colgroup><col class="rf-table__number-col" style="width:${NUM}px"/><col style="width:120px"/><col style="width:200px"/><col style="width:80px"/></colgroup><tbody>`,
  tableRow: "<tr><th",
  tableHeader: '<th colSpan="2" data-colwidth="200,80"><p>Description</p></th>',
  tableCell: '<td rowSpan="2" data-background="#ffeeaa" style="background-color:#ffeeaa"><p>BR-01</p></td>',
  infoPanel: '<div data-type="infoPanel" data-variant="warning" class="rf-panel rf-panel--warning"><p>A warning panel</p></div>',
  tableOfContents: `<nav data-type="tableOfContents" class="rf-toc" data-min-level="1" data-max-level="3"><ul><li class="rf-toc__item" data-level="1"><a href="#${H}specifications">Specifications</a></li><li class="rf-toc__item" data-level="2"><a href="#${H}marks">Marks</a></li><li class="rf-toc__item" data-level="3"><a href="#${H}inline-atoms">Inline atoms</a></li></ul></nav>`,
  image: `<img src="${IMAGE_SRC}" alt="A diagram" title="Diagram" width="320" loading="lazy" decoding="async" data-attachment-id="${ATTACHMENT_ID}"/>`,
  status: '<span data-type="status" data-colour="blue" class="rf-status rf-status--blue">In progress</span>',
  date: '<time data-type="date" class="rf-date" dateTime="2026-10-09">Oct 9, 2026</time>',
  mention: `<span data-type="mention" class="rf-mention" data-user-id="${USER_ID}">@Albert</span>`,
  hardBreak: "<br/>after break",
  text: "Centred and indented",
};

const MARK_SIGNATURES: Record<string, string> = {
  bold: "<strong>bold</strong>",
  italic: "<em> italic</em>",
  underline: "<u> underline</u>",
  strike: "<s> strike</s>",
  code: "<code> code</code>",
  subscript: "<sub>2</sub>O",
  superscript: "<sup>2</sup>",
  link: '<a href="/spaces/TEAM/pages/1"> internal</a>',
  textStyle: '<span style="color:#a11911"> red</span>',
};

describe("DocumentView — parity with the schema", () => {
  it("has a built-in renderer for every node type in the schema, and nothing else", () => {
    expect(Object.keys(NODE_RENDERERS).sort()).toEqual(Object.keys(documentSchema.nodes).sort());
  });

  it("renders every mark type in the schema", () => {
    expect([...RENDERED_MARK_TYPES].sort()).toEqual(Object.keys(documentSchema.marks).sort());
  });

  it.each(Object.keys(documentSchema.nodes))("renders node %s recognisably", (name) => {
    const signature = NODE_SIGNATURES[name];
    expect(signature, `no signature for node ${name}`).toBeDefined();
    expect(sinkHtml).toContain(signature);
  });

  it.each(Object.keys(documentSchema.marks))("renders mark %s recognisably", (name) => {
    const signature = MARK_SIGNATURES[name];
    expect(signature, `no signature for mark ${name}`).toBeDefined();
    expect(sinkHtml).toContain(signature);
  });
});

describe("DocumentView — content", () => {
  it("gives headings the ids collectHeadings computes, and the table of contents links to them", () => {
    const d = canonical(
      doc({ type: "tableOfContents", attrs: { minLevel: 2, maxLevel: 3 } }, h(1, text("Top")), h(2, text("Same")), h(3, text("Same")), h(4, text("Deep")), h(2, text("Same"))),
    );
    const out = html(d);
    for (const entry of collectHeadings(d)) expect(out).toContain(`<h${entry.level} id="${entry.id}">`);
    expect(out).toContain(
      `<ul><li class="rf-toc__item" data-level="1"><a href="#${H}same">Same</a></li><li class="rf-toc__item" data-level="2"><a href="#${H}same-1">Same</a></li><li class="rf-toc__item" data-level="1"><a href="#${H}same-2">Same</a></li></ul>`,
    );
    expect(out).not.toContain(`href="#${H}top"`);
    expect(out).not.toContain(`href="#${H}deep"`);
    // Rendering twice gives the same ids.
    expect(html(d)).toBe(out);
  });

  it("leaves headings without text out of the table of contents, though they keep an id", () => {
    const out = html(canonical(doc({ type: "tableOfContents" }, h(1, text("A")), h(2), h(2, { type: "hardBreak" }), h(1, text("B")))));
    expect(out).toContain(
      `<ul><li class="rf-toc__item" data-level="1"><a href="#${H}a">A</a></li><li class="rf-toc__item" data-level="1"><a href="#${H}b">B</a></li></ul>`,
    );
    expect(out).toContain(`<h2 id="${H}heading"></h2><h2 id="${H}heading-1"><br/></h2>`);
    expect(out).not.toContain(`href="#${H}heading`);
    expect(out).not.toMatch(/<a [^>]*><\/a>/);
  });

  it("renders an empty table of contents as an empty nav", () => {
    expect(html(canonical(doc({ type: "tableOfContents" })))).toBe(
      '<div class="rf-content"><nav data-type="tableOfContents" class="rf-toc" data-min-level="1" data-max-level="6"></nav></div>',
    );
  });

  it("opens external links in a new tab without an opener; internal and mailto links stay plain", () => {
    expect(html(linkDoc("https://example.com/x"))).toContain('<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">x</a>');
    expect(html(linkDoc("/spaces/TEAM/pages/1"))).toContain('<a href="/spaces/TEAM/pages/1">x</a>');
    expect(html(linkDoc("mailto:a@example.com"))).toContain('<a href="mailto:a@example.com">x</a>');
  });

  it("nests marks in schema order, link outermost", () => {
    const out = html(canonical(doc(p(text("x", [{ type: "italic" }, { type: "link", attrs: { href: "/a" } }, { type: "bold" }])))));
    expect(out).toContain('<a href="/a"><strong><em>x</em></strong></a>');
  });

  it("renders marks around inline atoms too (a linked image)", () => {
    const input = doc(p({ type: "image", attrs: { attachmentId: ATTACHMENT_ID, src: IMAGE_SRC }, marks: [{ type: "link", attrs: { href: "/x" } }] }));
    expect(html(canonical(input))).toContain(`<a href="/x"><img src="${IMAGE_SRC}" alt=""`);
  });

  it("renders a responsive table without widths, and keeps the header row's role", () => {
    const input = doc({
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p(text("H"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p(text("C"))] }] },
      ],
    });
    expect(html(canonical(input))).toContain(
      '<div class="rf-table-wrapper"><table class="rf-table rf-table--responsive" data-width-mode="responsive"><tbody><tr><th><p>H</p></th></tr><tr><td><p>C</p></td></tr></tbody></table></div>',
    );
  });

  describe("a numbered table's column widths (RD-057 num)", () => {
    // The number is a CSS counter in a `tr::before` table cell (content.css), so it occupies a
    // real leading column. Without its own <col>, every stored width would land one column left.
    const numberedTable = (attrs: { widthMode: string; numberedColumn: boolean }, widths: Array<number[] | null>) =>
      canonical(
        doc({
          type: "table",
          attrs,
          content: [
            { type: "tableRow", content: widths.map((colwidth) => ({ type: "tableHeader", attrs: { colwidth }, content: [p()] })) },
            { type: "tableRow", content: widths.map(() => ({ type: "tableCell", content: [p()] })) },
          ],
        }),
      );
    const tableTag = (out: string) => /<table[^>]*>(?:<colgroup>.*?<\/colgroup>)?/.exec(out)?.[0];

    it("gives the number column its own leading <col>, and counts it in a fixed table's width", () => {
      expect(tableTag(html(numberedTable({ widthMode: "fixed", numberedColumn: true }, [[120], [300]])))).toBe(
        `<table class="rf-table rf-table--fixed rf-table--numbered" style="width:${420 + NUM}px" data-width-mode="fixed" data-numbered-column="true">` +
          `<colgroup><col class="${CLASS.tableNumberColumn}" style="width:${NUM}px"/><col style="width:120px"/><col style="width:300px"/></colgroup>`,
      );
    });

    it("adds the leading <col> to a responsive numbered table, which has no fixed width", () => {
      expect(tableTag(html(numberedTable({ widthMode: "responsive", numberedColumn: true }, [[120], null])))).toBe(
        '<table class="rf-table rf-table--responsive rf-table--numbered" data-width-mode="responsive" data-numbered-column="true">' +
          `<colgroup><col class="${CLASS.tableNumberColumn}" style="width:${NUM}px"/><col style="width:120px"/><col/></colgroup>`,
      );
    });

    it("adds nothing to a table that is not numbered", () => {
      expect(tableTag(html(numberedTable({ widthMode: "fixed", numberedColumn: false }, [[120], [300]])))).toBe(
        '<table class="rf-table rf-table--fixed" style="width:420px" data-width-mode="fixed"><colgroup><col style="width:120px"/><col style="width:300px"/></colgroup>',
      );
    });

    it("emits no colgroup at all when no width is stored, numbered or not", () => {
      expect(tableTag(html(numberedTable({ widthMode: "fixed", numberedColumn: true }, [null, null])))).toBe(
        '<table class="rf-table rf-table--fixed rf-table--numbered" data-width-mode="fixed" data-numbered-column="true">',
      );
    });

    it("draws the counter cell at the width the <col> reserves (content.css)", () => {
      const css = readFileSync(path.resolve(__dirname, "../../content.css"), "utf8");
      const rule = /table\.rf-table--numbered > tbody > tr::before \{([^}]*)\}/.exec(css)?.[1];
      expect(rule, "the counter cell rule").toBeDefined();
      expect(rule).toMatch(new RegExp(`(^|;)\\s*width: ${NUM}px;`));
    });
  });

  it("renders an unchecked task item's checkbox disabled and unchecked", () => {
    expect(sinkHtml).toContain('<li data-type="taskItem" data-checked="false"><label><input type="checkbox" disabled="" readOnly=""/>');
  });

  it("formats dates in UTC whatever the process time zone", () => {
    const before = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      expect(html(canonical(doc(p({ type: "date", attrs: { value: "2026-01-01" } }))))).toContain(">Jan 1, 2026</time>");
    } finally {
      process.env.TZ = before;
    }
  });

  describe("heading ids share the page with the application and with other views", () => {
    const ids = (markup: string) => [...markup.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
    const duplicates = (list: Array<string | undefined>) => list.filter((id, i) => list.indexOf(id) !== i);
    const page = canonical(doc({ type: "tableOfContents" }, h(1, text("Main")), h(2, text("Global search")), h(2, text("Introduction"))));

    it("never reuses an id of the application shell, so TOC links reach the heading", () => {
      // The shell (src/app/_components/app-frame.tsx) wraps every page in <main id="main">.
      const out = renderToStaticMarkup(
        <main id="main">
          <input id="global-search" />
          <DocumentView content={page} />
        </main>,
      );
      expect(duplicates(ids(out))).toEqual([]);
      for (const [, target] of out.matchAll(/href="#([^"]*)"/g)) {
        expect(target === "main" || target === "global-search", `TOC link #${target}`).toBe(false);
        expect(out, `TOC link #${target} lands on a heading`).toMatch(new RegExp(`<h[1-6] id="${target}"`));
      }
    });

    it("takes an idPrefix, so two versions side by side (RD-060) keep their own anchors", () => {
      const left = renderToStaticMarkup(<DocumentView content={page} idPrefix="rf-v3-h-" />);
      const right = renderToStaticMarkup(<DocumentView content={page} idPrefix="rf-v5-h-" />);
      expect(duplicates([...ids(left), ...ids(right)])).toEqual([]);
      expect(left).toContain('<h1 id="rf-v3-h-main">Main</h1>');
      expect(left).toContain('<a href="#rf-v3-h-main">Main</a>');
      expect(right).toContain('<a href="#rf-v5-h-introduction">Introduction</a>');
      // Each pane's links stay inside that pane.
      for (const [, target] of right.matchAll(/href="#([^"]*)"/g)) {
        expect(right).toContain(` id="${target}"`);
        expect(left).not.toContain(` id="${target}"`);
      }
    });
  });

  it("appends a className to the container", () => {
    expect(renderToStaticMarkup(<DocumentView content={doc(p())} className="page-body" />)).toBe(
      '<div class="rf-content page-body"><p></p></div>',
    );
  });
});

describe("DocumentView — escaping", () => {
  it("escapes text", () => {
    const out = html(canonical(doc(p(text("<script>alert(1)</script> & <img src=x onerror=alert(1)>")))));
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(1)&gt;");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img src=x");
  });

  it("never sets dangerouslySetInnerHTML anywhere in src/editor", () => {
    // Setting it is a JSX attribute or an object key: `name=` or `name:`. static-markup.ts
    // names it only to refuse it (static-markup.test.tsx checks the refusal).
    const setter = new RegExp(`${["dangerously", "SetInnerHTML"].join("")}\\s*(=(?!=)|:)`);
    const root = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "__tests__") walk(full);
        } else if (/\.(ts|tsx)$/.test(name) && setter.test(readFileSync(full, "utf8"))) {
          offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    expect(setter.test(`<div ${["dangerously", "SetInnerHTML"].join("")}={{ __html: x }} />`)).toBe(true);
  });
});

describe("DocumentView — distrusts content that skipped validation", () => {
  it.each([
    ["javascript:alert(1)"],
    ["java\tscript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["//evil.example"],
    ["/\\evil.example"],
  ])("renders a %j link as plain text", (href) => {
    const out = html(linkDoc(href));
    expect(out).toBe('<div class="rf-content"><p>x</p></div>');
  });

  it("drops style values that are not on the whitelist", () => {
    const out = html(
      doc(
        { type: "paragraph", attrs: { textAlign: "center;background:url(https://evil.example/x)", indent: 99 }, content: [text("a", [{ type: "textStyle", attrs: { color: "red;position:fixed" } }])] },
        {
          type: "table",
          attrs: { widthMode: "fixed; width: 9999px" },
          content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { background: "#fff;background:url(x)", colspan: "2", colwidth: ["1e9"] }, content: [p()] }] }],
        },
      ),
    );
    expect(out).not.toContain("url(");
    expect(out).not.toContain("position");
    expect(out).not.toContain("data-indent");
    expect(out).toContain('<p>a</p>');
    expect(out).toContain('<table class="rf-table rf-table--responsive" data-width-mode="responsive"><tbody><tr><td><p></p></td></tr></tbody></table>');
  });

  it.each<[string, Record<string, unknown>]>([
    ["an external image", { attachmentId: ATTACHMENT_ID, src: "https://tracker.example/p.png" }],
    ["a data: image", { attachmentId: ATTACHMENT_ID, src: "data:image/svg+xml,<svg onload=alert(1)>" }],
    ["an image whose src names another attachment", { attachmentId: ATTACHMENT_ID, src: "/api/v1/attachments/other/x.png" }],
    ["an image with no attachmentId", { src: IMAGE_SRC }],
  ])("renders nothing for %s", (_label, attrs) => {
    expect(html(imageDoc(attrs))).toBe('<div class="rf-content"><p></p></div>');
  });

  it("falls back to safe defaults for out-of-range attributes", () => {
    const out = html(
      doc(
        { type: "heading", attrs: { level: 9 }, content: [text("not a heading")] },
        { type: "infoPanel", attrs: { variant: "evil" }, content: [p()] },
        p({ type: "status", attrs: { text: "ok", colour: "evil" } }, { type: "date", attrs: { value: "<b>2026-02-30</b>" } }),
        { type: "codeBlock", attrs: { language: 'x" onmouseover="y' }, content: [text("c")] },
        { type: "orderedList", attrs: { start: "5" }, content: [{ type: "listItem", content: [p()] }] },
      ),
    );
    expect(out).toContain("<p>not a heading</p>");
    expect(out).toContain('class="rf-panel rf-panel--info"');
    expect(out).toContain('class="rf-status rf-status--grey">ok</span>');
    expect(out).toContain("&lt;b&gt;2026-02-30&lt;/b&gt;");
    expect(out).toContain("<pre><code>c</code></pre>");
    expect(out).toContain("<ol><li>");
  });
});

describe("DocumentView — forward compatibility and garbage", () => {
  it("renders the children of an unknown node, without a wrapper", () => {
    const out = html(doc(p(text("before ")), { type: "requirementReport", attrs: { query: "x" }, content: [p(text("inside"))] } as never));
    expect(out).toBe('<div class="rf-content"><p>before </p><p>inside</p></div>');
  });

  it("renders nothing for an unknown atom, and skips an unknown mark", () => {
    const out = html(doc(p(text("a"), { type: "requirement", attrs: { key: "BR-01" } } as never, text("b", [{ type: "blink" }, { type: "bold" }]))));
    expect(out).toBe('<div class="rf-content"><p>a<strong>b</strong></p></div>');
  });

  it("hands nodes to nodeRenderers, with their rendered children", () => {
    const seen: ContentNode[] = [];
    const out = renderToStaticMarkup(
      <DocumentView
        content={doc(p(text("Req "), { type: "requirement", attrs: { key: "BR-01" } } as never), { type: "blockquote", content: [p(text("q"))] })}
        nodeRenderers={{
          requirement: (node) => {
            seen.push(node);
            return <span className="pill">{String(node.attrs.key)}</span>;
          },
          blockquote: (_node, children) => <aside>{children}</aside>,
        }}
      />,
    );
    expect(out).toBe('<div class="rf-content"><p>Req <span class="pill">BR-01</span></p><aside><p>q</p></aside></div>');
    expect(seen[0]?.attrs).toEqual({ key: "BR-01" });
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", "<script>alert(1)</script>"],
    ["an array", [p(text("x"))]],
    ["a node with a numeric type", { type: 5, content: [p(text("x"))] }],
    ["content that is a string", { type: "doc", content: "<script>" }],
    ["marks that are a string", doc(p({ type: "text", text: "x", marks: "bold" } as never))],
    ["text that is an object", doc(p({ type: "text", text: { toString: () => "<script>" } } as never))],
    ["attrs that are an array", doc({ type: "heading", attrs: [1, 2], content: [text("x")] } as never)],
  ])("does not throw on %s", (_label, content) => {
    const out = html(content);
    expect(out.startsWith('<div class="rf-content">')).toBe(true);
    expect(out).not.toContain("<script");
  });

  it("does not throw on a cycle, a 100 000-deep tree, a sparse array or a throwing getter", () => {
    const cyclic: Record<string, unknown> = { type: "doc", content: [] };
    (cyclic.content as unknown[]).push(cyclic, cyclic);

    let deep: unknown = p(text("bottom"));
    for (let i = 0; i < 100_000; i++) deep = { type: "blockquote", content: [deep] };

    const getter = { type: "doc" } as Record<string, unknown>;
    Object.defineProperty(getter, "content", {
      get() {
        throw new Error("boom");
      },
    });

    const started = Date.now();
    expect(() => html(cyclic)).not.toThrow();
    expect(html(doc(deep as never))).not.toContain("bottom");
    expect(html({ type: "doc", content: new Array(2 ** 32 - 1) })).toBe('<div class="rf-content"></div>');
    expect(html(getter)).toBe('<div class="rf-content"></div>');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

// `?format=html` is served by a route handler, which Next bundles in the react-server layer
// where react-dom/server throws on import. renderDocumentHtml therefore has its own static
// serialiser; these tests hold it to React's output byte for byte, so the API and the page
// cannot disagree. to-html.rsc.test.ts loads it under the react-server builds.
describe("renderDocumentHtml", () => {
  it("renders the same markup as DocumentView, as a string", () => {
    expect(renderDocumentHtml(sink)).toBe(sinkHtml);
    expect(renderDocumentHtml(doc(p(text("<x>"))))).toBe('<div class="rf-content"><p>&lt;x&gt;</p></div>');
  });

  it("passes className, idPrefix and nodeRenderers through", () => {
    const content = doc(h(1, text("T")), p(text("Req "), { type: "requirement", attrs: { key: "BR-01" } } as never));
    const options = {
      className: "page-body",
      idPrefix: "rf-v2-h-",
      nodeRenderers: { requirement: (node: ContentNode) => <span className="pill">{String(node.attrs.key)}</span> },
    };
    expect(renderDocumentHtml(content, options)).toBe(renderToStaticMarkup(<DocumentView content={content} {...options} />));
    expect(renderDocumentHtml(content, options)).toBe(
      '<div class="rf-content page-body"><h1 id="rf-v2-h-t">T</h1><p>Req <span class="pill">BR-01</span></p></div>',
    );
  });

  it("matches React on every hostile, malformed and edge-case fixture", () => {
    const evil = '"><script>alert(1)</script><img src=x onerror="alert(1)\'&';
    const fixtures: unknown[] = [
      null,
      42,
      "<script>",
      doc(p()),
      doc({ type: "tableOfContents" }),
      linkDoc("https://example.com/x"),
      linkDoc("javascript:alert(1)"),
      linkDoc("mailto:a@example.com"),
      imageDoc({ attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, alt: evil, title: evil, width: 5 }),
      imageDoc({ attachmentId: ATTACHMENT_ID, src: "https://tracker.example/p.png" }),
      doc(p({ type: "status", attrs: { text: evil, colour: "evil" } }, { type: "mention", attrs: { userId: USER_ID, label: evil } })),
      doc(p(text(evil, [{ type: "textStyle", attrs: { color: "#aabbcc" } }, { type: "bold" }]))),
      doc(h(2, text(evil))),
      doc({ type: "codeBlock", attrs: { language: "ts" }, content: [text("\nleading newline </code>")] }),
      doc({ type: "orderedList", attrs: { start: 0 }, content: [{ type: "listItem", content: [p()] }] }),
      doc({ type: "paragraph", attrs: { textAlign: "justify", indent: 6 }, content: [text("x")] }),
      doc({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p()] }, { type: "taskItem", attrs: { checked: false }, content: [p()] }] }),
      doc({ type: "table", attrs: { widthMode: "fixed", numberedColumn: true }, content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2, rowspan: 3, colwidth: [0, 10.5], background: "#000000" }, content: [p()] }] }] }),
      doc({ type: "heading", attrs: { level: 9 }, content: [text("x")] }, { type: "infoPanel", attrs: { variant: "evil" }, content: [p()] }),
      doc(p({ type: "date", attrs: { value: "<b>2026-02-30</b>" } }, { type: "date", attrs: { value: "2026-02-28" } })),
      doc({ type: "requirementReport", content: [p(text("inside"))] } as never),
      doc({ type: "heading", attrs: [1, 2], content: [text("x")] } as never),
    ];
    for (const content of fixtures) {
      expect(renderDocumentHtml(content), JSON.stringify(content)).toBe(html(content));
    }
  });

  it("matches React on generated node-shaped content", () => {
    const value = fc.oneof(
      fc.constantFrom(null, true, false, 0, 1, 2, 3, 7, -1, 1.5, "", "x", "#a11911", "center", "warning", "green", "2026-10-09", "fixed", "ts"),
      fc.string({ unit: fc.constantFrom("a", " ", "<", ">", "&", '"', "'", "\n", "日", "🙂", "/", "#", "-") }),
      fc.array(fc.integer({ min: -5, max: 500 }), { maxLength: 3 }),
    );
    const attrs = fc.dictionary(
      fc.constantFrom("level", "textAlign", "indent", "start", "checked", "widthMode", "numberedColumn", "colspan", "rowspan", "colwidth", "background", "variant", "minLevel", "maxLevel", "attachmentId", "src", "alt", "title", "width", "text", "colour", "value", "userId", "label", "language", "href", "color"),
      value,
      { maxKeys: 4 },
    );
    const mark = fc.record({ type: fc.constantFrom(...Object.keys(documentSchema.marks), "blink"), attrs });
    const { node } = fc.letrec<{ node: unknown }>((tie) => ({
      node: fc.record(
        {
          type: fc.constantFrom(...Object.keys(documentSchema.nodes), "unknown"),
          attrs,
          content: fc.array(tie("node"), { maxLength: 3 }),
          marks: fc.array(mark, { maxLength: 3 }),
          text: fc.string({ unit: fc.constantFrom("a", "<", "&", '"', "\n", "🙂") }),
        },
        { requiredKeys: ["type"] },
      ),
    }));
    fc.assert(
      fc.property(node, (content) => {
        expect(renderDocumentHtml(content)).toBe(html(content));
      }),
      { numRuns: 400 },
    );
  });

  it("never imports react-dom: no module under src/editor/render does", () => {
    const dir = path.resolve(__dirname, "..");
    const offenders = readdirSync(dir)
      .filter((name) => /\.(ts|tsx)$/.test(name))
      .filter((name) => /from\s+["']react-dom(\/[^"']*)?["']|import\(\s*["']react-dom/.test(readFileSync(path.join(dir, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});
