// GET /pages/{id}?format=html (spec 08 §3, RD-069): the rendered fragment from the shared
// renderer, sandboxed by CSP, never sniffed, never stored by a shared cache; RENDER_UNSUPPORTED
// is a 500 with that code. The session lookup and the use case are stubbed (the database side is
// covered by the integration tests); the renderer is the real one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageDetail, VersionDetail } from "@/domain/documents";
import { AppError, NotFoundError } from "@/domain/errors";
import { renderDocumentHtml } from "@/editor/render/to-html";
import type * as ToHtml from "@/editor/render/to-html";
import type { Actor } from "@/server/authz/actor";
import { userFromRequest } from "@/server/authz/request-user";
import { getPageView, type PageView } from "@/server/usecases/pages";
import { GET } from "../spaces/[spaceKey]/pages/[id]/route";

vi.mock("@/server/authz/request-user", () => ({ userFromRequest: vi.fn() }));
vi.mock("@/server/usecases/pages", () => ({ getPageView: vi.fn(), publishPage: vi.fn(), renamePage: vi.fn(), deletePage: vi.fn() }));
vi.mock("@/editor/render/to-html", async (importOriginal) => {
  const real = await importOriginal<typeof ToHtml>();
  return { ...real, renderDocumentHtml: vi.fn(real.renderDocumentHtml) };
});

const ACTOR: Actor = { id: "u1", email: "c@reqforge.test", name: "Carol", isInstanceAdmin: false, sidebarCollapsed: false };

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Scope" }] },
    { type: "paragraph", content: [{ type: "text", text: '<script>alert("x")</script> & more' }] },
  ],
};

function view(content: unknown, number = 3): PageView {
  const version: VersionDetail = {
    number,
    title: "Spec",
    message: null,
    author: { id: "u1", name: "Carol" },
    createdAt: "2026-10-09T00:00:00.000Z",
    current: true,
    pinned: false,
    content,
  };
  return { space: {} as PageView["space"], page: { id: "p1" } as PageDetail, version };
}

function get(query: string): Promise<Response> {
  const req = new Request(`http://reqforge.test/api/v1/spaces/TEAM/pages/p1${query}`, { headers: { host: "reqforge.test", cookie: "rf_session=x" } });
  return GET(req, { params: Promise.resolve({ spaceKey: "TEAM", id: "p1" }) });
}

beforeEach(() => {
  vi.mocked(userFromRequest).mockResolvedValue(ACTOR);
  vi.mocked(getPageView).mockResolvedValue(view(CONTENT));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /pages/{id}?format=html", () => {
  it("returns the shared renderer's fragment with every value escaped", async () => {
    const res = await get("?format=html");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toBe(renderDocumentHtml(CONTENT));
    expect(html.startsWith('<div class="rf-content">')).toBe(true);
    expect(html).toContain("Scope</h2>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
    expect(html).not.toContain("<script>");
  });

  it("is text/html; charset=utf-8, sandboxed, never sniffed and never cached by a shared cache", async () => {
    const res = await get("?format=html");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("renders the requested version: ?version=N reaches the use case", async () => {
    vi.mocked(getPageView).mockResolvedValueOnce(view({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "old text" }] }] }, 1));
    const res = await get("?version=1&format=html");
    expect(vi.mocked(getPageView)).toHaveBeenCalledWith(ACTOR, "TEAM", "p1", 1);
    expect(await res.text()).toContain("old text");
  });

  it("answers JSON without ?format, and for ?format=json", async () => {
    for (const query of ["", "?format=json"]) {
      const res = await get(query);
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await res.json()).toMatchObject({ page: { id: "p1" }, version: { number: 3, content: CONTENT } });
    }
  });

  it("answers RENDER_UNSUPPORTED from the renderer with a 500 carrying that code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(renderDocumentHtml).mockImplementationOnce(() => {
      throw new AppError("RENDER_UNSUPPORTED", "refusing <svg>");
    });
    const res = await get("?format=html");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ code: "RENDER_UNSUPPORTED", status: 500 });
    expect(body).not.toContain("svg");
  });

  it("does not render when the page is not found", async () => {
    vi.mocked(getPageView).mockRejectedValueOnce(new NotFoundError("Page"));
    vi.mocked(renderDocumentHtml).mockClear();
    const res = await get("?format=html");
    expect(res.status).toBe(404);
    expect(vi.mocked(renderDocumentHtml)).not.toHaveBeenCalled();
  });
});
