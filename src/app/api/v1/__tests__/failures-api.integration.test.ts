// Server faults through the REST API (spec 08 §3 and §3.2): an unexpected error is a 500 INTERNAL
// whose body says nothing about it (no message, stack, SQL or Prisma text) and is logged
// server-side; the renderer's refusal is a 500 with its own code RENDER_UNSUPPORTED. Both are
// induced with a mock, because stored content and a healthy database never cause them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/domain/errors";
import { renderDocumentHtml } from "@/editor/render/to-html";
import type * as ToHtml from "@/editor/render/to-html";
import { getPageView, listPageTree, publishPage } from "@/server/usecases/pages";
import type * as UseCases from "@/server/usecases/pages";
import { createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { resetDemoInstance } from "@/test-support/fixtures";
import { expectProblem, send, sessionFor } from "@/test-support/api-harness";
import * as pagesRoute from "../spaces/[spaceKey]/pages/route";
import * as pageRoute from "../spaces/[spaceKey]/pages/[id]/route";

vi.mock("@/server/usecases/pages", async (importOriginal) => {
  const real = await importOriginal<typeof UseCases>();
  return { ...real, listPageTree: vi.fn(real.listPageTree), publishPage: vi.fn(real.publishPage), getPageView: vi.fn(real.getPageView) };
});
vi.mock("@/editor/render/to-html", async (importOriginal) => {
  const real = await importOriginal<typeof ToHtml>();
  return { ...real, renderDocumentHtml: vi.fn(real.renderDocumentHtml) };
});

let alice: string;
beforeEach(async () => {
  await resetDemoInstance();
  alice = await sessionFor("alice");
});
afterEach(() => {
  vi.restoreAllMocks();
});

const LEAKS = ["SELECT", "prisma", "Prisma", "Document", "password", "at ", "node_modules", ".ts:", "ECONNREFUSED", "stack"];

describe("an unexpected error", () => {
  it.each<[string, unknown]>([
    ["a database error", Object.assign(new Error('Invalid `prisma.document.findMany()` invocation:\n\nRaw query failed. Code: `42P01`. Message: `relation "Document" does not exist` SELECT password FROM "User"'), { code: "P2010" })],
    ["a connection failure", new Error("connect ECONNREFUSED 127.0.0.1:5432")],
    ["an AppError whose code is not part of the API", new AppError("SCHEMA_INVARIANT", "The schema cannot build an empty document")],
    ["a thrown non-Error", { stack: "at secret (node_modules/x.ts:1:1)" }],
  ])("is a 500 INTERNAL with the generic detail when it is %s, and is logged server-side", async (_label, thrown) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(listPageTree).mockRejectedValueOnce(thrown);
    const res = await send(pagesRoute.GET, "GET", "/api/v1/spaces/TEAM/pages", { spaceKey: "TEAM" }, { session: alice });
    const text = await res.clone().text();
    const problem = await expectProblem(res, 500, "INTERNAL");
    expect(problem.detail).toBe("Something went wrong on the server.");
    expect(Object.keys(problem).sort()).toEqual(["code", "detail", "status", "title", "type"]);
    for (const leak of LEAKS) expect(text).not.toContain(leak);
    expect(log).toHaveBeenCalled();
  });

  it("on a write is a 500 that leaks nothing either", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = await createPageAs("alice", "team", { title: "Spec" });
    vi.mocked(publishPage).mockRejectedValueOnce(new Error("deadlock detected on relation DocumentVersion"));
    const res = await send(pageRoute.PUT, "PUT", `/api/v1/spaces/TEAM/pages/${page.id}`, { spaceKey: "TEAM", id: page.id }, {
      session: alice,
      json: { title: "Spec", content: paragraphDoc("x"), baseVersion: 1 },
    });
    const text = await res.clone().text();
    await expectProblem(res, 500, "INTERNAL");
    expect(text).not.toContain("deadlock");
  });
});

describe("?format=html when the renderer refuses", () => {
  it("is a 500 with the code RENDER_UNSUPPORTED (08 §3), and nothing of the renderer's message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const page = await createPageAs("alice", "team", { title: "Spec" });
    vi.mocked(renderDocumentHtml).mockImplementationOnce(() => {
      throw new AppError("RENDER_UNSUPPORTED", "refusing to serialise <svg> inside node xyz");
    });
    const res = await send(pageRoute.GET, "GET", `/api/v1/spaces/TEAM/pages/${page.id}?format=html`, { spaceKey: "TEAM", id: page.id }, { session: alice });
    const text = await res.clone().text();
    await expectProblem(res, 500, "RENDER_UNSUPPORTED");
    expect(text).not.toContain("svg");
    expect(text).not.toContain("xyz");
    // The renderer was handed the stored content of the page the caller may see.
    expect(vi.mocked(getPageView)).toHaveBeenCalledWith(expect.objectContaining({ email: "alice@reqforge.test" }), "TEAM", page.id, undefined);
    expect(vi.mocked(renderDocumentHtml)).toHaveBeenCalledWith(paragraphDoc("Spec v1"));
  });
});
