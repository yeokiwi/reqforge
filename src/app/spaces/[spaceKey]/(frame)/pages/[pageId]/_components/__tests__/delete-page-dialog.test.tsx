// @vitest-environment jsdom
// `···` → Delete (RD-056): the confirmation names how many pages will go, Cancel has the focus,
// DELETE then the space overview, every mapped refusal, one delete per press, Escape.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents/api-types";
import { pageDetail } from "../../_lib/__tests__/fixtures";
import { DeletePageDialog } from "../delete-page-dialog";
import { deferred, fakeApi, json, problem, type Responder } from "./fake-api";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function open(respond: Responder = () => json({ deletedCount: 1 }), page: Partial<PageDetail> = {}, spaceKey = "TEAM") {
  const api = fakeApi(respond);
  const onClose = vi.fn();
  render(<DeletePageDialog space={{ key: spaceKey, name: "Team" }} page={pageDetail(page)} onClose={onClose} fetchImpl={api.fetchImpl} />);
  const dialog = screen.getByRole("dialog", { name: t("pageDelete.title", { title: "Specifications" }) });
  const confirm = screen.getByRole("button", { name: t("pageDelete.confirm") });
  const cancel = screen.getByRole("button", { name: t("pageView.dialog.cancel") });
  return { api, onClose, dialog, confirm, cancel };
}

const description = (dialog: HTMLElement) => document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent;

describe("the confirmation names how many pages will go (RD-056)", () => {
  it.each([
    [0, t("pageDelete.body.leaf")],
    [1, t("pageDelete.body.oneChild")],
    [6, t("pageDelete.body.children", { d: "6", n: "7" })],
  ])("with %i pages under it", (descendantCount, text) => {
    const { dialog } = open(undefined, { descendantCount });
    expect(description(dialog)).toBe(text);
  });

  it("the subtree's total is in the sentence", () => {
    const { dialog } = open(undefined, { descendantCount: 6 });
    expect(description(dialog)).toContain("7 pages");
  });

  it("Cancel, the safe answer, has the focus", () => {
    const { cancel } = open();
    expect(document.activeElement).toBe(cancel);
  });
});

describe("Delete", () => {
  it("DELETEs the page and replaces the screen with the space overview", async () => {
    const { api, confirm, onClose } = open();
    fireEvent.click(confirm);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/spaces/TEAM"));
    expect(api.sent).toEqual([{ method: "DELETE", url: "/api/v1/spaces/TEAM/pages/p1", body: undefined }]);
    expect(router.push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Refreshed AFTER the navigation: Next discards a refresh still pending when a navigation arrives.
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.replace.mock.invocationCallOrder[0]).toBeLessThan(router.refresh.mock.invocationCallOrder[0] ?? 0);
  });

  it("encodes the space key in both URLs", async () => {
    const { api, confirm } = open(undefined, {}, "日本 1");
    fireEvent.click(confirm);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/spaces/${encodeURIComponent("日本 1")}`));
    expect(api.sent[0]?.url).toBe(`/api/v1/spaces/${encodeURIComponent("日本 1")}/pages/p1`);
  });

  it("a second press while the first is in flight sends nothing; Escape and Cancel wait", async () => {
    const held = deferred();
    const { api, confirm, cancel, dialog, onClose } = open(() => held.promise);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.sent).toHaveLength(1);
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
    const { confirm, onClose } = open(() => problem(status, code));
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
    expect(second.api.sent).toHaveLength(0);
  });
});
