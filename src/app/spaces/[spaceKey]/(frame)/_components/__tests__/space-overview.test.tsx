// @vitest-environment jsdom
// The space overview (10 §11): the space name as h1, the whole page tree, `?highlight=` (View in
// Hierarchy, RD-059) opening the path, marking the page and scrolling it into view once.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageSummary } from "@/domain/documents";
import { PageTree } from "@/ui/page-tree/page-tree";
import { PageTreeProvider } from "@/ui/page-tree/provider";
import { fakeApi, page, sampleTree, settle, type FakeApi } from "@/ui/page-tree/__tests__/fake-api";
import { SpaceOverview } from "../space-overview";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/spaces/TEAM" }));

let api: FakeApi;
const scrolled: Element[] = [];
beforeEach(() => {
  api = fakeApi();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this);
  };
  router.push.mockReset();
});
afterEach(cleanup);

function overview(options: { highlightId?: string | null; pages?: PageSummary[]; layoutPages?: PageSummary[]; canEdit?: boolean; withSidebarTree?: boolean } = {}) {
  const pages = options.pages ?? sampleTree();
  return render(
    <PageTreeProvider
      spaceKey="TEAM"
      canEdit={options.canEdit ?? true}
      initial={{ status: "ready", pages: options.layoutPages ?? pages }}
      fetchImpl={api.fetchImpl}
      storage={() => null}
    >
      {options.withSidebarTree ? <PageTree variant="sidebar" label={t("tree.label")} /> : null}
      <SpaceOverview space={{ key: "TEAM", name: "Team" }} initial={{ status: "ready", pages }} highlightId={options.highlightId ?? null} />
    </PageTreeProvider>,
  );
}

const overviewTree = () => screen.getByRole("tree", { name: t("overview.tree", { space: "Team" }) });

describe("SpaceOverview", () => {
  it("is headed by the space name and shows the page tree", () => {
    overview();
    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeTruthy();
    expect(within(overviewTree()).getAllByRole("treeitem").map((el) => el.getAttribute("data-tree-id"))).toEqual(["s", "team"]);
  });

  it("offers Create a page at the root to editors, and nothing to readers", async () => {
    overview();
    fireEvent.click(screen.getByRole("button", { name: t("tree.createPage") }));
    await act(() => settle());
    expect(api.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages", body: { parentId: null } });
    cleanup();
    overview({ canEdit: false });
    expect(screen.queryByRole("button", { name: t("tree.createPage") })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create a page under/ })).toBeNull();
  });

  it("shows the empty space's string, with Create a page for editors", () => {
    overview({ pages: [] });
    expect(screen.getByText(t("space.empty"))).toBeTruthy();
    expect(screen.getAllByRole("button", { name: t("tree.createPage") })).toHaveLength(1);
  });

  it("shows the pages it was rendered with while the store has nothing it fetched itself", async () => {
    overview({ layoutPages: [page("old", "Old")], pages: sampleTree() });
    await act(() => settle());
    expect(within(overviewTree()).getAllByRole("treeitem").map((el) => el.getAttribute("data-tree-id"))).toEqual(["s", "team"]);
  });

  it("a payload rendered before a confirmed move (Back to the overview) does not undo the move", async () => {
    const layoutInitial = { status: "ready" as const, pages: sampleTree() };
    const ui = (pages: PageSummary[]) => (
      <PageTreeProvider spaceKey="TEAM" canEdit initial={layoutInitial} fetchImpl={api.fetchImpl} storage={() => null}>
        <SpaceOverview space={{ key: "TEAM", name: "Team" }} initial={{ status: "ready", pages }} highlightId={null} />
      </PageTreeProvider>
    );
    const { rerender } = render(ui(sampleTree()));
    const specs = () => within(overviewTree()).getByRole("treeitem", { name: "Specifications" });
    const childOrder = () => within(specs()).getAllByRole("treeitem").map((el) => el.getAttribute("data-tree-id"));
    fireEvent.click(specs().querySelector("[data-toggle]") as Element);
    const t1 = within(overviewTree()).getByRole("treeitem", { name: "Test session 1" });
    act(() => t1.focus());
    fireEvent.keyDown(t1, { key: "ArrowUp", altKey: true });
    await act(() => settle());
    expect(api.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages/t1/move", body: { parentId: "s", index: 0 } });
    await act(async () => {
      api.calls[0]?.respond(200, page("t1", "Test session 1", "s", 0));
      await settle();
    });
    const moved = sampleTree().map((p) => (p.id === "t1" ? { ...p, ordinal: 0 } : p.id === "h" ? { ...p, ordinal: 1 } : p));
    await act(async () => {
      api.pending().find((c) => c.method === "GET")?.respond(200, moved);
      await settle();
    });
    expect(childOrder()).toEqual(["t1", "h", "t1a"]);

    rerender(ui(sampleTree())); // Next replays the overview's cached, pre-move payload
    await act(() => settle());
    expect(childOrder()).toEqual(["t1", "h", "t1a"]);
  });
});

describe("SpaceOverview — ?highlight= (View in Hierarchy, RD-059)", () => {
  it("opens the path to the page, marks it and scrolls it into view once", () => {
    overview({ highlightId: "n" });
    const tree = within(overviewTree());
    expect(tree.getByRole("treeitem", { name: "Specifications" })).toHaveAttribute("aria-expanded", "true");
    expect(tree.getByRole("treeitem", { name: "Test session 1a" })).toHaveAttribute("aria-expanded", "true");
    const notes = tree.getByRole("treeitem", { name: "Notes" });
    expect(notes).toHaveAttribute("aria-current", "true");
    expect((notes.firstElementChild as HTMLElement).className).toMatch(/ring-amber-400/);
    expect(notes.tabIndex).toBe(0);
    expect(scrolled).toEqual([notes]);
    // Only that page is marked.
    expect(tree.getAllByRole("treeitem").filter((el) => el.hasAttribute("aria-current"))).toEqual([notes]);
  });

  it("scrolls once only, even when the row renders again", () => {
    overview({ highlightId: "n" });
    fireEvent.click(within(overviewTree()).getByRole("treeitem", { name: "Notes" }).querySelector("button") as Element);
    expect(scrolled).toHaveLength(1);
  });

  it("opens the same path in the sidebar's tree, which shares the store", () => {
    overview({ highlightId: "n", withSidebarTree: true });
    const sidebarTree = screen.getByRole("tree", { name: t("tree.label") });
    expect(within(sidebarTree).getByRole("treeitem", { name: "Test session 1a" })).toHaveAttribute("aria-expanded", "true");
    // The sidebar does not mark it: the highlight belongs to the overview.
    expect(within(sidebarTree).getByRole("treeitem", { name: "Notes" })).not.toHaveAttribute("aria-current");
  });

  it("ignores an id that is not in the tree", () => {
    overview({ highlightId: "ghost" });
    const tree = within(overviewTree());
    expect(tree.getAllByRole("treeitem").filter((el) => el.hasAttribute("aria-current"))).toEqual([]);
    expect(tree.getByRole("treeitem", { name: "Specifications" })).toHaveAttribute("aria-expanded", "false");
    expect(scrolled).toEqual([]);
  });
});
