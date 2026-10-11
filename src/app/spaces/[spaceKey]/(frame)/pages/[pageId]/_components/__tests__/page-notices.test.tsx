// @vitest-environment jsdom
// The two notices above a page's title: the past-version banner (10 §11, RD-060) and the viewer's
// own unpublished draft (RD-055 — ours: Continue editing, or Discard after a confirmation).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import { DraftNotice, draftUrl } from "../draft-notice";
import { VersionBanner } from "../version-banner";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type Call = { method: string; url: string };
let calls: Call[];
let respond: () => Response | Promise<Response>;
const fetchImpl = (url: string, init?: RequestInit) => {
  calls.push({ method: init?.method ?? "GET", url });
  return Promise.resolve(respond());
};
const noContent = () => new Response(null, { status: 204 });

beforeEach(() => {
  calls = [];
  respond = noContent;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("VersionBanner (RD-060)", () => {
  it("is a status region that names the version and links back to the current one", () => {
    render(<VersionBanner version={3} currentHref="/spaces/TEAM/pages/p1" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(t("pageView.version.banner", { n: 3 }));
    expect(within(banner).getByRole("link", { name: t("pageView.version.current") })).toHaveAttribute("href", "/spaces/TEAM/pages/p1");
  });
});

describe("DraftNotice (RD-055)", () => {
  const notice = () =>
    render(<DraftNotice spaceKey="TEAM" pageId="p1" editHref="/spaces/TEAM/pages/p1/edit" fetchImpl={fetchImpl} />);
  const discardButton = () => screen.getByRole("button", { name: t("pageView.draft.discard") });

  it("says there is a draft and offers to continue it in the editor", () => {
    notice();
    expect(screen.getByTestId("draft-notice")).toHaveTextContent(t("pageView.draft.notice"));
    expect(screen.getByRole("link", { name: t("pageView.draft.continue") })).toHaveAttribute("href", "/spaces/TEAM/pages/p1/edit");
  });

  it("asks before discarding; keeping the draft sends nothing and returns focus", () => {
    notice();
    discardButton().focus();
    fireEvent.click(discardButton());
    const dialog = screen.getByRole("dialog", { name: t("pageView.draft.discard.title") });
    expect(dialog).toHaveTextContent(t("pageView.draft.discard.body"));
    // The safe answer has the focus.
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: t("pageView.draft.discard.cancel") }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("pageView.draft.discard.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toEqual([]);
    expect(document.activeElement).toBe(discardButton());
  });

  it("Escape keeps the draft too", () => {
    notice();
    fireEvent.click(discardButton());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("discarding DELETEs the draft, then refreshes the page, and the notice goes", async () => {
    notice();
    fireEvent.click(discardButton());
    fireEvent.click(screen.getByRole("button", { name: t("pageView.draft.discard.confirm") }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: "DELETE", url: "/api/v1/spaces/TEAM/pages/p1/draft" }]);
    expect(screen.queryByTestId("draft-notice")).toBeNull();
  });

  it("a failed discard keeps the notice and says so", async () => {
    respond = () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, detail: "", code: "INTERNAL" }), {
        status: 500,
        headers: { "Content-Type": "application/problem+json" },
      });
    notice();
    fireEvent.click(discardButton());
    fireEvent.click(screen.getByRole("button", { name: t("pageView.draft.discard.confirm") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageView.draft.discard.failed"));
    expect(screen.getByTestId("draft-notice")).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("does not ask again while a discard is in flight", async () => {
    let release: () => void = () => undefined;
    respond = () => new Promise<Response>((resolve) => (release = () => resolve(noContent())));
    notice();
    fireEvent.click(discardButton());
    fireEvent.click(screen.getByRole("button", { name: t("pageView.draft.discard.confirm") }));
    expect(discardButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(discardButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toHaveLength(1);
    await act(async () => release());
  });

  it("builds the draft URL with every segment encoded", () => {
    expect(draftUrl("TEAM", "a/b")).toBe("/api/v1/spaces/TEAM/pages/a%2Fb/draft");
  });
});
