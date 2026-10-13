// Accessibility of every slice-1 screen (WCAG 2.1 A and AA, with axe), and a keyboard-only pass:
// the page view header's Tab order, the `···` menu button, the page tree's arrow keys, and modal
// dialogs that trap focus and give it back. Serious and critical axe violations fail the test
// (softly, so every screen of a test is reported); every violation is attached and logged.
// spec: docs/specs/10-ui-reference.md sections 3.2, 4, 5, 11, 23; RD-078 (aria-disabled controls stay focusable), RD-082 (WAI-ARIA tree)
import type { Locator, Page } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import {
  PNG_1PX,
  SAME_ORIGIN,
  TEAM,
  checkA11y,
  clickAtEdge,
  compareUrl,
  createTreeViaApi,
  editUrl,
  historyUrl,
  overviewTree,
  pageApi,
  pageUrl,
  paragraphs,
  publishSeries,
  specificationsDoc,
  treeItem,
  uploadViaApi,
} from "./pages";

const menuTrigger = (page: Page) => page.getByRole("button", { name: t("pageMenu.label") });
const pageMenu = (page: Page) => page.getByRole("menu", { name: t("pageMenu.label") });

/** The accessible-name-ish label of the focused element: aria-label, else its text. */
async function focusedLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return "";
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    return (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
  });
}

const holdsFocus = (container: Locator) => container.evaluate((el) => el.contains(document.activeElement));

/** Presses Tab `count` times (Shift+Tab when `back`), checking after each press that focus stayed inside. */
async function expectFocusTrapped(page: Page, dialog: Locator, count: number, back = false): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    expect(await holdsFocus(dialog), `focus left the dialog after ${i + 1} × ${back ? "Shift+Tab" : "Tab"}`).toBe(true);
  }
}

/** A TEAM page with the video's content, a child, three versions and an attachment, made by bob. */
async function populatedSpace(page: Page) {
  const tree = await createTreeViaApi(page.request, TEAM, [
    { title: "Specifications", children: [{ title: "Page Heading" }, { title: "Test session 1a", children: [{ title: "Session notes" }] }] },
    { title: "Team notes" },
  ]);
  const specs = tree.Specifications;
  if (!specs) throw new Error("set-up failed");
  await publishSeries(page.request, TEAM, specs, [
    { content: paragraphs("First draft of the specifications."), message: "first draft" },
    { content: specificationsDoc(), message: "the requirements tables" },
  ]);
  await uploadViaApi(page.request, TEAM, specs.id, { name: "diagram.png", mimeType: "image/png", buffer: PNG_1PX });
  return { specs, child: tree["Page Heading"] ?? specs };
}

test.describe("axe: WCAG 2.1 AA on every slice-1 screen", () => {
  test("sign-in", async ({ page }, testInfo) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: t("auth.submit") })).toBeVisible();
    await checkA11y(page, testInfo, "login");
  });

  test("space overview: empty, with a tree, with a highlighted page", async ({ page }, testInfo) => {
    await signIn(page, "bob", "/spaces/TEAM");
    await expect(page.getByText(t("space.empty"))).toBeVisible();
    await checkA11y(page, testInfo, "overview, empty");

    const { child } = await populatedSpace(page);
    await page.reload();
    await expect(treeItem(overviewTree(page), "Specifications")).toBeVisible();
    await checkA11y(page, testInfo, "overview, with a tree");

    await page.goto(`/spaces/TEAM?highlight=${child.id}`);
    await expect(treeItem(overviewTree(page), "Page Heading")).toHaveAttribute("aria-current", "true");
    await checkA11y(page, testInfo, "overview, highlighted");
  });

  test("page view: plain, a past version, the draft notice and its Discard dialog", async ({ page }, testInfo) => {
    await signIn(page, "bob");
    const { specs } = await populatedSpace(page);
    await page.goto(pageUrl(TEAM, specs.id));
    await expect(page.getByRole("table")).toBeVisible();
    await checkA11y(page, testInfo, "page view");

    await page.goto(`${pageUrl(TEAM, specs.id)}?version=2`);
    await expect(page.getByText(t("pageView.version.banner", { n: 2 }))).toBeVisible();
    await checkA11y(page, testInfo, "page view, version banner");

    const draft = await page.request.put(`${pageApi(TEAM, specs.id)}/draft`, {
      headers: SAME_ORIGIN,
      data: { title: "Specifications", content: paragraphs("Unpublished words"), baseVersion: 3 },
    });
    expect(draft.status()).toBe(200);
    await page.goto(pageUrl(TEAM, specs.id));
    await expect(page.getByText(t("pageView.draft.notice"))).toBeVisible();
    await checkA11y(page, testInfo, "page view, draft notice");
    await page.getByRole("button", { name: t("pageView.draft.discard") }).click();
    await expect(page.getByRole("dialog", { name: t("pageView.draft.discard.title") })).toBeVisible();
    await checkA11y(page, testInfo, "page view, discard draft dialog");
  });

  test("page view: the ··· menu open, and each of its dialogs", async ({ page }, testInfo) => {
    await signIn(page, "bob");
    const { specs } = await populatedSpace(page);
    await page.goto(pageUrl(TEAM, specs.id));
    await menuTrigger(page).click();
    await expect(pageMenu(page)).toBeVisible();
    await checkA11y(page, testInfo, "page view, ··· menu");
    // Closed with the trigger: after a pointer open, focus stays on the trigger and Escape does not
    // reach the menu (the keyboard route is asserted in "keyboard only" below).
    await menuTrigger(page).click();
    await expect(pageMenu(page)).toHaveCount(0);

    const dialogs: readonly (readonly [string, string, string])[] = [
      [t("pageMenu.attachments"), t("pageAttachments.title"), "attachments"],
      [t("pageMenu.info"), t("pageInfo.title"), "page information"],
      [t("pageMenu.copy"), t("pageCopy.title", { title: "Specifications" }), "copy"],
      [t("pageMenu.move"), t("pageMove.title", { title: "Specifications" }), "move"],
      [t("pageMenu.delete"), t("pageDelete.title", { title: "Specifications" }), "delete"],
    ];
    for (const [item, title, screen] of dialogs) {
      await menuTrigger(page).click();
      await pageMenu(page).getByRole("menuitem", { name: item, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      // Wait for what each dialog loads before judging it.
      if (screen === "attachments") await expect(dialog.getByRole("row").filter({ hasText: "diagram.png" })).toBeVisible();
      if (screen === "move") await expect(dialog.getByRole("option").first()).toBeVisible();
      if (screen === "delete") await expect(dialog).toContainText(t("pageDelete.body.children", { d: 3, n: 4 }));
      await checkA11y(page, testInfo, `page view, ${screen} dialog`);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  });

  test("the editor: toolbar, table tools, find, dialogs, the + menu and the { popup", async ({ page }, testInfo) => {
    await signIn(page, "bob");
    const { specs } = await populatedSpace(page);
    await page.goto(editUrl(TEAM, specs.id));
    const content = page.getByRole("textbox", { name: t("editor.content.label") });
    await expect(content.getByRole("table")).toBeVisible();
    await checkA11y(page, testInfo, "editor");

    await content.getByRole("cell", { name: "Albert" }).first().click();
    await expect(page.getByRole("toolbar", { name: t("editor.tableToolbar") })).toBeVisible();
    await checkA11y(page, testInfo, "editor, table tools");

    // Leaving the table removes toolbar row 2 and shifts the page under the pointer: click to
    // leave, wait for the row to go, click again to place the caret.
    const lastParagraph = content.locator("p").filter({ hasText: "for the conventions" });
    await lastParagraph.click();
    await expect(page.getByRole("toolbar", { name: t("editor.tableToolbar") })).toHaveCount(0);
    await clickAtEdge(lastParagraph, "end");
    await page.keyboard.press("Control+k");
    const linkDialog = page.getByRole("dialog", { name: t("editor.linkDialog.title") });
    await expect(linkDialog).toBeVisible();
    await checkA11y(page, testInfo, "editor, link dialog");
    await page.keyboard.press("Escape");
    await expect(linkDialog).toHaveCount(0);

    const toolbar = page.getByRole("toolbar", { name: t("editor.toolbar") });
    await toolbar.getByRole("button", { name: t("editor.insertMore") }).click();
    await expect(page.getByRole("menu", { name: t("editor.insertMore") })).toBeVisible();
    await checkA11y(page, testInfo, "editor, + menu");
    await page.keyboard.press("Escape");

    await toolbar.getByRole("button", { name: t("editor.find") }).click();
    await expect(page.getByRole("search", { name: t("editor.find") })).toBeVisible();
    await checkA11y(page, testInfo, "editor, find bar");
    await page.keyboard.press("Escape");

    await clickAtEdge(lastParagraph, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{");
    await expect(page.getByRole("listbox", { name: t("autocomplete.title") })).toBeVisible();
    await checkA11y(page, testInfo, "editor, { macro suggestions");
    await page.keyboard.press("Escape");

    await toolbar.getByRole("button", { name: t("editor.help") }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkA11y(page, testInfo, "editor, keyboard shortcuts dialog");
    await page.keyboard.press("Escape");

    await toolbar.getByRole("button", { name: t("editor.insertMore") }).click();
    await page.getByRole("menu", { name: t("editor.insertMore") }).getByRole("menuitem", { name: t("insertMenu.otherMacros") }).click();
    await expect(page.getByRole("dialog", { name: t("editor.macroBrowser.title") })).toBeVisible();
    await checkA11y(page, testInfo, "editor, macro browser");
    await page.keyboard.press("Escape");

    await page.getByTestId("editor-footer").getByRole("button", { name: t("editor.more") }).click();
    await expect(page.getByRole("menu", { name: t("editor.more") })).toBeVisible();
    await checkA11y(page, testInfo, "editor, footer ··· menu");
  });

  test("Page History, its Restore dialog, and Compare", async ({ page }, testInfo) => {
    await signIn(page, "alice"); // ADMIN: Restore and Delete both shown
    const { specs } = await populatedSpace(page);
    await page.goto(historyUrl(TEAM, specs.id));
    await expect(page.getByRole("table", { name: t("history.table", { title: "Specifications" }) })).toBeVisible();
    await checkA11y(page, testInfo, "page history");

    await page.getByRole("button", { name: t("history.restore.label", { n: 2 }) }).click();
    await expect(page.getByRole("dialog", { name: t("history.restore.title", { n: 2 }) })).toBeVisible();
    await checkA11y(page, testInfo, "page history, restore dialog");
    await page.keyboard.press("Escape");

    await page.goto(compareUrl(TEAM, specs.id, 2, 3));
    await expect(page.getByRole("table", { name: t("compare.table", { a: 2, b: 3 }) })).toBeVisible();
    await checkA11y(page, testInfo, "compare");
  });
});

test.describe("keyboard only", () => {
  test("Tab walks the page view header in reading order: breadcrumb, byline icons, Edit, Save for later, Watching, Share, ···", async ({ page }) => {
    await signIn(page, "bob");
    const { child } = await populatedSpace(page);
    await page.goto(pageUrl(TEAM, child.id));
    await page.getByRole("navigation", { name: t("pageView.breadcrumb") }).getByRole("link").first().focus();
    const seen = [await focusedLabel(page)];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      seen.push(await focusedLabel(page));
    }
    expect(seen).toEqual([
      t("sidebar.pages"),
      "Specifications",
      t("restrictions.title"),
      t("pageMenu.attachments"),
      t("pageView.byline.requirements"),
      t("page.edit"),
      t("page.saveForLater"),
      t("page.watching"),
      t("page.share"),
      t("pageMenu.label"),
    ]);
    // Every one of them shows where focus is.
    await expect(menuTrigger(page)).toBeFocused();
    const outline = await menuTrigger(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
    });
    expect(outline, "the focused ··· has no visible focus indicator").not.toBe("none 0px none");
  });

  test("the ··· menu button: Enter and Space open it with focus on the first item, so Escape can close it", async ({ page }) => {
    await signIn(page, "bob");
    const { specs } = await populatedSpace(page);
    await page.goto(pageUrl(TEAM, specs.id));
    const trigger = menuTrigger(page);
    const first = pageMenu(page).getByRole("menuitem", { name: t("pageMenu.attachments"), exact: true });

    // WAI-ARIA APG menu button, and src/ui/menu.tsx's own header comment ("Enter / Space /
    // ArrowDown on the trigger opens it and focuses the first item"). Soft, so both keys and the
    // pointer are reported; each is reset with a reload.
    for (const key of ["Enter", " "]) {
      await trigger.focus();
      await page.keyboard.press(key);
      await expect(pageMenu(page), `${JSON.stringify(key)} opens the menu`).toBeVisible();
      await expect.soft(first, `${JSON.stringify(key)} puts focus on the first item`).toBeFocused();
      await page.keyboard.press("Escape");
      await expect.soft(pageMenu(page), `Escape closes the menu ${JSON.stringify(key)} opened`).toHaveCount(0);
      await page.reload();
    }
    // A pointer open leaves focus on the trigger, where Escape is not handled at all.
    await trigger.click();
    await expect(pageMenu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.soft(pageMenu(page), "Escape closes a menu opened with the pointer").toHaveCount(0);
  });

  test("the ··· menu button: ArrowDown opens it; arrows wrap and skip inert items, Home and End jump; Escape and Tab close it", async ({ page }) => {
    await signIn(page, "bob");
    const { specs } = await populatedSpace(page);
    await page.goto(pageUrl(TEAM, specs.id));
    const trigger = menuTrigger(page);
    const item = (name: string) => pageMenu(page).getByRole("menuitem", { name, exact: true });

    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(item(t("pageMenu.attachments"))).toBeFocused();
    await page.keyboard.press("End");
    await expect(item(t("pageMenu.delete"))).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item(t("pageMenu.attachments"))).toBeFocused(); // wraps
    await page.keyboard.press("ArrowUp");
    await expect(item(t("pageMenu.delete"))).toBeFocused();
    await page.keyboard.press("Home");
    await expect(item(t("pageMenu.attachments"))).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item(t("pageMenu.history"))).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item(t("pageMenu.info"))).toBeFocused(); // the inert Restrictions and People who can view are skipped
    await page.keyboard.press("Enter");
    const info = page.getByRole("dialog", { name: t("pageInfo.title") });
    await expect(info).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(info).toHaveCount(0);
    await expect(trigger).toBeFocused(); // the item that opened it is gone: the trigger takes focus

    await page.keyboard.press("ArrowDown");
    await expect(item(t("pageMenu.attachments"))).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(pageMenu(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Tab closes an open menu.
    await page.keyboard.press("ArrowDown");
    await expect(pageMenu(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(pageMenu(page)).toHaveCount(0);
  });

  test("the page tree is one Tab stop, walked with the arrow keys; Enter opens the page", async ({ page }) => {
    await signIn(page, "carol"); // a viewer: no "+" buttons and no move keys in the way
    const { specs } = await (async () => {
      const setup = await page.context().browser()?.newContext();
      if (!setup) throw new Error("no browser");
      const bob = await setup.newPage();
      await signIn(bob, "bob");
      const made = await populatedSpace(bob);
      await setup.close();
      return made;
    })();
    await page.goto("/spaces/TEAM");
    const tree = overviewTree(page);
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1); // roving tabindex
    const specsItem = treeItem(tree, "Specifications");
    await tree.locator('[role="treeitem"][tabindex="0"]').focus();
    await expect(specsItem).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(treeItem(tree, "Team notes")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(specsItem).toBeFocused();
    await expect(specsItem).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight"); // opens
    await expect(specsItem).toHaveAttribute("aria-expanded", "true");
    await expect(specsItem).toBeFocused();
    await page.keyboard.press("ArrowRight"); // into the first child
    await expect(treeItem(tree, "Page Heading")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(treeItem(tree, "Test session 1a")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(treeItem(tree, "Session notes")).toBeFocused();
    await page.keyboard.press("End");
    await expect(treeItem(tree, "Team notes")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(specsItem).toBeFocused();
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft"); // from a child: to its parent
    await expect(specsItem).toBeFocused();
    await page.keyboard.press("ArrowLeft"); // on an open parent: closes it
    await expect(specsItem).toHaveAttribute("aria-expanded", "false");

    // Tab leaves the tree in one step, Shift+Tab comes back to the row that had focus.
    await page.keyboard.press("Tab");
    expect(await holdsFocus(tree)).toBe(false);
    await page.keyboard.press("Shift+Tab");
    await expect(specsItem).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(pageUrl(TEAM, specs.id));
  });

  test("modal dialogs keep focus inside, and give it back to what opened them", async ({ page }) => {
    await signIn(page, "alice");
    const { specs } = await populatedSpace(page);
    await page.goto(pageUrl(TEAM, specs.id));

    // Copy, opened from the ··· menu by keyboard: focus starts in the title field.
    await menuTrigger(page).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(pageMenu(page).getByRole("menuitem", { name: t("pageMenu.copy"), exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    const copy = page.getByRole("dialog", { name: t("pageCopy.title", { title: "Specifications" }) });
    await expect(copy.getByRole("textbox", { name: t("pageCopy.field") })).toBeFocused();
    await expectFocusTrapped(page, copy, 6);
    await expectFocusTrapped(page, copy, 6, true);
    await page.keyboard.press("Escape");
    await expect(copy).toHaveCount(0);
    await expect(menuTrigger(page)).toBeFocused();

    // Attachments, opened from the 📎 byline icon: focus comes back to 📎.
    const clip = page.getByTestId("page-header").getByRole("button", { name: t("pageMenu.attachments"), exact: true });
    await clip.focus();
    await page.keyboard.press("Enter");
    const attachments = page.getByRole("dialog", { name: t("pageAttachments.title") });
    await expect(attachments.getByRole("row").filter({ hasText: "diagram.png" })).toBeVisible();
    expect(await holdsFocus(attachments)).toBe(true);
    await expectFocusTrapped(page, attachments, 8);
    await page.keyboard.press("Escape");
    await expect(attachments).toHaveCount(0);
    await expect(clip).toBeFocused();

    // Delete (confirmation): the safe answer has focus; Escape gives focus back to ···.
    await menuTrigger(page).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await expect(pageMenu(page).getByRole("menuitem", { name: t("pageMenu.delete"), exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    const del = page.getByRole("dialog", { name: t("pageDelete.title", { title: "Specifications" }) });
    await expect(del.getByRole("button", { name: t("pageView.dialog.cancel") })).toBeFocused();
    await expectFocusTrapped(page, del, 4);
    await page.keyboard.press("Escape");
    await expect(menuTrigger(page)).toBeFocused();

    // Page History's Restore confirmation returns focus to its row's Restore.
    await page.goto(historyUrl(TEAM, specs.id));
    const restore = page.getByRole("button", { name: t("history.restore.label", { n: 2 }) });
    await restore.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: t("history.restore.title", { n: 2 }) });
    await expect(confirm.getByRole("button", { name: t("history.cancel") })).toBeFocused();
    await expectFocusTrapped(page, confirm, 4);
    await page.keyboard.press("Escape");
    await expect(restore).toBeFocused();

    // The editor's link dialog (Ctrl+K) gives focus back to the content.
    await page.goto(editUrl(TEAM, specs.id));
    const content = page.getByRole("textbox", { name: t("editor.content.label") });
    await content.getByText("for the conventions").click();
    await page.keyboard.press("Control+k");
    const link = page.getByRole("dialog", { name: t("editor.linkDialog.title") });
    await expect(link.getByRole("textbox", { name: t("editor.linkDialog.url") })).toBeFocused();
    await expectFocusTrapped(page, link, 6);
    await page.keyboard.press("Escape");
    await expect(link).toHaveCount(0);
    await expect(content).toBeFocused();
  });
});
