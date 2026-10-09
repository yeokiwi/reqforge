// The react-server layer, reproduced. Next 15 bundles route handlers and server components
// with the `react-server` export condition: `react` and its JSX runtimes resolve to their
// server builds, and every `react-dom/server` entry resolves to server.react-server.js, whose
// whole body is a throw. `GET /pages/{id}?format=html` (08 §3) is a route handler, so
// renderDocumentHtml must load and render under exactly these modules. Each mock below loads
// the real file the condition selects.
import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_ID, IMAGE_SRC, doc, h, p, text } from "@/editor/schema/__tests__/fixtures";

const { serverBuild } = vi.hoisted(() => ({
  /**
   * Loads `file` of `pkg` as the react-server condition selects it. The server builds call
   * `require("react")` themselves, and under the condition that is the server build too, so
   * while one loads, the CJS cache entry for "react" holds the server build.
   */
  serverBuild: async (pkg: string, file: string): Promise<Record<string, unknown>> => {
    const { createRequire } = await import("node:module");
    const path = await import("node:path");
    const require = createRequire(import.meta.url);
    const inPackage = (name: string, entry: string) => path.join(path.dirname(require.resolve(`${name}/package.json`)), entry);
    const serverReact: unknown = require(inPackage("react", "react.react-server.js"));
    const reactEntry = require.resolve("react");
    const saved = require.cache[reactEntry];
    require.cache[reactEntry] = { id: reactEntry, filename: reactEntry, loaded: true, exports: serverReact } as unknown as NodeJS.Module;
    try {
      const mod = require(inPackage(pkg, file)) as Record<string, unknown>;
      return { ...mod, default: mod };
    } finally {
      if (saved) require.cache[reactEntry] = saved;
      else delete require.cache[reactEntry];
    }
  },
}));

vi.mock("react", () => serverBuild("react", "react.react-server.js"));
vi.mock("react/jsx-runtime", () => serverBuild("react", "jsx-runtime.react-server.js"));
vi.mock("react/jsx-dev-runtime", () => serverBuild("react", "jsx-dev-runtime.react-server.js"));
vi.mock("react-dom/server", () => serverBuild("react-dom", "server.react-server.js"));

/** An error's message and its causes' (vitest wraps a mock factory's error). */
function messages(error: unknown): string {
  const out: string[] = [];
  for (let e: unknown = error; e instanceof Error; e = e.cause) out.push(e.message);
  return out.join(" | ");
}

describe("renderDocumentHtml in the react-server layer", () => {
  it("is really running against the server builds", async () => {
    const failure = await import("react-dom/server").then(
      () => null,
      (error: unknown) => error,
    );
    expect(messages(failure)).toContain("react-dom/server is not supported in React Server Components.");
    const react = Object.keys(await import("react"));
    expect(react).not.toContain("useState"); // the server build has no state hooks
    expect(react).not.toContain("createContext");
    expect(react).toContain("createElement");
  });

  it("loads, and renders a document with every attribute kind", async () => {
    const { renderDocumentHtml } = await import("../to-html");
    const content = doc(
      { type: "tableOfContents" },
      h(1, text("Title & <more>")),
      { type: "paragraph", attrs: { textAlign: "center", indent: 2 }, content: [text("a", [{ type: "link", attrs: { href: "https://example.com/?a=1&b=2" } }])] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p(text("done"))] }],
      },
      {
        type: "table",
        attrs: { widthMode: "fixed", numberedColumn: false },
        content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2, colwidth: [100, 50], background: "#ffeeaa" }, content: [p()] }] }],
      },
      p({ type: "image", attrs: { attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, alt: 'say "hi"', width: 320 } }, { type: "hardBreak" }),
    );
    expect(renderDocumentHtml(content)).toBe(
      '<div class="rf-content">' +
        '<nav data-type="tableOfContents" class="rf-toc" data-min-level="1" data-max-level="6"><ul><li class="rf-toc__item" data-level="1"><a href="#rf-h-title--more">Title &amp; &lt;more&gt;</a></li></ul></nav>' +
        '<h1 id="rf-h-title--more">Title &amp; &lt;more&gt;</h1>' +
        '<p style="text-align:center" data-indent="2"><a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">a</a></p>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" disabled="" readOnly="" checked=""/><span></span></label><div><p>done</p></div></li></ul>' +
        '<div class="rf-table-wrapper"><table class="rf-table rf-table--fixed" style="width:150px" data-width-mode="fixed"><colgroup><col style="width:100px"/><col style="width:50px"/></colgroup>' +
        '<tbody><tr><td colSpan="2" data-colwidth="100,50" data-background="#ffeeaa" style="background-color:#ffeeaa"><p></p></td></tr></tbody></table></div>' +
        `<p><img src="${IMAGE_SRC}" alt="say &quot;hi&quot;" width="320" loading="lazy" decoding="async" data-attachment-id="${ATTACHMENT_ID}"/><br/></p>` +
        "</div>",
    );
  });
});
