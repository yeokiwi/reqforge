// @vitest-environment jsdom
// The `···` menu (10 §4.1, RD-059) on the shared menu primitive: the video's order, inert items
// that cannot be activated, the keyboard route, and Copy / Move / Delete only with EDIT.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import { pageDetail } from "../../_lib/__tests__/fixtures";
import { PageMenu } from "../page-menu";

afterEach(cleanup);

function menu(canEdit = true) {
  const onOpenDialog = vi.fn();
  render(<PageMenu spaceKey="TEAM" page={pageDetail({ permissions: { canEdit, canAdmin: false } })} onOpenDialog={onOpenDialog} />);
  const trigger = screen.getByRole("button", { name: t("pageMenu.label") });
  return { trigger, onOpenDialog };
}

const EDITOR_ORDER = [
  "pageMenu.attachments",
  "pageMenu.history",
  "pageMenu.restrictions",
  "pageMenu.peopleWhoCanView",
  "pageMenu.info",
  "pageMenu.hierarchy",
  "pageMenu.exportWord",
  "pageMenu.reqforge",
  "pageMenu.copy",
  "pageMenu.move",
  "pageMenu.delete",
] as const;

describe("PageMenu", () => {
  it("is a menu button named for the deck, closed until opened", () => {
    const { trigger } = menu();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists every item in the video's order (RD-059)", () => {
    const { trigger } = menu();
    fireEvent.click(trigger);
    const items = within(screen.getByRole("menu", { name: t("pageMenu.label") })).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(EDITOR_ORDER.map((id) => t(id)));
  });

  it("without EDIT, Copy, Move and Delete are absent", () => {
    const { trigger } = menu(false);
    fireEvent.click(trigger);
    const names = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(names).toEqual(EDITOR_ORDER.slice(0, 8).map((id) => t(id)));
  });

  it("Page History and View in Hierarchy are links to 10 §11's URLs", () => {
    const { trigger } = menu();
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: t("pageMenu.history") })).toHaveAttribute("href", "/spaces/TEAM/pages/p1/history");
    expect(screen.getByRole("menuitem", { name: t("pageMenu.hierarchy") })).toHaveAttribute("href", "/spaces/TEAM?highlight=p1");
  });

  it("the four slots that have not shipped are inert: aria-disabled, titled, and do nothing", () => {
    const { trigger, onOpenDialog } = menu();
    fireEvent.click(trigger);
    for (const id of ["pageMenu.restrictions", "pageMenu.peopleWhoCanView", "pageMenu.exportWord", "pageMenu.reqforge"] as const) {
      const item = screen.getByRole("menuitem", { name: t(id) });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveAttribute("title", t("shell.later"));
      expect(item.tagName).not.toBe("A");
      expect(item.tagName).not.toBe("BUTTON");
      fireEvent.click(item);
    }
    expect(onOpenDialog).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy(); // still open: nothing happened
  });

  it("a dialog item reports its kind and closes the menu", () => {
    const { trigger, onOpenDialog } = menu();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: t("pageMenu.delete") }));
    expect(onOpenDialog).toHaveBeenCalledWith("delete");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keyboard: ArrowDown opens on Attachments; arrows skip the inert items; Escape closes back to the trigger", () => {
    const { trigger } = menu();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const panel = screen.getByRole("menu");
    const focused = () => document.activeElement?.textContent;
    expect(focused()).toBe(t("pageMenu.attachments"));
    const visited: (string | null | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(panel, { key: "ArrowDown" });
      visited.push(focused());
    }
    expect(visited).toEqual([
      t("pageMenu.history"),
      t("pageMenu.info"),
      t("pageMenu.hierarchy"),
      t("pageMenu.copy"),
      t("pageMenu.move"),
      t("pageMenu.delete"),
    ]);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dialog items are buttons, so Enter and Space activate them", () => {
    const { trigger } = menu();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const attachments = screen.getByRole("menuitem", { name: t("pageMenu.attachments") });
    expect(attachments.tagName).toBe("BUTTON");
    expect(attachments).toHaveAttribute("type", "button");
  });
});
