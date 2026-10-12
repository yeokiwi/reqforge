// @vitest-environment jsdom
// The page view's header row (10 §4.1): breadcrumb (from the frame's live tree), byline icons,
// Edit (and `E`), the two per-user toggles with rollback, Share, and the dialog seam the `···`
// menu and 📎 open.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail, PageSummary } from "@/domain/documents";
import type { PageTreeStore } from "@/ui/page-tree/store";
import { pageCrumbs } from "@/ui/page-view/breadcrumb";
import { PAGES, pageDetail } from "../../_lib/__tests__/fixtures";
import { PageHeader, type PageHeaderProps } from "../page-header";
import { TreeProvider } from "./tree-provider";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/spaces/TEAM/pages/p1" }));

// PageDialogs is pass 2's; stand in a dialog that shows what it was asked to open.
vi.mock("../page-dialogs", () => ({
  PageDialogs: ({ kind, page, space, onClose }: { kind: string; page: PageDetail; space: { key: string }; onClose: () => void }) => (
    <div role="dialog" aria-label={`dialog:${kind}`} data-page={page.id} data-space={space.key}>
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

const FAVOURITE = "/api/v1/spaces/TEAM/pages/p1/favourite";
const WATCH = "/api/v1/spaces/TEAM/pages/p1/watch";

type Call = { method: string; url: string };
let calls: Call[];
let respond: (call: Call) => Response | Promise<Response>;
const fetchImpl = (url: string, init?: RequestInit) => {
  const call = { method: init?.method ?? "GET", url };
  calls.push(call);
  return Promise.resolve(respond(call));
};

const noContent = () => new Response(null, { status: 204 });
const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: code, status, detail: "", code }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

beforeEach(() => {
  calls = [];
  respond = noContent;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

let store: PageTreeStore | null = null;

/** The header inside the frame's tree provider; `live` is the tree the store holds (null: it failed to load). */
function header(over: Partial<PageHeaderProps> = {}, page: Partial<PageDetail> = {}, live: readonly PageSummary[] | null = PAGES) {
  const detail = pageDetail(page);
  const props: PageHeaderProps = {
    space: { key: "TEAM", name: "Team" },
    page: detail,
    crumbs: pageCrumbs("TEAM", detail.ancestors, detail.title),
    viewHref: "/spaces/TEAM/pages/p1",
    editHref: "/spaces/TEAM/pages/p1/edit",
    fetchImpl,
    ...over,
  };
  return render(
    <TreeProvider pages={live} fetchImpl={props.fetchImpl ?? fetchImpl} onStore={(s) => (store = s)}>
      <PageHeader {...props} />
    </TreeProvider>,
  );
}

const theStore = () => {
  if (store === null) throw new Error("no store");
  return store;
};

const crumbTrail = () =>
  within(screen.getByRole("navigation", { name: t("pageView.breadcrumb") }))
    .getAllByRole("listitem")
    .map((item) => (item.textContent ?? "").replace("/", "").trim());

const button = (name: string) => screen.getByRole("button", { name });

describe("header row layout (10 §4)", () => {
  it("has the breadcrumb, the three byline icons, and the actions in the video's order", () => {
    header();
    const crumbs = within(screen.getByRole("navigation", { name: t("pageView.breadcrumb") }));
    expect(crumbs.getByRole("link", { name: "Pages" })).toHaveAttribute("href", "/spaces/TEAM");
    expect(crumbs.getByRole("link", { name: "Product" })).toHaveAttribute("href", "/spaces/TEAM/pages/p0");
    expect(crumbs.queryByRole("link", { name: "Specifications" })).toBeNull();
    expect(crumbs.getByText("Specifications")).toHaveAttribute("aria-current", "page");

    const icons = within(screen.getByTestId("byline-icons")).getAllByRole("button");
    expect(icons.map((b) => b.getAttribute("aria-label"))).toEqual([
      t("restrictions.title"),
      t("pageMenu.attachments"),
      t("pageView.byline.requirements"),
    ]);

    const group = screen.getByRole("group", { name: t("pageView.actions") });
    const names = Array.from(group.querySelectorAll("a, button")).map((el) => el.getAttribute("aria-label") ?? el.textContent);
    expect(names).toEqual([t("page.edit"), t("page.saveForLater"), t("page.watching"), t("page.share"), t("pageMenu.label")]);
  });

  it("the padlock and the requirements icon are inert, titled 'Not available yet' (RD-059)", () => {
    header();
    for (const name of [t("restrictions.title"), t("pageView.byline.requirements")]) {
      const icon = button(name);
      expect(icon).toHaveAttribute("aria-disabled", "true");
      expect(icon).toHaveAttribute("title", t("shell.later"));
      fireEvent.click(icon);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the breadcrumb follows the frame's live tree, not the render (RD-078)", () => {
  // The view rendered Specifications under Product; then it was dragged to the top level in the
  // sidebar of the same screen. The render was not refreshed; the frame's tree store was.
  const MOVED_TO_TOP: readonly PageSummary[] = [
    { ...(PAGES[0] as PageSummary) },
    { ...(PAGES[1] as PageSummary), parentId: null, ordinal: 1 },
  ];

  it("after a sidebar move to the top level it reads `Pages / Specifications`", () => {
    header({}, {}, MOVED_TO_TOP);
    expect(crumbTrail()).toEqual(["Pages", "Specifications"]);
    expect(screen.queryByRole("link", { name: "Product" })).toBeNull();
  });

  it("a move the tree makes while the view is open shows at once, and rolls back with it", async () => {
    respond = (call) => (call.method === "POST" ? problem(409, "CYCLE") : new Response(JSON.stringify(PAGES), { status: 200 }));
    header();
    expect(crumbTrail()).toEqual(["Pages", "Product", "Specifications"]);
    let moved: Promise<unknown> = Promise.resolve();
    act(() => {
      moved = theStore().move("p1", { parentId: null, index: 1 });
    });
    expect(crumbTrail()).toEqual(["Pages", "Specifications"]); // optimistic, as the sidebar shows it
    await act(async () => {
      await moved;
    });
    expect(crumbTrail()).toEqual(["Pages", "Product", "Specifications"]); // refused: rolled back
  });

  it("ancestors' titles are the live tree's", () => {
    header({}, {}, [{ ...(PAGES[0] as PageSummary), title: "Product (renamed)" }, { ...(PAGES[1] as PageSummary) }]);
    expect(screen.getByRole("link", { name: "Product (renamed)" })).toHaveAttribute("href", "/spaces/TEAM/pages/p0");
  });

  it("shows the render's crumbs while the live tree does not have the page", () => {
    header({}, {}, null);
    expect(crumbTrail()).toEqual(["Pages", "Product", "Specifications"]);
  });

  it("counts as a consumer of the tree while shown, so the store refetches on navigation even with the sidebar collapsed", async () => {
    respond = (call) => (call.method === "GET" ? new Response(JSON.stringify(MOVED_TO_TOP), { status: 200 }) : noContent());
    header();
    act(() => theStore().invalidate()); // what a navigation or the tab coming back does
    await waitFor(() => expect(crumbTrail()).toEqual(["Pages", "Specifications"]));
    expect(calls).toEqual([{ method: "GET", url: "/api/v1/spaces/TEAM/pages" }]);
  });
});

describe("✎ Edit and the E key", () => {
  it("Edit links to the editor", () => {
    header();
    const edit = screen.getByRole("link", { name: t("page.edit") });
    expect(edit).toHaveAttribute("href", "/spaces/TEAM/pages/p1/edit");
    expect(edit).toHaveAttribute("aria-keyshortcuts", "E");
  });

  it("is absent without permission or on a past version (editHref null), and E does nothing", () => {
    header({ editHref: null });
    expect(screen.queryByRole("link", { name: t("page.edit") })).toBeNull();
    fireEvent.keyDown(document.body, { key: "e" });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("E opens the editor", () => {
    header();
    fireEvent.keyDown(document.body, { key: "e" });
    expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p1/edit");
  });

  it("E does nothing in a field, with a modifier, or while a dialog is open", () => {
    const { container } = header();
    const input = document.createElement("input");
    container.appendChild(input);
    fireEvent.keyDown(input, { key: "e" });
    fireEvent.keyDown(document.body, { key: "e", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "E", shiftKey: true });
    fireEvent.click(button(t("pageMenu.attachments")));
    fireEvent.keyDown(document.body, { key: "e" });
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("Save for later and Watching (RD-061)", () => {
  it("start from the server's state, as toggle buttons", () => {
    header({}, { favourite: false, watching: true });
    expect(button(t("page.saveForLater"))).toHaveAttribute("aria-pressed", "false");
    expect(button(t("page.watching"))).toHaveAttribute("aria-pressed", "true");
  });

  it("Save for later: PUT to turn on, DELETE to turn off, flipping at once", async () => {
    header({}, { favourite: false });
    const save = button(t("page.saveForLater"));
    fireEvent.click(save);
    expect(save).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    fireEvent.click(save);
    expect(save).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(calls).toEqual([
      { method: "PUT", url: FAVOURITE },
      { method: "DELETE", url: FAVOURITE },
    ]);
  });

  it("Watching: DELETE to stop watching, PUT to watch again", async () => {
    header({}, { watching: true });
    const watch = button(t("page.watching"));
    fireEvent.click(watch);
    await waitFor(() => expect(watch).not.toHaveAttribute("aria-busy"));
    fireEvent.click(watch);
    await waitFor(() => expect(watch).not.toHaveAttribute("aria-busy"));
    expect(calls).toEqual([
      { method: "DELETE", url: WATCH },
      { method: "PUT", url: WATCH },
    ]);
    expect(watch).toHaveAttribute("aria-pressed", "true");
  });

  it("rolls back and says so when the server refuses", async () => {
    respond = () => problem(500, "INTERNAL");
    header({}, { watching: true, favourite: false });
    const watch = button(t("page.watching"));
    fireEvent.click(watch);
    expect(watch).toHaveAttribute("aria-pressed", "false"); // optimistic
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageView.watch.failed"));
    expect(watch).toHaveAttribute("aria-pressed", "true"); // rolled back

    fireEvent.click(button(t("page.saveForLater")));
    expect(await screen.findByText(t("pageView.favourite.failed"))).toBeTruthy();
    expect(button(t("page.saveForLater"))).toHaveAttribute("aria-pressed", "false");
  });

  it("a toggle that sticks refreshes the server's view of the page (Page information reads it); a failed one does not", async () => {
    header({}, { watching: true });
    const watch = button(t("page.watching"));
    fireEvent.click(watch);
    await waitFor(() => expect(watch).not.toHaveAttribute("aria-busy"));
    expect(router.refresh).toHaveBeenCalledTimes(1);

    respond = () => problem(500, "INTERNAL");
    fireEvent.click(watch);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageView.watch.failed"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("rolls back when the network is down", async () => {
    header({
      fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
    }, { favourite: true });
    const save = button(t("page.saveForLater"));
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageView.favourite.failed"));
    expect(save).toHaveAttribute("aria-pressed", "true");
  });

  it("a second press while the first is in flight sends nothing", async () => {
    let release: () => void = () => undefined;
    respond = () => new Promise<Response>((resolve) => (release = () => resolve(noContent())));
    header({}, { favourite: false });
    const save = button(t("page.saveForLater"));
    fireEvent.click(save);
    fireEvent.click(save);
    expect(calls).toHaveLength(1);
    expect(save).toHaveAttribute("aria-pressed", "true");
    await act(async () => release());
    expect(save).toHaveAttribute("aria-pressed", "true");
  });
});

describe("⇪ Share (RD-061: copy link)", () => {
  it("copies the page's absolute URL and announces it politely", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    header();
    const status = screen.getByTestId("page-actions-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    fireEvent.click(button(t("page.share")));
    await waitFor(() => expect(status).toHaveTextContent(t("pageShare.copied")));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/spaces/TEAM/pages/p1`);
  });

  it("the confirmation goes away by itself", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true });
    header();
    await act(async () => {
      fireEvent.click(button(t("page.share")));
    });
    const status = screen.getByTestId("page-actions-status");
    expect(status).toHaveTextContent(t("pageShare.copied"));
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(status.textContent).toBe("");
  });

  it("says so when the link cannot be copied", async () => {
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true, writable: true });
    header();
    fireEvent.click(button(t("page.share")));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageShare.failed"));
  });
});

describe("the dialog seam (pass 2 fills PageDialogs)", () => {
  it("📎 opens the Attachments dialog with the page and the space; closing returns focus to 📎", () => {
    header();
    const clip = button(t("pageMenu.attachments"));
    clip.focus();
    fireEvent.click(clip);
    const dialog = screen.getByRole("dialog", { name: "dialog:attachments" });
    expect(dialog).toHaveAttribute("data-page", "p1");
    expect(dialog).toHaveAttribute("data-space", "TEAM");
    fireEvent.click(within(dialog).getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(clip);
  });

  it("a menu item closes the menu, opens its dialog, and focus returns to ··· on close", () => {
    header();
    fireEvent.click(button(t("pageMenu.label")));
    fireEvent.click(screen.getByRole("menuitem", { name: t("pageMenu.info") }));
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "dialog:info" });
    fireEvent.click(within(dialog).getByRole("button", { name: "close" }));
    expect(document.activeElement).toBe(button(t("pageMenu.label")));
  });

  it("the menu's Attachments opens the same dialog as 📎", () => {
    header();
    fireEvent.click(button(t("pageMenu.label")));
    fireEvent.click(screen.getByRole("menuitem", { name: t("pageMenu.attachments") }));
    expect(screen.getByRole("dialog", { name: "dialog:attachments" })).toBeTruthy();
  });

  it.each([
    [t("pageMenu.copy"), "copy"],
    [t("pageMenu.move"), "move"],
    [t("pageMenu.delete"), "delete"],
  ])("%s opens the %s dialog", (label, kind) => {
    header();
    fireEvent.click(button(t("pageMenu.label")));
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(screen.getByRole("dialog", { name: `dialog:${kind}` })).toBeTruthy();
  });
});
