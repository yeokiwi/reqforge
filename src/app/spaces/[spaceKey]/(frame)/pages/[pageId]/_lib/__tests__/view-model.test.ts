// The page view's decisions (10 §4, RD-055, RD-060, RD-078) for each permission set and version.
import { describe, expect, it } from "vitest";
import { buildPageViewModel } from "../view-model";
import { pageScreen } from "./fixtures";

const NOW = new Date("2026-10-11T10:00:00.000Z");

describe("buildPageViewModel — header", () => {
  it("breadcrumb: Pages → space overview, ancestors → their views, the page itself last and not a link (RD-078)", () => {
    const view = buildPageViewModel(
      pageScreen({ page: { ancestors: [{ id: "a", title: "Root" }, { id: "b", title: "Middle" }] } }),
      NOW,
    );
    expect(view.crumbs).toEqual([
      { label: "Pages", href: "/spaces/TEAM" },
      { label: "Root", href: "/spaces/TEAM/pages/a" },
      { label: "Middle", href: "/spaces/TEAM/pages/b" },
      { label: "Specifications", href: null },
    ]);
  });

  it("a root page's breadcrumb is Pages / <title>", () => {
    const view = buildPageViewModel(pageScreen({ page: { ancestors: [], parentId: null } }), NOW);
    expect(view.crumbs.map((c) => c.label)).toEqual(["Pages", "Specifications"]);
  });

  it("byline: the page's creator, and the shown version's time — relative, with the absolute for hover", () => {
    const view = buildPageViewModel(pageScreen(), NOW);
    expect(view.byline).toEqual({
      author: "Alice Admin",
      modifiedAt: "2026-10-11T09:54:00.000Z",
      relative: "6 minutes ago",
      absolute: "Oct 11, 2026 09:54",
    });
  });

  it("hrefs follow 10 §11, built from the canonical space key", () => {
    const view = buildPageViewModel(pageScreen(), NOW);
    expect(view.hrefs).toEqual({
      view: "/spaces/TEAM/pages/p1",
      edit: "/spaces/TEAM/pages/p1/edit",
      history: "/spaces/TEAM/pages/p1/history",
    });
  });
});

describe("buildPageViewModel — Edit, per permission set", () => {
  it.each([
    [{ canEdit: true, canAdmin: true }, true],
    [{ canEdit: true, canAdmin: false }, true],
    [{ canEdit: false, canAdmin: true }, false],
    [{ canEdit: false, canAdmin: false }, false],
  ])("permissions %j → Edit offered: %s", (permissions, expected) => {
    expect(buildPageViewModel(pageScreen({ page: { permissions } }), NOW).canEditHere).toBe(expected);
  });
});

describe("buildPageViewModel — a past version (RD-060)", () => {
  const past = pageScreen({
    version: { number: 3, title: "Old title", current: false, createdAt: "2026-10-09T10:00:00.000Z", content: { type: "doc", content: [] } },
  });

  it("is read-only: no Edit even for an editor, and the banner names the version", () => {
    const view = buildPageViewModel(past, NOW);
    expect(view.canEditHere).toBe(false);
    expect(view.pastVersion).toBe(3);
  });

  it("shows that version's title and content; the breadcrumb keeps the page's current title", () => {
    const view = buildPageViewModel(past, NOW);
    expect(view.title).toBe("Old title");
    expect(view.content).toEqual({ type: "doc", content: [] });
    expect(view.crumbs.at(-1)).toEqual({ label: "Specifications", href: null });
  });

  it("dates the byline by that version", () => {
    expect(buildPageViewModel(past, NOW).byline.relative).toBe("2 days ago");
  });

  it("asking for the current version by number is the current view", () => {
    const view = buildPageViewModel(pageScreen({ version: { number: 7, current: true } }), NOW);
    expect(view.pastVersion).toBeNull();
    expect(view.canEditHere).toBe(true);
  });
});

describe("buildPageViewModel — the draft notice (RD-055)", () => {
  it("appears for the viewer's own draft, on the current version, when they can still edit", () => {
    expect(buildPageViewModel(pageScreen({ page: { hasDraft: true } }), NOW).showDraftNotice).toBe(true);
  });

  it("does not appear without a draft, on a past version, or without EDIT", () => {
    expect(buildPageViewModel(pageScreen({ page: { hasDraft: false } }), NOW).showDraftNotice).toBe(false);
    expect(buildPageViewModel(pageScreen({ page: { hasDraft: true }, version: { number: 2, current: false } }), NOW).showDraftNotice).toBe(false);
    expect(
      buildPageViewModel(pageScreen({ page: { hasDraft: true, permissions: { canEdit: false, canAdmin: false } } }), NOW).showDraftNotice,
    ).toBe(false);
  });
});
