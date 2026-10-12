// loadPageScreen reads ONE use case. The space's tree is the frame's (AppFrame loads it once per
// request into the PageTreeStore that the Move and Copy dialogs and the breadcrumb read live);
// reading it here as well cost a second query per view and shipped the tree twice in the RSC
// payload — to VIEW-only readers too, who are never offered Move or Copy.
// spec: docs/specs/10-ui-reference.md sections 4 and 11; docs/specs/08-api-surface.md section 3 (GET /pages/{id})
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageDetail, versionDetail } from "./fixtures";

const usecases = vi.hoisted(() => ({
  getPageView: vi.fn(),
  listPageTree: vi.fn(),
}));
vi.mock("@/server/usecases/pages", () => usecases);

const { loadPageScreen } = await import("../load-page");

const ACTOR = { id: "u-alice" } as unknown as Parameters<typeof loadPageScreen>[0];

beforeEach(() => {
  vi.clearAllMocks();
  usecases.getPageView.mockResolvedValue({ space: { key: "TEAM", name: "Team", extra: "x" }, page: pageDetail(), version: versionDetail() });
  usecases.listPageTree.mockResolvedValue({ pages: [] });
});

describe("loadPageScreen", () => {
  it("reads the page and the version through getPageView only — never the space's tree", async () => {
    const screen = await loadPageScreen(ACTOR, "team", "p1", 3);
    expect(usecases.getPageView).toHaveBeenCalledTimes(1);
    expect(usecases.getPageView).toHaveBeenCalledWith(ACTOR, "team", "p1", 3);
    expect(usecases.listPageTree).not.toHaveBeenCalled();
    expect(screen).toEqual({ space: { key: "TEAM", name: "Team" }, page: pageDetail(), version: versionDetail() });
    expect(screen).not.toHaveProperty("pages");
  });

  it("passes a use case's failure on unchanged (the route turns NotFoundError into the 404 page)", async () => {
    const boom = new Error("not found");
    usecases.getPageView.mockRejectedValueOnce(boom);
    await expect(loadPageScreen(ACTOR, "team", "p1")).rejects.toBe(boom);
  });
});
