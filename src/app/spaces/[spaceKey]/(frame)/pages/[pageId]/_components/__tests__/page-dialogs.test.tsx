// @vitest-environment jsdom
// PageDialogs: the switch, and — with the real dialogs inside the real header — focus going back
// to what opened them (📎, or `···` for a menu item, whose own item is gone by then).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents/api-types";
import { pageCrumbs } from "@/ui/page-view/breadcrumb";
import { PAGES, pageDetail } from "../../_lib/__tests__/fixtures";
import { PageDialogs, type PageDialogKind } from "../page-dialogs";
import { PageHeader } from "../page-header";
import { fakeApi, json } from "./fake-api";
import { TreeProvider } from "./tree-provider";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/spaces/TEAM/pages/p1" }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const SPACE = { key: "TEAM", name: "Team" };
const api = () =>
  fakeApi((request) =>
    request.method !== "GET" ? json({}) : request.url.endsWith("/pages") ? json(PAGES) : request.url.endsWith("/attachments") ? json([]) : json({ page: pageDetail() }),
  );

describe("PageDialogs switches on kind", () => {
  it.each([
    ["attachments", t("pageAttachments.title")],
    ["info", t("pageInfo.title")],
    ["copy", t("pageCopy.title", { title: "Specifications" })],
    ["move", t("pageMove.title", { title: "Specifications" })],
    ["delete", t("pageDelete.title", { title: "Specifications" })],
  ] as const)("%s opens %s", (kind: PageDialogKind, name) => {
    const { fetchImpl } = api();
    render(
      <TreeProvider pages={PAGES} fetchImpl={fetchImpl}>
        <PageDialogs kind={kind} page={pageDetail()} space={SPACE} onClose={vi.fn()} fetchImpl={fetchImpl} />
      </TreeProvider>,
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name })).toBeTruthy();
  });

  it("renders nothing for null", () => {
    const { container } = render(<PageDialogs kind={null} page={pageDetail()} space={SPACE} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("each dialog closes through onClose on Escape", () => {
    for (const kind of ["attachments", "info", "copy", "move", "delete"] as const) {
      const onClose = vi.fn();
      const { fetchImpl } = api();
      render(
        <TreeProvider pages={PAGES} fetchImpl={fetchImpl}>
          <PageDialogs kind={kind} page={pageDetail()} space={SPACE} onClose={onClose} fetchImpl={fetchImpl} />
        </TreeProvider>,
      );
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(onClose, kind).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });
});

describe("inside the header: focus goes back to the opener", () => {
  function header(page: Partial<PageDetail> = {}) {
    const detail = pageDetail(page);
    const { fetchImpl } = api();
    render(
      <TreeProvider pages={PAGES} fetchImpl={fetchImpl}>
        <PageHeader
          space={SPACE}
          page={detail}
          crumbs={pageCrumbs("TEAM", detail.ancestors, detail.title)}
          viewHref="/spaces/TEAM/pages/p1"
          editHref="/spaces/TEAM/pages/p1/edit"
          fetchImpl={fetchImpl}
        />
      </TreeProvider>,
    );
  }

  it("📎 → Attachments → Close returns the focus to 📎", async () => {
    header();
    const clip = screen.getByRole("button", { name: t("pageMenu.attachments") });
    clip.focus();
    fireEvent.click(clip);
    const dialog = screen.getByRole("dialog", { name: t("pageAttachments.title") });
    await waitFor(() => expect(within(dialog).getByText(t("pageAttachments.empty"))).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: t("pageView.dialog.close") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(clip);
  });

  it.each([
    [t("pageMenu.info"), t("pageInfo.title")],
    [t("pageMenu.copy"), t("pageCopy.title", { title: "Specifications" })],
    [t("pageMenu.move"), t("pageMove.title", { title: "Specifications" })],
    [t("pageMenu.delete"), t("pageDelete.title", { title: "Specifications" })],
    [t("pageMenu.attachments"), t("pageAttachments.title")],
  ])("··· → %s → Escape returns the focus to ···", (item, title) => {
    header();
    const more = screen.getByRole("button", { name: t("pageMenu.label") });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: item }));
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: title });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // The menu remounts to close (page-menu.tsx), so its trigger is a new element: query it again.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("pageMenu.label") }));
  });

  it("E does not open the editor while a dialog is open (its keys are its own)", () => {
    header();
    fireEvent.click(screen.getByRole("button", { name: t("pageMenu.label") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("pageMenu.info") }));
    fireEvent.keyDown(document.body, { key: "e" });
    expect(router.push).not.toHaveBeenCalled();
  });
});
