// @vitest-environment jsdom
// Hostile values, parsed back the way a browser would parse the rendered markup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HEADING_ID_PREFIX, validateDocumentJson } from "@/editor/schema";
import { ATTACHMENT_ID, IMAGE_SRC, USER_ID, doc, h, p, text } from "@/editor/schema/__tests__/fixtures";
import { DocumentView } from "../document-view";

const EVIL = '"><script>alert(1)</script><img src=x onerror="alert(1)';

function rendered(input: unknown): Document {
  const result = validateDocumentJson(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const markup = renderToStaticMarkup(<DocumentView content={result.doc} />);
  expect(markup).not.toContain("<script");
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("DocumentView — escaping, seen through an HTML parser", () => {
  it("keeps attribute-breaking values as data: no script, no event handler, values intact", () => {
    const document = rendered(
      doc(
        p({ type: "image", attrs: { attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, alt: EVIL, title: EVIL } }),
        p({ type: "status", attrs: { text: "<b>x</b>", colour: "red" } }, { type: "mention", attrs: { userId: USER_ID, label: EVIL } }),
        h(2, text(EVIL)),
        p(text("q", [{ type: "link", attrs: { href: 'https://example.com/"onmouseover="alert(1)' } }])),
        { type: "codeBlock", content: [text("</code></pre><script>alert(1)</script>")] },
        p(text("<script>alert(1)</script>")),
      ),
    );
    expect(document.querySelectorAll("script")).toHaveLength(0);
    const handlers = [...document.querySelectorAll("*")].flatMap((el) =>
      [...el.attributes].filter((a) => a.name.toLowerCase().startsWith("on")).map((a) => `${el.tagName} ${a.name}`),
    );
    expect(handlers).toEqual([]);

    const img = document.querySelector("img");
    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(img?.getAttribute("alt")).toBe(EVIL);
    expect(img?.getAttribute("title")).toBe(EVIL);
    expect(document.querySelector(".rf-mention")?.textContent).toBe(`@${EVIL}`);
    expect(document.querySelector("h2")?.textContent).toBe(EVIL);
    expect(document.querySelector("h2")?.id).toBe(`${HEADING_ID_PREFIX}scriptalert1scriptimg-srcx-onerroralert1`);
    expect(document.querySelector(".rf-status")?.textContent).toBe("<b>x</b>");
    expect(document.querySelector("a")?.getAttribute("href")).toBe('https://example.com/"onmouseover="alert(1)');
    expect(document.querySelector("pre code")?.textContent).toBe("</code></pre><script>alert(1)</script>");
    expect(document.querySelectorAll("p")[3]?.textContent).toBe("<script>alert(1)</script>");
  });
});
