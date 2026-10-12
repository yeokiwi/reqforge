// The editor's interactions (10 §5.1, §5.4, §5.5; RD-057, RD-058, RD-076, RD-077, RD-078):
// `{` suggestions, the `+` menu, undo/redo, find and replace, paste and drop, uploads and the
// guards while one is in flight.
import type { Locator, Page } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import {
  PNG_1PX,
  SAME_ORIGIN,
  TEAM,
  createPageViaApi,
  docOf,
  dropFilesOn,
  editUrl,
  getPageViaApi,
  image,
  p,
  pageApi,
  pageViewPattern,
  paragraph,
  pasteInto,
  solidPng,
  text,
  uploadViaApi,
} from "./pages";

function editor(page: Page) {
  return {
    toolbar: page.getByRole("toolbar", { name: t("editor.toolbar") }),
    content: page.getByRole("textbox", { name: t("editor.content.label") }),
    saveState: page.getByTestId("editor-footer").getByRole("status"),
    update: page.getByRole("button", { name: t("editor.update"), exact: true }),
    close: page.getByRole("button", { name: t("editor.close"), exact: true }),
    more: page.getByTestId("editor-footer").getByRole("button", { name: t("editor.more") }),
  };
}

async function openEditor(page: Page, title: string): Promise<string> {
  await signIn(page, "bob");
  const created = await createPageViaApi(page.request, TEAM, { title });
  await page.goto(editUrl(TEAM, created.id));
  await editor(page).content.click();
  return created.id;
}

const suggestions = (page: Page) => page.getByRole("listbox", { name: t("autocomplete.title") });
/** An option's visible label follows its decorative glyph (10 §5.4 draws `ⓘ Info`). */
const labelled = (...names: string[]) => names.map((name) => new RegExp(`^\\W*${name}$`));
/** Attachment images only: ProseMirror adds a separator <img> after an inline atom that ends a line. */
const ATTACHMENT_IMG = 'img[src^="/api/v1/attachments/"]';

test.describe("inserting", () => {
  test("`{` opens Macro suggestions in the drawn order; typing filters; Enter inserts; Escape closes", async ({ page }) => {
    const id = await openEditor(page, "Macros page");
    await page.keyboard.type("{");
    const list = suggestions(page);
    await expect(list).toBeVisible();
    await expect(list.getByRole("option")).toHaveText(
      labelled(t("editor.macro.info"), t("editor.macro.status"), t("editor.macro.gallery"), t("editor.macro.toc"), t("editor.macro.requirement"), t("autocomplete.browser")),
    );
    for (const later of [t("editor.macro.gallery"), t("editor.macro.requirement")]) {
      await expect(list.getByRole("option", { name: later })).toHaveAttribute("aria-disabled", "true");
    }
    await expect(list.getByRole("option", { name: t("editor.macro.info") })).toHaveAttribute("aria-selected", "true");

    // Escape closes it and leaves the text.
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(editor(page).content).toHaveText("{");
    await page.keyboard.press("Backspace");

    await page.keyboard.type("Intro text");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{tab");
    await expect(list.getByRole("option")).toHaveText(labelled(t("editor.macro.toc"), t("autocomplete.browser")));
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(editor(page).content.locator('[data-type="tableOfContents"]')).toBeVisible();
    await expect(editor(page).content).not.toContainText("{tab");

    // Recency: the list now starts with what was inserted last (10 §5.4).
    await editor(page).content.getByText("Intro text").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{");
    await expect(list.getByRole("option").first()).toHaveText(labelled(t("editor.macro.toc"))[0] ?? "");
    await page.keyboard.type("inf");
    await expect(list.getByRole("option")).toHaveText(labelled(t("editor.macro.info"), t("autocomplete.browser")));
    await page.keyboard.press("Enter");
    const panel = editor(page).content.locator('[data-type="infoPanel"]');
    await expect(panel).toBeVisible();
    await expect(editor(page).content).not.toContainText("{inf");
    await page.keyboard.type("Inside the info panel");
    await expect(panel).toContainText("Inside the info panel"); // the node view also holds its Panel type control

    await editor(page).update.click();
    await expect(page).toHaveURL(pageViewPattern(TEAM, id));
    await expect(page.getByTestId("page-view").locator('[data-type="infoPanel"]')).toHaveText("Inside the info panel");
    await expect(page.getByTestId("page-view").locator('[data-type="tableOfContents"]')).toHaveCount(1);
  });

  test("the + menu lists every 10 §5.5 item in order, later ones disabled, and inserts", async ({ page }) => {
    const id = await openEditor(page, "Insert menu page");
    const trigger = editor(page).toolbar.getByRole("button", { name: t("editor.insertMore") });
    await trigger.click();
    const menu = page.getByRole("menu", { name: t("editor.insertMore") });
    await expect(menu.getByRole("menuitem")).toHaveText([
      t("editor.files"),
      t("editor.link"),
      t("editor.insert.markup"),
      t("editor.insert.horizontalRule"),
      t("editor.taskList"),
      t("editor.insert.date"),
      t("editor.insert.symbol"),
      t("editor.insert.mention"),
      t("editor.insert.externalIssue"),
      t("editor.macro.info"),
      t("editor.macro.status"),
      t("editor.macro.gallery"),
      t("editor.macro.toc"),
      t("editor.macro.requirement"),
      t("insertMenu.otherMacros"),
    ]);
    for (const later of [t("editor.insert.externalIssue"), t("editor.macro.gallery"), t("editor.macro.requirement")]) {
      await expect(menu.getByRole("menuitem", { name: later })).toHaveAttribute("aria-disabled", "true");
    }

    await menu.getByRole("menuitem", { name: t("editor.insert.horizontalRule") }).click();
    await expect(editor(page).content.locator("hr")).toHaveCount(1);

    // Status opens its editor at once; the lozenge takes the chosen text and colour.
    await trigger.click();
    await menu.getByRole("menuitem", { name: t("editor.macro.status") }).click();
    const status = page.getByRole("dialog", { name: t("editor.status.title") });
    await status.getByRole("textbox", { name: t("editor.status.text") }).fill("IN REVIEW");
    await status.getByRole("radio", { name: t("editor.colour.green") }).check();
    await status.getByRole("button", { name: t("editor.dialog.done") }).click();
    await expect(editor(page).content.locator('[data-type="status"]')).toHaveText("IN REVIEW");

    // Symbol.
    await trigger.click();
    await menu.getByRole("menuitem", { name: t("editor.insert.symbol") }).click();
    const symbols = page.getByRole("dialog", { name: t("editor.symbol.title") });
    await symbols.getByRole("button", { name: "©" }).click();
    await expect(symbols).toHaveCount(0);
    await expect(editor(page).content).toContainText("©");

    // Other macros opens the macro browser, which also lists the macros of later slices.
    await trigger.click();
    await menu.getByRole("menuitem", { name: t("insertMenu.otherMacros") }).click();
    const browser = page.getByRole("dialog", { name: t("editor.macroBrowser.title") });
    for (const name of [t("editor.macro.requirementReport"), t("editor.macro.traceabilityMatrix"), t("editor.macro.baseline")]) {
      await expect(browser.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-disabled", "true");
    }
    await browser.getByRole("button", { name: t("editor.dialog.close") }).click();

    await editor(page).update.click();
    await expect(page).toHaveURL(pageViewPattern(TEAM, id));
    const view = page.getByTestId("page-view");
    await expect(view.locator("hr")).toHaveCount(1);
    await expect(view.locator('[data-type="status"]')).toHaveText("IN REVIEW");
    await expect(view.locator('[data-type="status"]')).toHaveAttribute("data-colour", "green");
  });

  test("Undo and Redo on the toolbar", async ({ page }) => {
    await openEditor(page, "Undo page");
    const undo = editor(page).toolbar.getByRole("button", { name: t("editor.undo") });
    const redo = editor(page).toolbar.getByRole("button", { name: t("editor.redo") });
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.type("Hello world");
    await expect(undo).not.toHaveAttribute("aria-disabled", "true");
    await undo.click();
    await expect(editor(page).content).not.toContainText("Hello world");
    await expect(redo).not.toHaveAttribute("aria-disabled", "true");
    await redo.click();
    await expect(editor(page).content).toHaveText("Hello world");
    await page.keyboard.press("Control+z");
    await expect(editor(page).content).not.toContainText("Hello world");
    await page.keyboard.press("Control+Shift+z");
    await expect(editor(page).content).toHaveText("Hello world");
  });

  test("Find and replace counts matches, honours Match case and replaces them all as one undo step", async ({ page }) => {
    await openEditor(page, "Find page");
    await page.keyboard.type("apple Apple apple pie");
    await editor(page).toolbar.getByRole("button", { name: t("editor.find") }).click();
    const bar = page.getByRole("search", { name: t("editor.find") });
    const query = bar.getByRole("searchbox", { name: t("editor.find.query") });
    await expect(query).toBeFocused();
    await query.fill("apple");
    const count = bar.getByRole("status");
    await expect(count).toHaveText(t("editor.find.count", { current: 1, total: 3 }));
    await bar.getByRole("button", { name: t("editor.find.next") }).click();
    await expect(count).toHaveText(t("editor.find.count", { current: 2, total: 3 }));
    await bar.getByRole("checkbox", { name: t("editor.find.matchCase") }).check();
    await expect(count).toHaveText(new RegExp(`of 2$`));
    await bar.getByRole("checkbox", { name: t("editor.find.matchCase") }).uncheck();

    await bar.getByRole("textbox", { name: t("editor.find.replacement") }).fill("pear");
    await bar.getByRole("button", { name: t("editor.find.replaceAll") }).click();
    await expect(editor(page).content).toHaveText("pear pear pear pie");
    await expect(count).toHaveText(t("editor.find.none"));

    await editor(page).toolbar.getByRole("button", { name: t("editor.undo") }).click();
    await expect(editor(page).content).toHaveText("apple Apple apple pie");
    await query.press("Escape");
    await expect(bar).toHaveCount(0);
  });
});

test.describe("the editor draws content as the view does", () => {
  /** How far the checkbox's middle is from the middle of its item's first line, and whether it is left of the text. */
  async function taskGeometry(item: Locator): Promise<{ readonly offset: number; readonly leftOfText: boolean }> {
    const box = await item.getByRole("checkbox").boundingBox();
    const text = await item.locator("p").first().boundingBox();
    if (!box || !text) throw new Error("task item not on screen");
    return { offset: Math.abs(box.y + box.height / 2 - (text.y + Math.min(text.height, 24) / 2)), leftOfText: box.x + box.width <= text.x };
  }

  test("a task item's box sits on its text's first line, in the editor as in the view (content.css: one look in both)", async ({ page }) => {
    const id = await openEditor(page, "Tasks page");
    await editor(page).toolbar.getByRole("button", { name: t("editor.taskList"), exact: true }).click();
    await page.keyboard.type("Write the acceptance tests");
    const inEditor = editor(page).content.getByRole("listitem").filter({ hasText: "Write the acceptance tests" });
    await expect(inEditor.getByRole("checkbox")).toBeVisible();
    const edited = await taskGeometry(inEditor);

    await editor(page).update.click();
    await expect(page).toHaveURL(pageViewPattern(TEAM, id));
    const inView = page.getByTestId("page-view").getByRole("listitem").filter({ hasText: "Write the acceptance tests" });
    const viewed = await taskGeometry(inView);
    expect(viewed.leftOfText, "in the page view the box is left of the text").toBe(true);
    expect(viewed.offset, "in the page view the box is on the text's first line").toBeLessThanOrEqual(6);
    expect(edited.leftOfText, "in the editor the box is left of the text, as in the view").toBe(true);
    expect(edited.offset, "in the editor the box is on the text's first line, as in the view").toBeLessThanOrEqual(6);
  });

  test("the { popup opened near the bottom of the window stays on screen", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Long page" });
    const lines = Array.from({ length: 60 }, (_, i) => p(`Line ${i + 1}`));
    const publish = await page.request.put(pageApi(TEAM, created.id), { headers: SAME_ORIGIN, data: { title: "Long page", content: docOf(...lines), baseVersion: 1 } });
    expect(publish.status()).toBe(200);
    await page.goto(editUrl(TEAM, created.id));
    await editor(page).content.getByText("Line 60", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("{");
    const list = suggestions(page);
    await expect(list).toBeVisible();
    // Every option can be seen (and clicked): the popup flips or shifts rather than run off the window.
    for (const option of await list.getByRole("option").all()) await expect(option).toBeInViewport({ ratio: 1 });
  });
});

test.describe("paste and drop", () => {
  test("pasted plain text and pasted HTML with a table land as content and survive Update", async ({ page }) => {
    const id = await openEditor(page, "Paste page");
    await pasteInto(editor(page).content, { text: "Plain pasted line" });
    await expect(editor(page).content).toContainText("Plain pasted line");
    await page.keyboard.press("Enter");
    await pasteInto(editor(page).content, {
      html: "<p>Before the table</p><table><tr><th>Name</th><th>Owner</th></tr><tr><td>Alpha</td><td>Albert</td></tr></table>",
      text: "Before the table\nName\tOwner\nAlpha\tAlbert",
    });
    const pasted = editor(page).content.getByRole("table");
    await expect(pasted.getByRole("row")).toHaveCount(2);
    await expect(pasted.getByRole("row").nth(1)).toHaveText("AlphaAlbert");

    await editor(page).update.click();
    await expect(page).toHaveURL(pageViewPattern(TEAM, id));
    const view = page.getByTestId("page-view");
    await expect(view.getByText("Plain pasted line")).toBeVisible();
    await expect(view.getByRole("table").getByRole("row").nth(0)).toHaveText("NameOwner");
    await expect(view.getByRole("table").getByRole("row").nth(1)).toHaveText("AlphaAlbert");
  });

  test("an image pasted as a file and one dropped both upload, show, survive Update and render in the view", async ({ page }) => {
    const id = await openEditor(page, "Image page");
    await page.keyboard.type("Pictures: ");
    const red = solidPng(24, [220, 20, 20]);
    const blue = solidPng(24, [20, 20, 220]);

    const firstUpload = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/attachments"));
    await pasteInto(editor(page).content, { files: [{ name: "", mimeType: "image/png", buffer: red }] }); // a screenshot has no name
    expect((await firstUpload).status()).toBe(201);
    await expect(editor(page).content.locator(ATTACHMENT_IMG)).toHaveCount(1);

    const box = await editor(page).content.boundingBox();
    const secondUpload = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/attachments"));
    await dropFilesOn(editor(page).content, [{ name: "dropped.png", mimeType: "image/png", buffer: blue }], { x: (box?.width ?? 200) - 20, y: 10 });
    expect((await secondUpload).status()).toBe(201);
    const images = editor(page).content.locator(ATTACHMENT_IMG);
    await expect(images).toHaveCount(2);
    await expect(page.getByRole("region", { name: t("editor.upload.region") }).getByText(/Uploading/)).toHaveCount(0);

    await expect(editor(page).update).toBeEnabled();
    await editor(page).update.click();
    await expect(page).toHaveURL(pageViewPattern(TEAM, id));
    const shown = page.getByTestId("page-view").locator("img");
    await expect(shown).toHaveCount(2);
    for (const i of [0, 1]) {
      await expect.poll(() => shown.nth(i).evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(24);
      await expect(shown.nth(i)).toHaveAttribute("src", /^\/api\/v1\/attachments\/[A-Za-z0-9_-]+\//);
    }
    const stored = await getPageViaApi(page.request, TEAM, id);
    expect(JSON.stringify(stored.version.content).match(/"type":"image"/g)).toHaveLength(2);
    // The nameless paste was uploaded as image.png (RD-077).
    const attachments = (await (await page.request.get(`${pageApi(TEAM, id)}/attachments`)).json()) as { filename: string }[];
    expect(attachments.map((a) => a.filename).sort()).toEqual(["dropped.png", "image.png"]);
  });

  test("while an upload is in flight, Update, Close and ··· wait, and leaving the tab asks first", async ({ page }) => {
    await openEditor(page, "Slow upload page");
    await page.keyboard.type("Saved before the upload.");
    await expect(editor(page).saveState).toHaveText(t("editor.state.saved")); // nothing else is unsaved

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/attachments$/, async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });

    const chooser = page.waitForEvent("filechooser");
    await editor(page).toolbar.getByRole("button", { name: t("editor.files") }).click();
    await (await chooser).setFiles({ name: "slow.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect(page.getByRole("region", { name: t("editor.upload.region") })).toContainText(t("editor.upload.uploading", { name: "slow.png" }));
    await expect(editor(page).update).toBeDisabled();
    await expect(editor(page).close).toBeDisabled();
    await expect(editor(page).more).toHaveAttribute("aria-disabled", "true");

    // Closing or reloading the tab raises the browser's leave-page prompt (RD-076).
    const prompt = page.waitForEvent("dialog");
    const reload = page.reload({ timeout: 5_000 }).catch(() => null);
    const dialog = await prompt;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await reload;
    await expect(editor(page).content).toContainText("Saved before the upload.");
    await expect(editor(page).update).toBeDisabled();

    release();
    await expect(editor(page).content.locator(ATTACHMENT_IMG)).toHaveCount(1);
    await expect(editor(page).update).toBeEnabled();
    await expect(editor(page).close).toBeEnabled();
  });

  test("an image of another page's attachment is dropped from a paste and refused by the API", async ({ page }) => {
    await signIn(page, "bob");
    const owner = await createPageViaApi(page.request, TEAM, { title: "Owner of the image" });
    const theirs = await uploadViaApi(page.request, TEAM, owner.id, { name: "theirs.png", mimeType: "image/png", buffer: PNG_1PX });
    const thief = await createPageViaApi(page.request, TEAM, { title: "Borrower" });

    await page.goto(editUrl(TEAM, thief.id));
    await editor(page).content.click();
    await pasteInto(editor(page).content, { html: `<p>Keep this text <img src="${theirs.url}" alt="stolen"> and this</p>`, text: "Keep this text and this" });
    await expect(editor(page).content).toContainText("Keep this text");
    await expect(editor(page).content).toContainText("and this");
    await expect(editor(page).content.locator(ATTACHMENT_IMG)).toHaveCount(0); // RD-077

    // The server is the final word (RD-058): an image node may only name this page's attachments.
    for (const path of ["", "/draft"]) {
      const response = await page.request.put(`${pageApi(TEAM, thief.id)}${path}`, {
        headers: SAME_ORIGIN,
        data: { title: "Borrower", content: docOf(paragraph(text("x "), image(theirs))), baseVersion: 1 },
      });
      expect(response.status(), `PUT …${path}`).toBe(422);
      const problem = (await response.json()) as { code: string; errors: { path: string }[] };
      expect(problem.code).toBe("VALIDATION");
      expect(problem.errors.some((e) => e.path.startsWith("content.content.0"))).toBe(true);
    }
    const unchanged = await getPageViaApi(page.request, TEAM, thief.id);
    expect(unchanged.version.number).toBe(1);
    expect(JSON.stringify(unchanged.version.content)).not.toContain(theirs.id);
    // Its own attachment is fine.
    const mine = await uploadViaApi(page.request, TEAM, thief.id, { name: "mine.png", mimeType: "image/png", buffer: PNG_1PX });
    const ok = await page.request.put(pageApi(TEAM, thief.id), {
      headers: SAME_ORIGIN,
      data: { title: "Borrower", content: docOf(p("mine"), paragraph(image(mine))), baseVersion: 1 },
    });
    expect(ok.status()).toBe(200);
  });
});
