// @vitest-environment jsdom
// Spec 10 §3, both states.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import { SpaceSidebar, type SpaceSidebarProps } from "@/ui/space-sidebar";

afterEach(cleanup);

const base: SpaceSidebarProps = {
  space: { key: "TEAM", name: "Team", favourite: false, canAdmin: true },
  collapsed: false,
  current: "pages",
  setCollapsedAction: vi.fn(),
  setFavouriteAction: vi.fn(),
};
const sidebar = (over: Partial<SpaceSidebarProps> = {}) => render(<SpaceSidebar {...base} {...over} />);
const nav = () => screen.getByRole("complementary", { name: t("sidebar.nav") });

describe("SpaceSidebar — expanded (10 §3.2)", () => {
  it("shows the space header, Pages, Requirements, the page tree and the footer controls", () => {
    sidebar();
    expect(nav()).toHaveAttribute("data-state", "expanded");
    expect(within(nav()).getByRole("link", { name: "Team" })).toHaveAttribute("href", "/spaces/TEAM");
    expect(within(nav()).getByRole("link", { name: t("sidebar.pages") })).toHaveAttribute("href", "/spaces/TEAM");
    expect(within(nav()).getByRole("link", { name: t("sidebar.requirements") })).toHaveAttribute("href", "/requirements/TEAM");
    expect(within(nav()).getByRole("heading", { name: t("sidebar.pageTree") })).toBeTruthy();
    expect(within(nav()).getByRole("button", { name: t("sidebar.spaceTools") })).toBeTruthy();
    expect(within(nav()).getByRole("button", { name: t("sidebar.collapse") })).toBeTruthy();
  });

  it("marks exactly the current item as selected", () => {
    sidebar({ current: "requirements" });
    expect(screen.getByRole("link", { name: t("sidebar.requirements") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: t("sidebar.pages") })).not.toHaveAttribute("aria-current");
  });

  it("has no Blog, and shows no SPACE SHORTCUTS group when there are no shortcuts (RD-050)", () => {
    sidebar();
    expect(nav().textContent).not.toMatch(/blog/i);
    expect(screen.queryByText(t("sidebar.shortcuts"))).toBeNull();
  });

  it("shows the page tree's empty state until documents exist", () => {
    sidebar();
    expect(screen.getByText(t("sidebar.pageTree.empty"))).toBeTruthy();
  });

  it("Space tools is for space admins only", () => {
    sidebar({ space: { ...base.space, canAdmin: false } });
    expect(screen.queryByRole("button", { name: t("sidebar.spaceTools") })).toBeNull();
  });

  it("Space tools lists the four admin screens, with the spec's URLs", () => {
    sidebar();
    fireEvent.click(screen.getByRole("button", { name: t("sidebar.spaceTools") }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      t("sidebar.tools.permissions"),
      t("sidebar.tools.requirementTypes"),
      t("sidebar.tools.keySuggestions"),
      t("sidebar.tools.history"),
    ]);
    expect(items[2]).toHaveAttribute("href", "/spaces/TEAM/settings/requirements/key-suggestions"); // 10 §11
  });

  it("collapse posts collapsed=true", () => {
    sidebar();
    const button = screen.getByRole("button", { name: t("sidebar.collapse") });
    const input = button.closest("form")?.querySelector<HTMLInputElement>('input[name="collapsed"]');
    expect(input?.value).toBe("true");
  });

  it("the star is a toggle that posts the opposite of its current state", () => {
    sidebar();
    const off = screen.getByRole("button", { name: t("sidebar.favourite", { space: "Team" }) });
    expect(off).toHaveAttribute("aria-pressed", "false");
    expect(off.closest("form")?.querySelector<HTMLInputElement>('input[name="favourite"]')?.value).toBe("true");
    expect(off.closest("form")?.querySelector<HTMLInputElement>('input[name="spaceKey"]')?.value).toBe("TEAM");
    cleanup();

    sidebar({ space: { ...base.space, favourite: true } });
    const on = screen.getByRole("button", { name: t("sidebar.unfavourite", { space: "Team" }) });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on.closest("form")?.querySelector<HTMLInputElement>('input[name="favourite"]')?.value).toBe("false");
  });
});

describe("SpaceSidebar — collapsed icon rail (10 §3.1)", () => {
  const rail = () => sidebar({ collapsed: true });

  it("shows the rail's icons by accessible name and no text labels", () => {
    rail();
    expect(nav()).toHaveAttribute("data-state", "collapsed");
    for (const name of [t("sidebar.pages"), t("sidebar.requirements")]) {
      expect(within(nav()).getByRole("link", { name })).toBeTruthy();
    }
    for (const name of [t("sidebar.rail.exportOpen"), t("sidebar.rail.pageTree"), t("sidebar.spaceTools"), t("sidebar.expand")]) {
      expect(within(nav()).getByRole("button", { name })).toBeTruthy();
    }
    // Icons only: the labels are accessible names and tooltips, never visible text. (The space
    // logo's decorative initial is the one letter the rail does show.)
    for (const label of [t("sidebar.pages"), t("sidebar.requirements"), t("sidebar.spaceTools"), t("sidebar.pageTree")]) {
      expect(within(nav()).queryByText(label), label).toBeNull();
    }
  });

  it("both unlabelled icons and » post collapsed=false", () => {
    rail();
    for (const name of [t("sidebar.rail.exportOpen"), t("sidebar.rail.pageTree"), t("sidebar.expand")]) {
      const form = screen.getByRole("button", { name }).closest("form");
      expect(form?.querySelector<HTMLInputElement>('input[name="collapsed"]')?.value, name).toBe("false");
    }
  });

  it("keeps the selected item marked", () => {
    sidebar({ collapsed: true, current: "requirements" });
    expect(screen.getByRole("link", { name: t("sidebar.requirements") })).toHaveAttribute("aria-current", "page");
  });

  it("has no Blog and no rail overflow (RD-050)", () => {
    rail();
    expect(screen.queryByRole("button", { name: /more|overflow/i })).toBeNull();
    expect(nav().innerHTML).not.toMatch(/blog/i);
  });

  it("still gates Space tools on admin", () => {
    sidebar({ collapsed: true, space: { ...base.space, canAdmin: false } });
    expect(screen.queryByRole("button", { name: t("sidebar.spaceTools") })).toBeNull();
  });
});
