// The two route files are thin, and these tests keep them so: a malformed ?a&b pair is the 404 page
// before anything is loaded (never a 500), a NotFoundError from the use cases is the 404 page, and
// any other failure reaches the error boundary unchanged.
// spec: docs/specs/10-ui-reference.md section 11; docs/specs/09-decision-log.md sections RD-051, RD-060, RD-072
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/domain/errors";

const NOT_FOUND = vi.hoisted(() => new Error("NEXT_NOT_FOUND"));
const mocks = vi.hoisted(() => ({
  loadComparison: vi.fn(),
  loadHistory: vi.fn(),
  requireUser: vi.fn(async () => ({ id: "u-alice", name: "Alice Admin" })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));
vi.mock("@/server/authz/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("../_lib/load-history", () => ({ loadComparison: mocks.loadComparison, loadHistory: mocks.loadHistory }));

const { default: CompareVersionsRoute, generateMetadata: compareMetadata } = await import("../compare/page");
const { default: PageHistoryRoute } = await import("../page");
const { detail, doc, p, page, version } = await import("../_lib/__tests__/fixtures");

const params = Promise.resolve({ spaceKey: "team", pageId: "p-spec" });
const compareProps = (search: Record<string, string | string[]>) => ({ params, searchParams: Promise.resolve(search) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadComparison.mockResolvedValue({
    space: { key: "TEAM" },
    page: page(),
    left: detail(1, doc(p("A")), { message: null }),
    right: detail(2, doc(p("B")), { current: true }),
    blocks: [],
    approximate: false,
  });
  mocks.loadHistory.mockResolvedValue({
    space: { key: "TEAM", name: "Team" },
    page: page(),
    versions: [version(2, { current: true }), version(1)],
  });
});

describe("compare/page.tsx", () => {
  it.each([
    [{ a: "3", b: "3" }],
    [{ b: "3" }],
    [{ a: "x", b: "3" }],
    [{ a: "1", b: "99999999999999999999" }],
    [{ a: ["1", "2"], b: "3" }],
    [{}],
  ])("is the 404 page for %j, without loading anything", async (search) => {
    await expect(CompareVersionsRoute(compareProps(search))).rejects.toBe(NOT_FOUND);
    await expect(compareMetadata(compareProps(search))).rejects.toBe(NOT_FOUND);
    expect(mocks.loadComparison).not.toHaveBeenCalled();
  });

  it("passes the pair to the loader in the order given and renders what it returns", async () => {
    const element = await CompareVersionsRoute(compareProps({ a: "2", b: "1" }));
    expect(mocks.loadComparison).toHaveBeenCalledWith(expect.objectContaining({ id: "u-alice" }), "team", "p-spec", { a: 2, b: 1 });
    expect(element.props.model.left.number).toBe(1);
    expect(await compareMetadata(compareProps({ a: "2", b: "1" }))).toEqual({ title: "Compare v. 1 with v. 2 – Specifications" });
  });

  it("is the 404 page when the use case says not found, and rethrows anything else", async () => {
    mocks.loadComparison.mockRejectedValueOnce(new NotFoundError("Version"));
    await expect(CompareVersionsRoute(compareProps({ a: "1", b: "2" }))).rejects.toBe(NOT_FOUND);
    const boom = new Error("database down");
    mocks.loadComparison.mockRejectedValueOnce(boom);
    await expect(CompareVersionsRoute(compareProps({ a: "1", b: "3" }))).rejects.toBe(boom);
  });
});

describe("history/page.tsx", () => {
  it("is the 404 page when the use case says not found, and rethrows anything else", async () => {
    mocks.loadHistory.mockRejectedValueOnce(new NotFoundError("Page"));
    await expect(PageHistoryRoute({ params })).rejects.toBe(NOT_FOUND);
    const boom = new Error("database down");
    mocks.loadHistory.mockRejectedValueOnce(boom);
    await expect(PageHistoryRoute({ params: Promise.resolve({ spaceKey: "team", pageId: "other" }) })).rejects.toBe(boom);
  });

  it("renders for the signed-in user", async () => {
    const element = await PageHistoryRoute({ params });
    expect(mocks.requireUser).toHaveBeenCalled();
    expect(mocks.loadHistory).toHaveBeenCalledWith(expect.objectContaining({ id: "u-alice" }), "team", "p-spec");
    expect(element.props["data-testid"]).toBe("page-history");
  });
});
