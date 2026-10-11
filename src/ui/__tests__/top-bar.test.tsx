// @vitest-environment jsdom
// Spec 10 §2, element for element. The Playwright suite checks the same in a real browser;
// this one runs in `pnpm verify`.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import { TopBar, type TopBarProps } from "@/ui/top-bar";

// `Create` is a client component that navigates (create-page-button.tsx); its own behaviour is
// tested in create-page-button.test.tsx.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

const base: TopBarProps = {
  user: { name: "Alice Admin", email: "alice@reqforge.test", isInstanceAdmin: true },
  recentSpaces: [{ key: "TEAM", name: "Team" }],
  creatableSpaces: [{ key: "TEAM", name: "Team" }],
  currentSpace: null,
  signOutAction: vi.fn(),
};
const bar = (over: Partial<TopBarProps> = {}) => render(<TopBar {...base} {...over} />);
const openMenu = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("TopBar — v1 elements (10 §2)", () => {
  it("shows the logo and product name as a link home", () => {
    bar();
    const home = screen.getByRole("link", { name: t("app.name") });
    expect(home).toHaveAttribute("href", "/");
  });

  it("has Spaces, Create, ···, Search, help, admin and the avatar", () => {
    bar();
    expect(screen.getByRole("button", { name: t("shell.spaces") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("shell.create") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("shell.more") })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: t("shell.search.label") })).toBeTruthy();
    expect(screen.getByRole("link", { name: t("shell.help") })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("link", { name: t("shell.admin") })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("button", { name: t("shell.avatar") })).toBeTruthy();
  });

  it("search is a GET form to /search that submits the query as q", () => {
    bar({ searchQuery: "FN-01" });
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/search");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("searchbox")).toHaveAttribute("name", "q");
    expect(screen.getByRole("searchbox")).toHaveValue("FN-01");
  });

  it("shows the administration gear to instance administrators only", () => {
    bar({ user: { ...base.user, isInstanceAdmin: false } });
    expect(screen.queryByRole("link", { name: t("shell.admin") })).toBeNull();
  });

  it("renders the avatar as initials", () => {
    bar();
    expect(screen.getByRole("button", { name: t("shell.avatar") })).toHaveTextContent("AA");
  });
});

describe("TopBar — 'later' slots are held but inert; 'not built' is absent", () => {
  it("People is drawn and aria-disabled, with no link", () => {
    bar();
    const people = screen.getByText(t("shell.people"));
    expect(people).toHaveAttribute("aria-disabled", "true");
    expect(people.closest("a")).toBeNull();
  });

  it("the notifications bell is a disabled button", () => {
    bar();
    expect((screen.getByRole("button", { name: t("shell.notifications") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no app switcher and names no other vendor", () => {
    const { container } = bar();
    expect(screen.queryByRole("button", { name: /app switcher|switch to/i })).toBeNull();
    expect(container.textContent).not.toMatch(/confluence|requirement yogi|atlassian|jira/i);
  });

  it("API tokens and Templates are inert menu items until their slices ship", () => {
    bar();
    openMenu(t("shell.avatar"));
    expect(screen.getByRole("menuitem", { name: t("shell.avatar.tokens") })).toHaveAttribute("aria-disabled", "true");
    openMenu(t("shell.more"));
    expect(screen.getByRole("menuitem", { name: t("shell.more.templates") })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("TopBar — Spaces ▾", () => {
  it("lists recent spaces, then 'View all spaces'", () => {
    bar({ recentSpaces: [{ key: "PLAT", name: "Platform" }, { key: "TEAM", name: "Team" }] });
    openMenu(t("shell.spaces"));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Platform", "Team", t("shell.spaces.viewAll")]);
    expect(items[0]).toHaveAttribute("href", "/spaces/PLAT");
    expect(items[2]).toHaveAttribute("href", "/spaces");
  });

  it("with nothing recent offers only 'View all spaces'", () => {
    bar({ recentSpaces: [] });
    openMenu(t("shell.spaces"));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem")).toHaveLength(1);
  });
});

describe("TopBar — Create (10 §2, RD-052, RD-056)", () => {
  it("outside a space opens a picker of the spaces the user can edit; picking one creates a page there", () => {
    bar({ creatableSpaces: [{ key: "TEAM", name: "Team" }] });
    const create = screen.getByRole("button", { name: t("shell.create") });
    expect(create).toHaveAttribute("aria-haspopup", "menu");
    openMenu(t("shell.create"));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Team"]);
    expect(items[0]?.tagName).toBe("BUTTON");
  });

  it("says so when there is nowhere to create", () => {
    bar({ creatableSpaces: [] });
    openMenu(t("shell.create"));
    expect(screen.getByRole("menuitem", { name: t("shell.create.noSpace") })).toHaveAttribute("aria-disabled", "true");
  });

  it("inside a space the user can edit, is a plain button that creates a page at once", () => {
    bar({ currentSpace: { key: "TEAM", canEdit: true, canAdmin: false } });
    const create = screen.getByRole("button", { name: t("shell.create") });
    expect((create as HTMLButtonElement).disabled).toBe(false);
    expect(create).not.toHaveAttribute("aria-haspopup");
    expect(create).not.toHaveAttribute("aria-disabled");
  });

  it("inside a read-only space falls back to the picker", () => {
    bar({ currentSpace: { key: "TEAM", canEdit: false, canAdmin: false } });
    const create = screen.getByRole("button", { name: t("shell.create") });
    expect((create as HTMLButtonElement).disabled).toBe(false);
    expect(create).toHaveAttribute("aria-haspopup", "menu");
  });
});

describe("TopBar — Requirement types in ··· (admin)", () => {
  it("is offered to instance administrators and to space admins, and to nobody else", () => {
    const shown = () => {
      openMenu(t("shell.more"));
      const present = screen.queryByRole("menuitem", { name: t("shell.more.requirementTypes") }) !== null;
      cleanup();
      return present;
    };
    bar({ user: { ...base.user, isInstanceAdmin: true } });
    expect(shown()).toBe(true);
    bar({ user: { ...base.user, isInstanceAdmin: false }, currentSpace: { key: "T", canEdit: true, canAdmin: true } });
    expect(shown()).toBe(true);
    bar({ user: { ...base.user, isInstanceAdmin: false }, currentSpace: { key: "T", canEdit: true, canAdmin: false } });
    expect(shown()).toBe(false);
  });
});

describe("TopBar — sign out", () => {
  it("is a form posting the supplied server action", () => {
    bar();
    openMenu(t("shell.avatar"));
    const item = screen.getByRole("menuitem", { name: t("shell.avatar.signOut") });
    expect(item.tagName).toBe("BUTTON");
    expect(item.getAttribute("type")).toBe("submit");
    expect(item.closest("form")).not.toBeNull();
  });
});
