// @vitest-environment jsdom
// The page tree component (10 §3.2): ARIA tree roles and keys, expand/collapse, the current page
// in bold, remembered expansion with a failing localStorage, drag and drop with DataTransfer
// stand-ins, rollback of a refused move, stale responses, edit-only affordances, the "+" guard.
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageSummary } from "@/domain/documents";
import type { StorageLike, StorageSource } from "@/ui/page-tree/expansion-storage";
import { PAGE_DRAG_TYPE, PageTree, type PageTreeVariant } from "@/ui/page-tree/page-tree";
import { PageTreeProvider } from "@/ui/page-tree/provider";
import type { InitialTree } from "@/ui/page-tree/store";
import { fakeApi, page, problem, sampleTree, settle, type FakeApi } from "@/ui/page-tree/__tests__/fake-api";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
let pathname = "/spaces/TEAM";
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => pathname }));

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  pathname = "/spaces/TEAM";
  router.push.mockReset();
});
afterEach(cleanup);

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

interface Options {
  readonly canEdit?: boolean;
  readonly pages?: PageSummary[];
  readonly initial?: InitialTree | null;
  readonly variant?: PageTreeVariant;
  readonly storage?: StorageSource;
}

function tree(options: Options = {}) {
  const initial = options.initial !== undefined ? options.initial : { status: "ready" as const, pages: options.pages ?? sampleTree() };
  const ui = (props: Options = options) => (
    <PageTreeProvider
      spaceKey="TEAM"
      canEdit={props.canEdit ?? true}
      initial={initial}
      fetchImpl={api.fetchImpl}
      storage={props.storage ?? (() => memoryStorage())}
    >
      <PageTree variant={props.variant ?? "sidebar"} label={t("tree.label")} />
    </PageTreeProvider>
  );
  const result = render(ui());
  return { ...result, rerenderWith: (props: Options) => result.rerender(ui({ ...options, ...props })) };
}

const item = (name: string) => screen.getByRole("treeitem", { name });
const queryItem = (name: string) => screen.queryByRole("treeitem", { name });
const row = (name: string) => item(name).firstElementChild as HTMLElement;
const names = () => screen.queryAllByRole("treeitem").map((el) => el.getAttribute("data-tree-id"));
const key = (target: Element, k: string, mods: { altKey?: boolean; shiftKey?: boolean } = {}) => fireEvent.keyDown(target, { key: k, ...mods });
const flush = () => act(() => settle());

/** A DataTransfer stand-in: jsdom has none. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    get types() {
      return [...data.keys()];
    },
    setData: vi.fn((type: string, value: string) => void data.set(type, value)),
    getData: (type: string) => data.get(type) ?? "",
  };
}

/** Fires a drag event at `y` pixels into a 40-pixel row; returns whether the tree accepted it (preventDefault). */
function dragAt(type: "dragOver" | "drop", target: HTMLElement, y: number, transfer = dataTransfer()): boolean {
  target.getBoundingClientRect = () => ({ top: 100, bottom: 140, height: 40, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) });
  const event = createEvent[type](target, { dataTransfer: transfer });
  Object.defineProperty(event, "clientY", { value: 100 + y });
  fireEvent(target, event);
  return event.defaultPrevented;
}

describe("PageTree — structure (WAI-ARIA tree)", () => {
  it("is a named tree of treeitems with level, position and expanded state", () => {
    tree();
    const root = screen.getByRole("tree", { name: t("tree.label") });
    const items = within(root).getAllByRole("treeitem");
    expect(items.map((el) => el.getAttribute("data-tree-id"))).toEqual(["s", "team"]);
    expect(item("Specifications")).toHaveAttribute("aria-level", "1");
    expect(item("Specifications")).toHaveAttribute("aria-posinset", "1");
    expect(item("Specifications")).toHaveAttribute("aria-setsize", "2");
    expect(item("Specifications")).toHaveAttribute("aria-expanded", "false");
  });

  it("names each item by its title, as plain text, and links it to its page", () => {
    tree({ pages: [page("x", "<b>Not bold</b> & co")] });
    const x = item("<b>Not bold</b> & co");
    expect(x.querySelector("b")).toBeNull();
    expect(within(x).getByRole("link", { name: "<b>Not bold</b> & co" })).toHaveAttribute("href", "/spaces/TEAM/pages/x");
  });

  it("puts children in a group under their parent, with aria-level 2, once opened", () => {
    tree();
    fireEvent.click(row("Specifications").querySelector("[data-toggle]") as Element);
    expect(item("Specifications")).toHaveAttribute("aria-expanded", "true");
    const group = within(item("Specifications")).getByRole("group");
    expect(within(group).getAllByRole("treeitem").map((el) => el.getAttribute("aria-level"))).toEqual(["2", "2", "2"]);
    expect(item("Page Heading")).not.toHaveAttribute("aria-expanded"); // a leaf has no expanded state
  });

  it("collapses again with the chevron", () => {
    tree();
    const toggle = () => fireEvent.click(row("Specifications").querySelector("[data-toggle]") as Element);
    toggle();
    expect(queryItem("Page Heading")).not.toBeNull();
    toggle();
    expect(queryItem("Page Heading")).toBeNull();
    expect(item("Specifications")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("PageTree — the current page (10 §3.2)", () => {
  it("is bold and aria-current, with its ancestors open", () => {
    pathname = "/spaces/TEAM/pages/n";
    tree();
    expect(item("Specifications")).toHaveAttribute("aria-expanded", "true");
    expect(item("Test session 1a")).toHaveAttribute("aria-expanded", "true");
    expect(item("Notes")).toHaveAttribute("aria-current", "page");
    expect(within(item("Notes")).getByRole("link").className).toMatch(/\bfont-bold\b/);
    expect(item("Page Heading")).not.toHaveAttribute("aria-current");
    expect(within(item("Page Heading")).getByRole("link").className).not.toMatch(/\bfont-bold\b/);
  });

  it("follows client-side navigation, opening the new page's ancestors", async () => {
    const { rerenderWith } = tree();
    expect(queryItem("Members")).toBeNull();
    pathname = "/spaces/TEAM/pages/m";
    rerenderWith({});
    await flush();
    expect(item("Members")).toHaveAttribute("aria-current", "page");
  });
});

describe("PageTree — keyboard", () => {
  it("has exactly one tab stop: the current page", () => {
    pathname = "/spaces/TEAM/pages/h";
    tree();
    const stops = screen.getAllByRole("treeitem").filter((el) => el.tabIndex === 0);
    expect(stops.map((el) => el.getAttribute("data-tree-id"))).toEqual(["h"]);
  });

  it("walks with ↓ ↑ Home End and opens/closes with → ←, moving the tab stop with focus", () => {
    tree();
    const specs = item("Specifications");
    act(() => specs.focus());
    key(specs, "ArrowRight");
    expect(specs).toHaveAttribute("aria-expanded", "true");
    key(specs, "ArrowRight");
    expect(document.activeElement).toBe(item("Page Heading"));
    expect(item("Page Heading").tabIndex).toBe(0);
    expect(specs.tabIndex).toBe(-1);
    key(item("Page Heading"), "ArrowDown");
    expect(document.activeElement).toBe(item("Test session 1"));
    key(item("Test session 1"), "End");
    expect(document.activeElement).toBe(item("Team"));
    key(item("Team"), "Home");
    expect(document.activeElement).toBe(specs);
    key(item("Test session 1"), "ArrowLeft");
    expect(document.activeElement).toBe(specs);
    key(specs, "ArrowLeft");
    expect(specs).toHaveAttribute("aria-expanded", "false");
  });

  it("Enter opens the focused page", () => {
    tree();
    key(item("Team"), "Enter");
    expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/team");
  });

  it("describes the move keys to editors only", () => {
    tree();
    const help = screen.getByRole("tree").getAttribute("aria-describedby");
    expect(document.getElementById(help ?? "")?.textContent).toBe(t("tree.keyboardHelp"));
    cleanup();
    tree({ canEdit: false });
    expect(screen.getByRole("tree")).not.toHaveAttribute("aria-describedby");
  });
});

describe("PageTree — remembered expansion (localStorage)", () => {
  it("opens what was remembered for this space, and remembers changes", () => {
    const storage = memoryStorage({ "reqforge.pageTree.expanded.TEAM": JSON.stringify(["team"]) });
    tree({ storage: () => storage });
    expect(item("Team")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(row("Specifications").querySelector("[data-toggle]") as Element);
    expect(JSON.parse(storage.data.get("reqforge.pageTree.expanded.TEAM") ?? "[]")).toEqual(["team", "s"]);
  });

  it("renders and works when localStorage throws on every access", () => {
    const broken: StorageSource = () => {
      throw new DOMException("denied", "SecurityError");
    };
    tree({ storage: broken });
    fireEvent.click(row("Specifications").querySelector("[data-toggle]") as Element);
    expect(item("Specifications")).toHaveAttribute("aria-expanded", "true");
    expect(queryItem("Page Heading")).not.toBeNull();
  });
});

describe("PageTree — drag to reorder and re-parent (10 §3.2)", () => {
  it("drops onto a page as its last child: indicator, optimistic move, POST, refetch", async () => {
    tree();
    const transfer = dataTransfer();
    fireEvent.click(row("Specifications").querySelector("[data-toggle]") as Element);
    fireEvent.dragStart(row("Page Heading"), { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith(PAGE_DRAG_TYPE, "h");
    expect(dragAt("dragOver", row("Team"), 20, transfer)).toBe(true);
    expect(row("Team")).toHaveAttribute("data-drop", "inside");
    expect(dragAt("drop", row("Team"), 20, transfer)).toBe(true);
    // Shown at once, under an opened Team, and no indicator left behind.
    expect(item("Team")).toHaveAttribute("aria-expanded", "true");
    expect(within(item("Team")).getAllByRole("treeitem").map((el) => el.getAttribute("data-tree-id"))).toEqual(["m", "h"]);
    expect(document.querySelector("[data-drop]")).toBeNull();
    await flush();
    expect(api.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages/h/move", body: { parentId: "team", index: 1 } });
    await act(async () => {
      api.calls[0]?.respond(200, page("h", "Page Heading", "team", 1));
      await settle();
    });
    expect(api.calls[1]).toMatchObject({ method: "GET", url: "/api/v1/spaces/TEAM/pages" });
  });

  it("drops before and after a sibling, with a line where it will land", async () => {
    tree();
    fireEvent.dragStart(row("Team"));
    expect(dragAt("dragOver", row("Specifications"), 2)).toBe(true);
    expect(row("Specifications").querySelector('[data-drop-line="before"]')).not.toBeNull();
    dragAt("drop", row("Specifications"), 2);
    expect(names()).toEqual(["team", "s"]);
    await flush();
    expect(api.calls[0]?.body).toEqual({ parentId: null, index: 0 });
  });

  it("refuses, with no drop affordance, a drop on the page itself or a descendant (RD-056)", async () => {
    pathname = "/spaces/TEAM/pages/n"; // everything under Specifications is open
    tree();
    fireEvent.dragStart(row("Specifications"));
    for (const [name, y] of [
      ["Specifications", 20],
      ["Page Heading", 2],
      ["Test session 1a", 20],
      ["Notes", 38],
    ] as const) {
      expect(dragAt("dragOver", row(name), y), name).toBe(false);
      expect(row(name)).not.toHaveAttribute("data-drop");
      dragAt("drop", row(name), y);
    }
    await flush();
    expect(api.calls).toHaveLength(0);
    expect(names()).toEqual(["s", "h", "t1", "t1a", "n", "team"]);
  });

  it("ignores drags that did not start in the tree (files, text)", async () => {
    tree();
    expect(dragAt("dragOver", row("Team"), 20)).toBe(false);
    dragAt("drop", row("Team"), 20);
    await flush();
    expect(api.calls).toHaveLength(0);
  });

  it("rolls back a refused move, says why, and refetches (rollback)", async () => {
    tree();
    fireEvent.dragStart(row("Team"));
    dragAt("drop", row("Specifications"), 20);
    expect(item("Specifications")).toHaveAttribute("aria-expanded", "true");
    expect(within(item("Specifications")).queryByRole("treeitem", { name: "Team" })).not.toBeNull();
    await flush();
    await act(async () => {
      api.calls[0]?.respond(422, problem(422, "VALIDATION"));
      await settle();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(t("tree.move.invalid"));
    expect(within(item("Specifications")).queryByRole("treeitem", { name: "Team" })).toBeNull();
    expect(item("Team")).toHaveAttribute("aria-level", "1");
    expect(api.calls[1]).toMatchObject({ method: "GET" });
    fireEvent.click(screen.getByRole("button", { name: t("tree.alert.dismiss") }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the moved page where it was dropped while the request is in flight", async () => {
    const { rerenderWith } = tree();
    fireEvent.dragStart(row("Team"));
    dragAt("drop", row("Specifications"), 2);
    await flush();
    // A navigation refetch lands before the move's answer, with the server's pre-move tree.
    pathname = "/spaces/TEAM/pages/h";
    rerenderWith({});
    await flush();
    const refetch = api.pending().find((c) => c.method === "GET");
    await act(async () => {
      refetch?.respond(200, sampleTree());
      await settle();
    });
    expect(screen.getByRole("tree").firstElementChild?.getAttribute("data-tree-id")).toBe("team");
  });
});

describe("PageTree — moving with the keyboard", () => {
  it("Alt+↑ moves the page up, keeps focus on it and announces where it went", async () => {
    pathname = "/spaces/TEAM/pages/t1";
    tree();
    act(() => item("Test session 1").focus());
    key(item("Test session 1"), "ArrowUp", { altKey: true });
    expect(within(item("Specifications")).getAllByRole("treeitem").map((el) => el.getAttribute("data-tree-id")).slice(0, 2)).toEqual(["t1", "h"]);
    await flush();
    expect(document.activeElement).toBe(item("Test session 1"));
    expect(api.calls[0]?.body).toEqual({ parentId: "s", index: 0 });
    await act(async () => {
      api.calls[0]?.respond(200, page("t1", "Test session 1", "s", 0));
      await settle();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      t("tree.moved.under", { title: "Test session 1", parent: "Specifications", position: 1, count: 3 }),
    );
  });

  it("Alt+Shift+→ moves it under the page above, which opens; focus follows it", async () => {
    pathname = "/spaces/TEAM/pages/t1";
    tree();
    act(() => item("Test session 1").focus());
    key(item("Test session 1"), "ArrowRight", { altKey: true, shiftKey: true });
    expect(item("Page Heading")).toHaveAttribute("aria-expanded", "true");
    expect(item("Test session 1")).toHaveAttribute("aria-level", "3");
    await flush();
    expect(document.activeElement).toBe(item("Test session 1"));
    expect(api.calls[0]?.body).toEqual({ parentId: "h", index: 0 });
  });

  it("a refused keyboard move goes back, keeps focus, and alerts", async () => {
    pathname = "/spaces/TEAM/pages/h";
    tree();
    act(() => item("Page Heading").focus());
    key(item("Page Heading"), "ArrowLeft", { altKey: true, shiftKey: true });
    expect(item("Page Heading")).toHaveAttribute("aria-level", "1");
    await flush();
    await act(async () => {
      api.calls[0]?.respond(403, problem(403, "FORBIDDEN"));
      await settle();
    });
    expect(item("Page Heading")).toHaveAttribute("aria-level", "2");
    expect(document.activeElement).toBe(item("Page Heading"));
    expect(screen.getByRole("alert")).toHaveTextContent(t("tree.move.forbidden"));
  });
});

describe("PageTree — freshness", () => {
  it("applies the newest refetch even when an older one answers last (stale-response guard)", async () => {
    const { rerenderWith } = tree();
    pathname = "/spaces/TEAM/pages/h";
    rerenderWith({});
    pathname = "/spaces/TEAM/pages/t1";
    rerenderWith({});
    await flush();
    const [older, newer] = api.calls.filter((c) => c.method === "GET");
    expect(older && newer).toBeTruthy();
    await act(async () => {
      newer?.respond(200, [page("fresh", "Fresh")]);
      await settle();
    });
    await act(async () => {
      older?.respond(200, [page("stale", "Stale")]);
      await settle();
    });
    expect(names()).toEqual(["fresh"]);
  });

  it("adopts newer pages when the layout re-renders (router.refresh)", () => {
    const { rerender } = tree();
    rerender(
      <PageTreeProvider spaceKey="TEAM" canEdit initial={{ status: "ready", pages: [page("z", "Zed")] }} fetchImpl={api.fetchImpl} storage={() => null}>
        <PageTree variant="sidebar" label={t("tree.label")} />
      </PageTreeProvider>,
    );
    expect(names()).toEqual(["z"]);
  });
});

describe("PageTree — viewers who cannot edit", () => {
  it("get no '+', no draggable rows, no drop targets and no move keys", async () => {
    pathname = "/spaces/TEAM/pages/t1";
    tree({ canEdit: false });
    expect(screen.queryAllByRole("button", { name: /Create a page/ })).toHaveLength(0);
    expect(row("Team")).not.toHaveAttribute("draggable");
    fireEvent.dragStart(row("Page Heading"));
    expect(dragAt("dragOver", row("Team"), 20)).toBe(false);
    act(() => item("Test session 1").focus());
    key(item("Test session 1"), "ArrowUp", { altKey: true });
    await flush();
    expect(api.calls).toHaveLength(0);
  });
});

describe("PageTree — create a child page (RD-056)", () => {
  it("'+' creates one page per press and opens its editor", async () => {
    tree();
    const plus = within(row("Team")).getByRole("button", { name: t("tree.createChild", { title: "Team" }) });
    fireEvent.click(plus);
    fireEvent.click(plus);
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages", body: { parentId: "team" } });
    expect(plus).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      api.calls[0]?.respond(201, { ...page("new", "Untitled", "team", 1), spaceKey: "TEAM" });
      await settle();
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/new/edit");
    fireEvent.click(plus);
    await flush();
    expect(api.calls).toHaveLength(1);
  });

  it("shows an alert when the parent has gone, and lets the user try again", async () => {
    tree();
    fireEvent.click(within(row("Team")).getByRole("button", { name: t("tree.createChild", { title: "Team" }) }));
    await flush();
    await act(async () => {
      api.calls[0]?.respond(422, problem(422, "VALIDATION"));
      await settle();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(t("tree.create.parentGone"));
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(within(row("Specifications")).getByRole("button", { name: t("tree.createChild", { title: "Specifications" }) }));
    await flush();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("the '+' of the focused row is in the Tab order, the others are not", () => {
    pathname = "/spaces/TEAM/pages/h";
    tree();
    const plusOf = (name: string) => within(row(name)).getByRole("button", { name: t("tree.createChild", { title: name }) });
    expect(plusOf("Page Heading").tabIndex).toBe(0);
    expect(plusOf("Team").tabIndex).toBe(-1);
  });
});

describe("PageTree — empty, loading and error states (10 §12)", () => {
  it("an empty space: the sidebar's empty state, with Create a page for editors", async () => {
    tree({ pages: [] });
    expect(screen.getByText(t("sidebar.pageTree.empty"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("tree.createPage") }));
    await flush();
    expect(api.calls[0]).toMatchObject({ method: "POST", body: { parentId: null } });
    cleanup();
    tree({ pages: [], canEdit: false });
    expect(screen.getByText(t("sidebar.pageTree.empty"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("tree.createPage") })).toBeNull();
  });

  it("the overview's empty state is the space's", () => {
    tree({ pages: [], variant: "overview" });
    expect(screen.getByText(t("space.empty"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("tree.createPage") })).toBeTruthy();
  });

  it("a tree that failed to load says so and retries", async () => {
    tree({ initial: { status: "error" } });
    expect(screen.getByRole("alert")).toHaveTextContent(t("tree.error"));
    fireEvent.click(screen.getByRole("button", { name: t("tree.retry") }));
    expect(screen.getByText(t("tree.loading"))).toBeTruthy();
    await act(async () => {
      api.calls[0]?.respond(200, sampleTree());
      await settle();
    });
    expect(names()).toEqual(["s", "team"]);
  });

  it("loads by itself when the server passed nothing", async () => {
    tree({ initial: null });
    expect(screen.getByText(t("tree.loading"))).toBeTruthy();
    await flush();
    await act(async () => {
      api.calls[0]?.respond(200, [page("a", "Alpha")]);
      await settle();
    });
    expect(names()).toEqual(["a"]);
  });
});
