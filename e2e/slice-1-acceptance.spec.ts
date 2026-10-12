// Slice 1 acceptance (PLAN.md): write a page with tables and lists, reload, see it unchanged;
// every save (Update) creates a version; Close keeps the draft and Edit resumes it (RD-055);
// the table row of the toolbar appears only while the caret is in a table (10 §5.1).
import type { Page } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import { TEAM, createPageViaApi, editUrl, getPageViaApi, listVersionsViaApi, pageViewPattern } from "./pages";

const EDIT_URL = /\/spaces\/TEAM\/pages\/([A-Za-z0-9_-]+)\/edit$/;

function editor(page: Page) {
  return {
    toolbar: page.getByRole("toolbar", { name: t("editor.toolbar") }),
    tableToolbar: page.getByRole("toolbar", { name: t("editor.tableToolbar") }),
    title: page.getByRole("textbox", { name: t("editor.title.label") }),
    content: page.getByRole("textbox", { name: t("editor.content.label") }),
    saveState: page.getByTestId("editor-footer").getByRole("status"),
    changeNote: page.getByRole("textbox", { name: t("editor.changeNote.placeholder") }),
    update: page.getByRole("button", { name: t("editor.update"), exact: true }),
    close: page.getByRole("button", { name: t("editor.close"), exact: true }),
  };
}

/** Chooses an item of the toolbar's `Paragraph ▾` menu (10 §5.1). */
async function setTextStyle(page: Page, item: string): Promise<void> {
  await editor(page).toolbar.getByRole("button", { name: new RegExp(`^${t("editor.style.label")}`) }).click();
  await page.getByRole("menuitemradio", { name: item, exact: true }).click();
}

async function pressToolbar(page: Page, name: string): Promise<void> {
  await editor(page).toolbar.getByRole("button", { name, exact: true }).click();
}

/**
 * The page view's rendered content as a canonical tree — tags, attributes sorted by name, text —
 * without the header and byline (whose relative time moves on). Attribute ORDER is not content:
 * a client-side navigation and a server render may emit the same attributes in another order.
 */
async function renderedContent(page: Page): Promise<string> {
  return page.getByTestId("page-view").evaluate((article) => {
    const describe = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return JSON.stringify(node.textContent ?? "");
      if (!(node instanceof Element)) return "";
      const testId = node.getAttribute("data-testid");
      if (testId === "page-header" || testId === "page-byline") return "";
      const attrs = Array.from(node.attributes)
        .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
        .sort()
        .join(" ");
      return `<${node.tagName.toLowerCase()} ${attrs}>${Array.from(node.childNodes).map(describe).join("")}</>`;
    };
    return describe(article);
  });
}

/** What a reader of the page sees — asserted by role and text, the same before and after a reload. */
async function expectReleasePlan(page: Page): Promise<void> {
  const view = page.getByTestId("page-view");
  await expect(view.getByRole("heading", { level: 1 })).toHaveText("Release plan");
  await expect(view.getByRole("heading", { level: 2, name: "Scope" })).toBeVisible();
  await expect(view.getByText("This is bold and italic text.")).toBeVisible();
  await expect(view.locator("strong", { hasText: "bold" })).toBeVisible();
  await expect(view.locator("em", { hasText: "italic" })).toBeVisible();

  const lists = view.getByRole("list");
  await expect(lists.filter({ hasText: "First bullet" }).getByRole("listitem")).toHaveText(["First bullet", "Second bullet"]);
  await expect(view.locator("ol").filter({ hasText: "Step one" }).getByRole("listitem")).toHaveText(["Step one", "Step two"]);
  const task = view.getByRole("listitem").filter({ hasText: "Write tests" });
  await expect(task.getByRole("checkbox")).not.toBeChecked();

  await expect(view.getByRole("link", { name: "the spec" })).toHaveAttribute("href", "https://example.com/spec");
  await expect(view.locator("pre code")).toHaveText("npm run build");

  const rows = view.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText("KeyDescriptionOwner");
  await expect(rows.nth(1)).toHaveText("BR-01Lorem ipsumAlbert");
  await expect(rows.nth(0).locator("th")).toHaveCount(3); // new tables get a header row (RD-078)
}

test.describe("acceptance: a page with tables and lists", () => {
  test("Create opens the editor on a new Untitled page; what is written survives Update and a reload", async ({ page }) => {
    await signIn(page, "bob", "/spaces/TEAM");
    await page.getByRole("banner").getByRole("button", { name: t("shell.create") }).click();
    await page.waitForURL(EDIT_URL);
    const id = EDIT_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
    const e = editor(page);

    // A new page is made at once, titled Untitled (RD-056), and nothing has been edited yet.
    await expect(e.title).toHaveValue(t("page.untitled"));
    await expect(e.saveState).toHaveText(t("editor.state.ready"));
    await expect(page.getByRole("checkbox", { name: t("editor.notifyWatchers") })).toBeChecked();
    await expect(e.tableToolbar).toHaveCount(0);

    // The three save states, in order (10 §5.1): an edit is unsaved until the autosave answers.
    await e.title.fill("Release plan");
    await expect(e.saveState).toHaveText(t("editor.state.saving"));
    await expect(e.saveState).toHaveText(t("editor.state.saved"));

    await e.content.click();
    await setTextStyle(page, t("editor.style.heading", { level: 2 }));
    await page.keyboard.type("Scope");
    await page.keyboard.press("Enter");

    await page.keyboard.type("This is ");
    await pressToolbar(page, t("editor.bold"));
    await page.keyboard.type("bold");
    await pressToolbar(page, t("editor.bold"));
    await page.keyboard.type(" and ");
    await pressToolbar(page, t("editor.italic"));
    await page.keyboard.type("italic");
    await pressToolbar(page, t("editor.italic"));
    await page.keyboard.type(" text.");
    await page.keyboard.press("Enter");

    await pressToolbar(page, t("editor.bulletList"));
    await page.keyboard.type("First bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // an empty item leaves the list

    await pressToolbar(page, t("editor.orderedList"));
    await page.keyboard.type("Step one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Step two");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await pressToolbar(page, t("editor.taskList"));
    await page.keyboard.type("Write tests");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await page.keyboard.type("See ");
    await pressToolbar(page, t("editor.link"));
    const linkDialog = page.getByRole("dialog", { name: t("editor.linkDialog.title") });
    await linkDialog.getByRole("textbox", { name: t("editor.linkDialog.url") }).fill("https://example.com/spec");
    await linkDialog.getByRole("textbox", { name: t("editor.linkDialog.text") }).fill("the spec");
    await linkDialog.getByRole("button", { name: t("editor.linkDialog.submit") }).click();
    await expect(linkDialog).toHaveCount(0);
    await expect(e.content.getByRole("link", { name: "the spec" })).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");

    await setTextStyle(page, t("editor.style.preformatted"));
    await page.keyboard.type("npm run build");
    // Three Enters at the end of a code block leave it (TipTap's exitOnTripleEnter).
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await e.toolbar.getByRole("button", { name: t("editor.table") }).click();
    await page.getByRole("button", { name: t("editor.table.sizeLabel", { cols: 3, rows: 2 }) }).click();
    await expect(e.tableToolbar).toBeVisible(); // the caret is in the new table's first cell
    for (const [i, cell] of ["Key", "Description", "Owner", "BR-01", "Lorem ipsum", "Albert"].entries()) {
      if (i > 0) await page.keyboard.press("Tab");
      await page.keyboard.type(cell);
    }

    await expect(e.saveState).toHaveText(t("editor.state.saved"));
    await e.changeNote.fill("First full draft");
    await e.update.click();

    // Update publishes and returns to the page view (RD-055).
    await expect(page).toHaveURL(pageViewPattern(TEAM, id));
    await expectReleasePlan(page);
    const before = await renderedContent(page);

    await page.reload();
    await expectReleasePlan(page);
    expect(await renderedContent(page)).toBe(before);

    // Create made v. 1 (an empty Untitled page, RD-056); the Update made v. 2 with the note.
    const versions = await listVersionsViaApi(page.request, TEAM, id);
    expect(versions.map((v) => [v.number, v.title, v.message, v.current])).toEqual([
      [2, "Release plan", "First full draft", true],
      [1, t("page.untitled"), null, false],
    ]);
    const stored = await getPageViaApi(page.request, TEAM, id);
    expect(stored.page.hasDraft).toBe(false); // Update deleted the draft (RD-055)
  });

  test("Close keeps the draft: the view says so, and Edit resumes it with its content", async ({ page }) => {
    await signIn(page, "bob", "/spaces/TEAM");
    await page.getByRole("banner").getByRole("button", { name: t("shell.create") }).click();
    await page.waitForURL(EDIT_URL);
    const id = EDIT_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
    const e = editor(page);

    await e.title.fill("Meeting notes");
    await e.content.click();
    await page.keyboard.type("Unpublished words");
    await expect(e.saveState).toHaveText(t("editor.state.saved"));
    await e.close.click();

    await expect(page).toHaveURL(pageViewPattern(TEAM, id));
    // The view shows the published version (the empty Untitled page) and the notice (RD-080).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("page.untitled"));
    await expect(page.getByTestId("page-view").getByText("Unpublished words")).toHaveCount(0);
    const notice = page.getByText(t("pageView.draft.notice"));
    await expect(notice).toBeVisible();
    await expect(page.getByRole("link", { name: t("pageView.draft.continue") })).toHaveAttribute("href", editUrl(TEAM, id));
    await expect(page.getByRole("button", { name: t("pageView.draft.discard") })).toBeVisible();

    // The notice is the viewer's own: alice sees none on the same page.
    const alice = await page.context().browser()?.newContext({ viewport: { width: 1920, height: 1080 } });
    if (alice) {
      const other = await alice.newPage();
      await signIn(other, "alice", `/spaces/TEAM/pages/${id}`);
      await expect(other.getByRole("heading", { level: 1 })).toHaveText(t("page.untitled"));
      await expect(other.getByText(t("pageView.draft.notice"))).toHaveCount(0);
      await alice.close();
    }

    await page.getByRole("group", { name: t("pageView.actions") }).getByRole("link", { name: t("page.edit") }).click();
    await page.waitForURL(EDIT_URL);
    await expect(e.title).toHaveValue("Meeting notes");
    await expect(e.content).toHaveText("Unpublished words");
    // Resuming is not an edit.
    await expect(e.saveState).toHaveText(t("editor.state.ready"));
  });

  test("the table tools row is there only while the caret is in a table", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Table page" });
    await page.goto(editUrl(TEAM, created.id));
    const e = editor(page);
    await e.content.click();
    await page.keyboard.type("Above the table");
    await expect(e.tableToolbar).toHaveCount(0);

    await page.keyboard.press("Enter");
    await e.toolbar.getByRole("button", { name: t("editor.table") }).click();
    await page.getByRole("button", { name: t("editor.table.sizeLabel", { cols: 2, rows: 2 }) }).click();
    await expect(e.tableToolbar).toBeVisible();

    // Row 2 in the order 10 §5.1 draws it.
    const names = await e.tableToolbar.locator("button[aria-haspopup], button[aria-label], button[title]").evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute("aria-label") ?? b.getAttribute("title") ?? ""),
    );
    expect(names).toEqual([
      t("editor.table.widthMode"),
      t("editor.table.rowAbove"),
      t("editor.table.rowBelow"),
      t("editor.table.deleteRow"),
      t("editor.table.columnBefore"),
      t("editor.table.columnAfter"),
      t("editor.table.deleteColumn"),
      t("editor.table.merge"),
      t("editor.table.split"),
      t("editor.table.headerRow"),
      t("editor.table.headerColumn"),
      t("editor.table.numbered"),
      t("editor.table.fill"),
      t("editor.table.delete"),
    ]);
    await expect(e.tableToolbar.getByRole("button", { name: `${t("editor.table.widthMode")} ${t("editor.table.responsive")}` })).toBeVisible();

    // Leave the table: the row goes; come back: it returns.
    await e.content.getByText("Above the table").click();
    await expect(e.tableToolbar).toHaveCount(0);
    await e.content.getByRole("cell").first().click();
    await expect(e.tableToolbar).toBeVisible();
  });
});
