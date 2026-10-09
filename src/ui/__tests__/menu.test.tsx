// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Menu, MenuItemDisabled, MenuLink } from "@/ui/menu";

afterEach(cleanup);

function setup() {
  render(
    <>
      <Menu label="Things" trigger="Things">
        <MenuLink href="/one">One</MenuLink>
        <MenuItemDisabled>Two (off)</MenuItemDisabled>
        <MenuLink href="/three">Three</MenuLink>
      </Menu>
      <button type="button">elsewhere</button>
    </>,
  );
  return screen.getByRole("button", { name: "Things" });
}

describe("Menu (WAI-ARIA menu button)", () => {
  it("starts closed, with aria-expanded=false", () => {
    const trigger = setup();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on click and exposes a labelled menu", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Things" })).toBeTruthy();
  });

  it("ArrowDown on the trigger opens it and focuses the first item", () => {
    const trigger = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "One" }));
  });

  it("arrow keys move between items, skip disabled ones and wrap", () => {
    const trigger = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Three" })); // skipped "Two"
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "One" })); // wrapped
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Three" })); // wrapped back
  });

  it("Home and End jump to the first and last enabled item", () => {
    const trigger = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Three" }));
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "One" }));
  });

  it("Escape closes it and returns focus to the trigger", () => {
    const trigger = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab closes it", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a pointer press outside closes it; inside does not", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "One" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("choosing a link closes the menu", () => {
    // jsdom cannot navigate; cancel the default action after React's handler has run.
    const cancel = (event: Event) => event.preventDefault();
    document.addEventListener("click", cancel);
    try {
      const trigger = setup();
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("menuitem", { name: "One" }));
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      document.removeEventListener("click", cancel);
    }
  });

  it("disabled items are announced as disabled and are not links", () => {
    fireEvent.click(setup());
    const off = screen.getByRole("menuitem", { name: "Two (off)" });
    expect(off).toHaveAttribute("aria-disabled", "true");
    expect(off.tagName).toBe("SPAN");
  });
});
