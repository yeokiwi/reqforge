// @vitest-environment jsdom
// The page view ROUTE (page.tsx), rendered: that it wires the view model the way the model says —
// `✎ Edit` (and the `E` key) only when canEditHere, the version banner only on a past version, the
// draft notice only when showDraftNotice — and that a malformed `?version` or a NotFoundError is
// the 404 page (RD-051). The view model's rules are tested in view-model.test.ts; this file fails
// when the route stops using them (e.g. `editHref={view.hrefs.edit}`, or a banner without its guard).
// spec: docs/specs/10-ui-reference.md sections 4.1 and 11; docs/specs/09-decision-log.md sections RD-051, RD-055, RD-060
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import { NotFoundError } from "@/domain/errors";
import type { PageDetail, VersionDetail } from "@/domain/documents";
import { PAGES, pageScreen } from "../../_lib/__tests__/fixtures";
import { fakeApi, json } from "./fake-api";
import { TreeProvider } from "./tree-provider";

const NOT_FOUND = vi.hoisted(() => new Error("NEXT_NOT_FOUND"));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
const mocks = vi.hoisted(() => ({
  loadPageScreen: vi.fn(),
  openSpace: vi.fn(async () => ({})),
  requireUser: vi.fn(async () => ({ id: "u-alice", name: "Alice Admin" })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
  useRouter: () => router,
  usePathname: () => "/spaces/TEAM/pages/p1",
}));
vi.mock("@/server/authz/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/server/usecases/spaces", () => ({ openSpace: mocks.openSpace }));
vi.mock("../../_lib/load-page", () => ({ loadPageScreen: mocks.loadPageScreen }));

const { default: PageViewRoute, generateMetadata } = await import("../../page");

type Search = Record<string, string | string[]>;
const props = (search: Search = {}, pageId = "p1") => ({
  params: Promise.resolve({ spaceKey: "team", pageId }),
  searchParams: Promise.resolve(search),
});

function serve(over: { page?: Partial<PageDetail>; version?: Partial<VersionDetail> } = {}) {
  mocks.loadPageScreen.mockResolvedValue(pageScreen(over));
}

/** Renders what the route returned, inside the frame's tree provider (AppFrame's). */
async function show(search: Search = {}) {
  const element: ReactElement = await PageViewRoute(props(search));
  const api = fakeApi(() => json(PAGES));
  render(
    <TreeProvider pages={PAGES} fetchImpl={api.fetchImpl}>
      {element}
    </TreeProvider>,
  );
}

const editLink = () => screen.queryByRole("link", { name: t("page.edit") });
const banner = () => screen.queryByTestId("version-banner");
const draftNotice = () => screen.queryByTestId("draft-notice");

beforeEach(() => {
  vi.clearAllMocks();
  serve();
});
afterEach(cleanup);

describe("what the route shows, by viewer and version", () => {
  it("an editor on the current version: the page, ✎ Edit (and E), no banner, no draft notice", async () => {
    await show();
    expect(mocks.loadPageScreen).toHaveBeenCalledWith(expect.objectContaining({ id: "u-alice" }), "team", "p1", undefined);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Specifications");
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(editLink()).toHaveAttribute("href", "/spaces/TEAM/pages/p1/edit");
    fireEvent.keyDown(document.body, { key: "e" });
    expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p1/edit");
    expect(banner()).toBeNull();
    expect(draftNotice()).toBeNull();
  });

  it("a VIEW-only reader: no ✎ Edit, and E does nothing", async () => {
    serve({ page: { permissions: { canEdit: false, canAdmin: false } } });
    await show();
    expect(editLink()).toBeNull();
    fireEvent.keyDown(document.body, { key: "e" });
    expect(router.push).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  it("?version=3, a past version: read-only — the banner back to current, no ✎ Edit, no E, no draft notice", async () => {
    serve({ page: { hasDraft: true }, version: { number: 3, current: false, title: "Old title" } });
    await show({ version: "3" });
    expect(mocks.loadPageScreen).toHaveBeenCalledWith(expect.anything(), "team", "p1", 3);
    expect(banner()).toHaveTextContent(t("pageView.version.banner", { n: 3 }));
    expect(screen.getByRole("link", { name: t("pageView.version.current") })).toHaveAttribute("href", "/spaces/TEAM/pages/p1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Old title");
    expect(editLink()).toBeNull();
    fireEvent.keyDown(document.body, { key: "e" });
    expect(router.push).not.toHaveBeenCalled();
    expect(draftNotice()).toBeNull();
  });

  it("the viewer's own draft on the current version: the draft notice, continuing in the editor", async () => {
    serve({ page: { hasDraft: true } });
    await show();
    expect(draftNotice()).not.toBeNull();
    expect(screen.getByRole("link", { name: t("pageView.draft.continue") })).toHaveAttribute("href", "/spaces/TEAM/pages/p1/edit");
  });

  it("a draft without EDIT (permission since revoked): no draft notice", async () => {
    serve({ page: { hasDraft: true, permissions: { canEdit: false, canAdmin: false } } });
    await show();
    expect(draftNotice()).toBeNull();
    expect(editLink()).toBeNull();
  });

  it("the window title is the shown version's title", async () => {
    serve({ version: { number: 2, current: false, title: "Old title" } });
    expect(await generateMetadata(props({ version: "2" }))).toEqual({ title: "Old title" });
  });
});

describe("the 404 page (RD-051)", () => {
  it.each([[{ version: "abc" }], [{ version: "0" }], [{ version: "-1" }], [{ version: "1.5" }], [{ version: "" }], [{ version: ["1", "2"] }]])(
    "%j is the 404 page, before anything is loaded",
    async (search) => {
      await expect(PageViewRoute(props(search))).rejects.toBe(NOT_FOUND);
      await expect(generateMetadata(props(search))).rejects.toBe(NOT_FOUND);
      expect(mocks.loadPageScreen).not.toHaveBeenCalled();
    },
  );

  it("reading a page records the visit to its space (RD-079) — and a page that is not found records nothing", async () => {
    serve();
    await show();
    expect(mocks.openSpace).toHaveBeenCalledWith(expect.objectContaining({ id: "u-alice" }), "team");
    mocks.openSpace.mockClear();
    mocks.loadPageScreen.mockRejectedValueOnce(new NotFoundError("Page"));
    await expect(PageViewRoute(props({}, "gone"))).rejects.toBe(NOT_FOUND);
    expect(mocks.openSpace).not.toHaveBeenCalled();
  });

  it("a NotFoundError from the use case is the 404 page; anything else reaches the error boundary unchanged", async () => {
    mocks.loadPageScreen.mockRejectedValueOnce(new NotFoundError("Page"));
    await expect(PageViewRoute(props({}, "gone"))).rejects.toBe(NOT_FOUND);
    const boom = new Error("database down");
    mocks.loadPageScreen.mockRejectedValueOnce(boom);
    await expect(PageViewRoute(props({}, "broken"))).rejects.toBe(boom);
  });
});
