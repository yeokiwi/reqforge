// @vitest-environment jsdom
// `···` → Move (RD-056, RD-067, RD-070): the listbox offers the top level and every page except
// the moved page and its descendants; keyboard and filter; `{ parentId, index }` as the API takes
// it; every mapped refusal; one move per press; Escape.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail, PageSummary } from "@/domain/documents/api-types";
import { pageDetail } from "../../_lib/__tests__/fixtures";
import { MovePageDialog } from "../move-page-dialog";
import { bodyOf, deferred, fakeApi, json, problem, type Responder } from "./fake-api";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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

function open(respond: Responder = () => json(pageDetail()), page: Partial<PageDetail> = {}, pages: readonly PageSummary[] = PAGES) {
  const api = fakeApi(respond);
  const onClose = vi.fn();
  render(<MovePageDialog space={{ key: "TEAM", name: "Team" }} page={pageDetail(page)} pages={pages} onClose={onClose} fetchImpl={api.fetchImpl} />);
  const dialog = screen.getByRole("dialog", { name: t("pageMove.title", { title: "Specifications" }) });
  const list = screen.getByRole("listbox", { name: t("pageMove.list") });
  const filter = screen.getByLabelText(t("pageMove.filter")) as HTMLInputElement;
  const submit = screen.getByRole("button", { name: t("pageMove.submit") });
  return { api, onClose, dialog, list, filter, submit };
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
    const { list, submit, api } = open(undefined, { parentId: null, ancestors: [] }, only);
    expect(labels(list)).toEqual([t("pageMove.root")]);
    expect(selectedLabel(list)).toEqual([t("pageMove.root")]);
    fireEvent.click(submit);
    expect(api.sent).toHaveLength(0);
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
    expect(api.sent).toHaveLength(0);
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
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages/p1/move" });
    expect(bodyOf(api.sent[0])).toEqual({ parentId: "p6", index: 1 });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("to the top level: parentId null, after the two top-level pages", async () => {
    const { list, submit, api } = open();
    fireEvent.click(option(list, t("pageMove.root")));
    fireEvent.click(submit);
    await waitFor(() => expect(api.sent).toHaveLength(1));
    expect(bodyOf(api.sent[0])).toEqual({ parentId: null, index: 2 });
  });

  it("a second press while the first is in flight sends nothing; Escape waits for it", async () => {
    const held = deferred();
    const { list, submit, api, onClose, dialog } = open(() => held.promise);
    fireEvent.click(option(list, "Glossary"));
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.sent).toHaveLength(1);
    expect(submit).toHaveAttribute("aria-busy", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => held.release(json(pageDetail())));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.sent).toHaveLength(1);
  });

  it.each([
    ["CYCLE", 409, t("pageMove.cycle")],
    ["VALIDATION", 422, t("pageMove.invalid")],
    ["FORBIDDEN", 403, t("pageMove.forbidden")],
    ["NOT_FOUND", 404, t("pageView.dialog.gone")],
    ["INTERNAL", 500, t("pageMove.failed")],
  ] as const)("%s is said in the dialog, which stays open", async (code, status, message) => {
    const { list, submit, onClose } = open(() => problem(status, code));
    fireEvent.click(option(list, "Glossary"));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(submit).not.toHaveAttribute("aria-disabled");
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
    expect(second.api.sent).toHaveLength(0);
  });
});
