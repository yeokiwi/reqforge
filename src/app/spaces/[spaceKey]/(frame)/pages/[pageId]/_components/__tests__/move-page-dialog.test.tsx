// @vitest-environment jsdom
// `···` → Move (RD-056, RD-067, RD-070): the listbox offers the top level and every page except
// the moved page and its descendants — from the frame's live page tree, the one the sidebar shows,
// never from the view's render; keyboard and filter; `{ parentId, index }` as the API takes it;
// every mapped refusal; one move per press; Escape.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail, PageSummary } from "@/domain/documents/api-types";
import type { PageTreeStore } from "@/ui/page-tree/store";
import { pageDetail } from "../../_lib/__tests__/fixtures";
import { MovePageDialog } from "../move-page-dialog";
import { bodyOf, deferred, fakeApi, json, problem, type Responder, type SentRequest } from "./fake-api";
import { TreeProvider, isTreeGet } from "./tree-provider";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/spaces/TEAM/pages/p1" }));

const summary = (id: string, title: string, parentId: string | null, ordinal: number): PageSummary => ({
  id,
  title,
  parentId,
  ordinal,
  currentVersion: 1,
  lastModifiedAt: "2026-10-01T08:00:00.000Z",
});

//  Product (p0)
//  ├─ Specifications (p1)      ← moved
//  │  ├─ Requirements (p2)
//  │  │  └─ Detail (p3)
//  │  └─ Annex (p4)
//  └─ Glossary (p5)
//  Team notes (p6)
//  └─ Minutes (p7)
const PAGES: readonly PageSummary[] = [
  summary("p0", "Product", null, 0),
  summary("p1", "Specifications", "p0", 0),
  summary("p2", "Requirements", "p1", 0),
  summary("p3", "Detail", "p2", 0),
  summary("p4", "Annex", "p1", 1),
  summary("p5", "Glossary", "p0", 1),
  summary("p6", "Team notes", null, 1),
  summary("p7", "Minutes", "p6", 0),
];

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

interface OpenOptions {
  /** How the server answers the move. */
  readonly respond?: Responder;
  /** The page as the view rendered it. */
  readonly page?: Partial<PageDetail>;
  /** The frame's live tree when the dialog opens (null: it failed to load); default PAGES. */
  readonly live?: readonly PageSummary[] | null;
  /** How the server answers the dialog's GET of the tree; default: `live` again. */
  readonly tree?: Responder;
}

function open({ respond = () => json(pageDetail()), page = {}, live = PAGES, tree }: OpenOptions = {}) {
  const answerTree = tree ?? (() => json(live ?? []));
  const api = fakeApi((request: SentRequest) => (isTreeGet(request) ? answerTree(request) : respond(request)));
  const onClose = vi.fn();
  let store: PageTreeStore | null = null;
  render(
    <TreeProvider pages={live} fetchImpl={api.fetchImpl} onStore={(s) => (store = s)}>
      <MovePageDialog space={{ key: "TEAM", name: "Team" }} page={pageDetail(page)} onClose={onClose} fetchImpl={api.fetchImpl} />
    </TreeProvider>,
  );
  const dialog = screen.getByRole("dialog", { name: t("pageMove.title", { title: "Specifications" }) });
  const list = screen.getByRole("listbox", { name: t("pageMove.list") });
  const filter = screen.getByLabelText(t("pageMove.filter")) as HTMLInputElement;
  const submit = screen.getByRole("button", { name: t("pageMove.submit") });
  const theStore = () => {
    if (store === null) throw new Error("no store");
    return store;
  };
  return { api, onClose, dialog, list, filter, submit, store: theStore };
}

const options = (list: HTMLElement) => within(list).getAllByRole("option");
const labels = (list: HTMLElement) => options(list).map((o) => (o.firstElementChild?.textContent ?? "").trim());
const selectedLabel = (list: HTMLElement) => {
  const selected = options(list).filter((o) => o.getAttribute("aria-selected") === "true");
  return selected.map((o) => (o.firstElementChild?.textContent ?? "").trim());
};
const option = (list: HTMLElement, label: string) => {
  const found = options(list).find((o) => (o.firstElementChild?.textContent ?? "").trim() === label);
  if (!found) throw new Error(`no option ${label}`);
  return found;
};

describe("what is offered (RD-056)", () => {
  it("the top level first, then every page in tree order — except the page and all its descendants", () => {
    const { list } = open();
    expect(labels(list)).toEqual([t("pageMove.root"), "Product", "Glossary", "Team notes", "Minutes"]);
    for (const gone of ["Specifications", "Requirements", "Detail", "Annex"]) expect(labels(list)).not.toContain(gone);
  });

  it("indents pages by depth", () => {
    const { list } = open();
    const pad = (label: string) => parseFloat(option(list, label).style.paddingLeft);
    expect(pad("Product")).toBeGreaterThan(pad(t("pageMove.root")));
    expect(pad("Glossary")).toBeGreaterThan(pad("Product"));
    expect(pad("Team notes")).toBe(pad("Product"));
  });

  it("marks and chooses where the page is now, and Move waits for another choice", () => {
    const { list, submit } = open();
    expect(selectedLabel(list)).toEqual(["Product"]);
    expect(within(option(list, "Product")).getByText(t("pageMove.currentTag"))).toBeTruthy();
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("move-choice")).toHaveTextContent(t("pageMove.choice.same"));
  });

  it("a one-page space offers only the top level, where the page already is", () => {
    const only = [summary("p1", "Specifications", null, 0)];
    const { list, submit, api } = open({ page: { parentId: null, ancestors: [] }, live: only });
    expect(labels(list)).toEqual([t("pageMove.root")]);
    expect(selectedLabel(list)).toEqual([t("pageMove.root")]);
    fireEvent.click(submit);
    expect(api.writes()).toHaveLength(0);
  });
});

describe("choosing", () => {
  it("by click, saying where the page will go", () => {
    const { list, submit } = open();
    fireEvent.click(option(list, "Minutes"));
    expect(selectedLabel(list)).toEqual(["Minutes"]);
    expect(submit).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("move-choice")).toHaveTextContent(t("pageMove.choice.under", { parent: "Minutes" }));
    fireEvent.click(option(list, t("pageMove.root")));
    expect(screen.getByTestId("move-choice")).toHaveTextContent(t("pageMove.choice.root", { space: "Team" }));
  });

  it("by keyboard: Down, Up, Home and End move the choice, and aria-activedescendant follows", () => {
    const { list } = open();
    list.focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(selectedLabel(list)).toEqual(["Glossary"]);
    expect(list.getAttribute("aria-activedescendant")).toBe(option(list, "Glossary").id);
    fireEvent.keyDown(list, { key: "End" });
    expect(selectedLabel(list)).toEqual(["Minutes"]);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(selectedLabel(list)).toEqual(["Minutes"]);
    fireEvent.keyDown(list, { key: "Home" });
    expect(selectedLabel(list)).toEqual([t("pageMove.root")]);
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(selectedLabel(list)).toEqual([t("pageMove.root")]);
  });

  it("the filter narrows by title, shows where each match is, and keeps the top level", () => {
    const { list, filter } = open();
    fireEvent.change(filter, { target: { value: "min" } });
    expect(labels(list)).toEqual([t("pageMove.root"), "Minutes"]);
    expect(option(list, "Minutes")).toHaveTextContent("Team notes");
  });

  it("a filter that matches nothing says so", () => {
    const { list, filter } = open();
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(labels(list)).toEqual([t("pageMove.root")]);
    expect(screen.getAllByRole("status").some((s) => s.textContent === t("pageMove.none", { q: "zzz" }))).toBe(true);
  });

  it("Enter in the filter picks the first match and does not move anything; Down goes to the list", () => {
    const { list, filter, api } = open();
    fireEvent.change(filter, { target: { value: "gloss" } });
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(selectedLabel(list)).toEqual(["Glossary"]);
    expect(document.activeElement).toBe(list);
    expect(api.writes()).toHaveLength(0);
    filter.focus();
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    expect(document.activeElement).toBe(list);
  });

  it("the filter field has the focus when the dialog opens", () => {
    const { filter } = open();
    expect(document.activeElement).toBe(filter);
  });
});

describe("Move", () => {
  it("POSTs { parentId, index } with the index that puts the page last, then closes and refreshes", async () => {
    const { list, submit, api, onClose } = open();
    fireEvent.click(option(list, "Team notes"));
    fireEvent.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.writes()).toHaveLength(1);
    expect(api.writes()[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages/p1/move" });
    expect(bodyOf(api.writes()[0])).toEqual({ parentId: "p6", index: 1 });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("to the top level: parentId null, after the two top-level pages", async () => {
    const { list, submit, api } = open();
    fireEvent.click(option(list, t("pageMove.root")));
    fireEvent.click(submit);
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(bodyOf(api.writes()[0])).toEqual({ parentId: null, index: 2 });
  });

  it("a second press while the first is in flight sends nothing; Escape waits for it", async () => {
    const held = deferred();
    const { list, submit, api, onClose, dialog } = open({ respond: () => held.promise });
    fireEvent.click(option(list, "Glossary"));
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.writes()).toHaveLength(1);
    expect(submit).toHaveAttribute("aria-busy", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => held.release(json(pageDetail())));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.writes()).toHaveLength(1);
  });

  it.each([
    ["CYCLE", 409, t("pageMove.cycle")],
    ["VALIDATION", 422, t("pageMove.invalid")],
    ["FORBIDDEN", 403, t("pageMove.forbidden")],
    ["NOT_FOUND", 404, t("pageView.dialog.gone")],
    ["INTERNAL", 500, t("pageMove.failed")],
  ] as const)("%s is said in the dialog, which stays open", async (code, status, message) => {
    const { list, submit, onClose } = open({ respond: () => problem(status, code) });
    fireEvent.click(option(list, "Glossary"));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(submit).not.toHaveAttribute("aria-disabled");
  });
});

describe("the list is the frame's live tree, not the view's render", () => {
  // The view rendered Specifications under Product; then it was dragged to the top level in the
  // sidebar of the same screen. The render was not refreshed; the frame's tree store was.
  const MOVED_TO_TOP: readonly PageSummary[] = [
    summary("p0", "Product", null, 0),
    summary("p2", "Requirements", "p1", 0),
    summary("p3", "Detail", "p2", 0),
    summary("p4", "Annex", "p1", 1),
    summary("p5", "Glossary", "p0", 0),
    summary("p6", "Team notes", null, 1),
    summary("p7", "Minutes", "p6", 0),
    summary("p1", "Specifications", null, 2),
  ];

  it("after a sidebar move to the top level, `At the top level` is Current, and moving back under Product can be chosen", async () => {
    const { list, submit, api } = open({ page: { parentId: "p0" }, live: MOVED_TO_TOP });
    expect(selectedLabel(list)).toEqual([t("pageMove.root")]);
    expect(within(option(list, t("pageMove.root"))).getByText(t("pageMove.currentTag"))).toBeTruthy();
    expect(within(option(list, "Product")).queryByText(t("pageMove.currentTag"))).toBeNull();
    expect(submit).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(option(list, "Product"));
    expect(submit).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("move-choice")).toHaveTextContent(t("pageMove.choice.under", { parent: "Product" }));
    fireEvent.click(submit);
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    // Last among Product's children as they are now: after Glossary.
    expect(bodyOf(api.writes()[0])).toEqual({ parentId: "p0", index: 1 });
  });

  it("asks for the tree again as it opens, and follows the answer (another user moved the page meanwhile)", async () => {
    const underTeamNotes = PAGES.map((p) => (p.id === "p1" ? { ...p, parentId: "p6", ordinal: 1 } : p));
    const { list, api } = open({ tree: () => json(underTeamNotes) });
    await waitFor(() => expect(selectedLabel(list)).toEqual(["Team notes"]));
    expect(within(option(list, "Team notes")).getByText(t("pageMove.currentTag"))).toBeTruthy();
    expect(api.sent.filter(isTreeGet)).toHaveLength(1);
    expect(api.writes()).toHaveLength(0);
  });

  it("follows a move the tree store makes while it is open, and keeps the user's own choice", async () => {
    let server: readonly PageSummary[] = PAGES;
    const { list, store } = open({ tree: () => json(server) });
    await waitFor(() => expect(selectedLabel(list)).toEqual(["Product"]));
    server = MOVED_TO_TOP; // what the server holds once the store's move is made
    await act(async () => {
      await store().move("p1", { parentId: null, index: 2 });
    });
    expect(within(option(list, t("pageMove.root"))).getByText(t("pageMove.currentTag"))).toBeTruthy();
    expect(selectedLabel(list)).toEqual([t("pageMove.root")]);
    fireEvent.click(option(list, "Minutes"));
    await act(async () => {
      await store().refresh();
    });
    expect(selectedLabel(list)).toEqual(["Minutes"]);
  });

  it("while the tree is loading it says so, and Move is unavailable whatever is chosen", async () => {
    const held = deferred();
    const { list, submit, api } = open({ page: { parentId: "p0" }, live: null, tree: () => held.promise });
    expect(screen.getAllByRole("status").some((s) => s.textContent === t("pageMove.loading"))).toBe(true);
    fireEvent.click(option(list, t("pageMove.root")));
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(api.writes()).toHaveLength(0);
    await act(async () => held.release(json(PAGES)));
    expect(labels(list)).toEqual([t("pageMove.root"), "Product", "Glossary", "Team notes", "Minutes"]);
    expect(screen.getAllByRole("status").some((s) => s.textContent === t("pageMove.loading"))).toBe(false);
  });

  it("when the tree cannot be loaded it says so, and nothing can be moved", async () => {
    const { list, submit, api } = open({ page: { parentId: "p0" }, live: null, tree: () => problem(500, "INTERNAL") });
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageMove.loadFailed"));
    fireEvent.click(option(list, t("pageMove.root")));
    fireEvent.click(submit);
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(api.writes()).toHaveLength(0);
  });
});

describe("closing", () => {
  it("Escape and Cancel close without moving", () => {
    const first = open();
    fireEvent.keyDown(first.dialog, { key: "Escape" });
    expect(first.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const second = open();
    fireEvent.click(screen.getByRole("button", { name: t("pageView.dialog.cancel") }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.api.writes()).toHaveLength(0);
  });
});
