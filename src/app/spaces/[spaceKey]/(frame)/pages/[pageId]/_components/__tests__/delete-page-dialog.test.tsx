// @vitest-environment jsdom
// `···` → Delete (RD-056): the confirmation names how many pages will go — counted afresh when
// the dialog opens, not taken from the render (the tree may have changed since) — Cancel has the
// focus, DELETE then the space overview, every mapped refusal, one delete per press, Escape.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents/api-types";
import { pageDetail, versionDetail } from "../../_lib/__tests__/fixtures";
import { DeletePageDialog } from "../delete-page-dialog";
import { deferred, fakeApi, json, problem, type Responder, type SentRequest } from "./fake-api";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

/** GET …/pages/{id} as the server answers it: `{ page, version }` (08 §3). */
const pageAnswer = (over: Partial<PageDetail> = {}) => json({ page: pageDetail(over), version: versionDetail() });

interface OpenOptions {
  /** How the server answers the count (GET …/pages/{id}); default: the page as rendered. */
  readonly count?: Responder;
  /** How it answers the DELETE; default `{ deletedCount: 1 }`. */
  readonly remove?: Responder;
  /** The page as the view rendered it. */
  readonly page?: Partial<PageDetail>;
  readonly spaceKey?: string;
}

function open({ count, remove, page = {}, spaceKey = "TEAM" }: OpenOptions = {}) {
  const answerCount = count ?? (() => pageAnswer(page));
  const answerDelete = remove ?? (() => json({ deletedCount: 1 }));
  const api = fakeApi((request: SentRequest) => (request.method === "GET" ? answerCount(request) : answerDelete(request)));
  const onClose = vi.fn();
  render(<DeletePageDialog space={{ key: spaceKey, name: "Team" }} page={pageDetail(page)} onClose={onClose} fetchImpl={api.fetchImpl} />);
  const dialog = screen.getByRole("dialog", { name: t("pageDelete.title", { title: "Specifications" }) });
  const confirm = screen.getByRole("button", { name: t("pageDelete.confirm") });
  const cancel = screen.getByRole("button", { name: t("pageView.dialog.cancel") });
  return { api, onClose, dialog, confirm, cancel };
}

const description = (dialog: HTMLElement) => document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent;

/** The count has arrived: Delete can be pressed. */
async function counted(confirm: HTMLElement) {
  await waitFor(() => expect(confirm).not.toHaveAttribute("aria-disabled"));
}

describe("the confirmation names how many pages will go (RD-056)", () => {
  it.each([
    [0, t("pageDelete.body.leaf")],
    [1, t("pageDelete.body.oneChild")],
    [6, t("pageDelete.body.children", { d: "6", n: "7" })],
  ])("with %i pages under it", async (descendantCount, text) => {
    const { dialog, confirm } = open({ page: { descendantCount } });
    await counted(confirm);
    expect(description(dialog)).toBe(text);
  });

  it("the subtree's total is in the sentence", async () => {
    const { dialog, confirm } = open({ page: { descendantCount: 6 } });
    await counted(confirm);
    expect(description(dialog)).toContain("7 pages");
  });

  it("Cancel, the safe answer, has the focus", () => {
    const { cancel } = open();
    expect(document.activeElement).toBe(cancel);
  });
});

describe("the count is read afresh when the dialog opens, not taken from the render", () => {
  it("asks the server for the page (GET …/pages/{id}) as it opens, and nothing else", async () => {
    const { api, confirm } = open();
    await counted(confirm);
    expect(api.sent).toEqual([{ method: "GET", url: "/api/v1/spaces/TEAM/pages/p1", body: undefined }]);
  });

  it("a page added under it since the view rendered (a sidebar move, another user) is counted, and the sentence says so", async () => {
    // The view rendered a leaf; meanwhile page C went under it.
    const { api, dialog, confirm } = open({ page: { descendantCount: 0 }, count: () => pageAnswer({ descendantCount: 1 }) });
    await counted(confirm);
    expect(description(dialog)).toBe(t("pageDelete.body.oneChild"));
    // The new count is also announced: the description is only read when the dialog opens.
    expect(screen.getAllByRole("status").some((s) => s.textContent === t("pageDelete.body.oneChild"))).toBe(true);
    fireEvent.click(confirm);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/spaces/TEAM"));
    expect(api.writes()).toEqual([{ method: "DELETE", url: "/api/v1/spaces/TEAM/pages/p1", body: undefined }]);
  });

  it("until the count arrives it says it is counting, and Delete sends nothing", async () => {
    const held = deferred();
    const { api, dialog, confirm } = open({ count: () => held.promise });
    expect(description(dialog)).toBe(t("pageDelete.counting"));
    expect(description(dialog)).not.toBe(t("pageDelete.body.leaf"));
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirm);
    expect(api.writes()).toHaveLength(0);
    await act(async () => held.release(pageAnswer({ descendantCount: 2 })));
    await counted(confirm);
    expect(description(dialog)).toBe(t("pageDelete.body.children", { d: "2", n: "3" }));
  });

  it.each([
    ["INTERNAL", 500, t("pageDelete.countFailed")],
    ["NOT_FOUND", 404, t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", 401, t("pageView.dialog.signedOut")],
  ] as const)("a count refused with %s is said, and Delete stays unavailable", async (code, status, message) => {
    const { api, dialog, confirm, cancel, onClose } = open({ count: () => problem(status, code) });
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(description(dialog)).not.toBe(t("pageDelete.body.leaf"));
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirm);
    expect(api.writes()).toHaveLength(0);
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an answer that is not a page is the count failure, not a guess", async () => {
    const { api, confirm } = open({ count: () => json({ page: { id: "p1" } }) });
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageDelete.countFailed"));
    fireEvent.click(confirm);
    expect(api.writes()).toHaveLength(0);
  });
});

describe("Delete", () => {
  it("DELETEs the page and replaces the screen with the space overview", async () => {
    const { api, confirm, onClose } = open();
    await counted(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/spaces/TEAM"));
    expect(api.writes()).toEqual([{ method: "DELETE", url: "/api/v1/spaces/TEAM/pages/p1", body: undefined }]);
    expect(router.push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Refreshed AFTER the navigation: Next discards a refresh still pending when a navigation arrives.
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.replace.mock.invocationCallOrder[0]).toBeLessThan(router.refresh.mock.invocationCallOrder[0] ?? 0);
  });

  it("encodes the space key in every URL", async () => {
    const { api, confirm } = open({ spaceKey: "日本 1" });
    await counted(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/spaces/${encodeURIComponent("日本 1")}`));
    expect(api.sent.map((r) => r.url)).toEqual([
      `/api/v1/spaces/${encodeURIComponent("日本 1")}/pages/p1`,
      `/api/v1/spaces/${encodeURIComponent("日本 1")}/pages/p1`,
    ]);
  });

  it("a second press while the first is in flight sends nothing; Escape and Cancel wait", async () => {
    const held = deferred();
    const { api, confirm, cancel, dialog, onClose } = open({ remove: () => held.promise });
    await counted(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.writes()).toHaveLength(1);
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(cancel);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => held.release(json({ deletedCount: 1 })));
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["FORBIDDEN", 403, t("pageDelete.forbidden")],
    ["NOT_FOUND", 404, t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", 401, t("pageView.dialog.signedOut")],
    ["INTERNAL", 500, t("pageDelete.failed")],
  ] as const)("%s is said in the dialog, which stays open and can try again", async (code, status, message) => {
    const { confirm, onClose } = open({ remove: () => problem(status, code) });
    await counted(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm).not.toHaveAttribute("aria-disabled");
  });
});

describe("closing", () => {
  it("Escape and Cancel close without deleting", () => {
    const first = open();
    fireEvent.keyDown(first.dialog, { key: "Escape" });
    expect(first.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const second = open();
    fireEvent.click(second.cancel);
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.api.writes()).toHaveLength(0);
  });
});
