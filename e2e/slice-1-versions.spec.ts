// Slice 1: every Update creates a version, and the version list renders past versions read-only
// (PLAN.md acceptance). Page History, restore, delete and compare: 10 §23, RD-060, RD-083.
import type { Page } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import {
  SAME_ORIGIN,
  TEAM,
  breadcrumbLinks,
  compareUrl,
  createPageViaApi,
  docOf,
  historyUrl,
  listVersionsViaApi,
  p,
  pageApi,
  pageUrl,
  pageViewPattern,
  paragraphs,
  publishSeries,
  viewBreadcrumb,
  withDatabase,
} from "./pages";

/** The window title starts with this; the root layout appends the product name. */
const startsWith = (title: string) => new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

function historyTable(page: Page, title: string) {
  return page.getByRole("table", { name: t("history.table", { title }) });
}

test.describe("versions: every Update is one", () => {
  test("three Updates with change notes are listed newest first, the notes in Comment", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Versioned page" });

    for (const n of [1, 2, 3]) {
      await page.goto(pageUrl(TEAM, created.id));
      await page.getByRole("group", { name: t("pageView.actions") }).getByRole("link", { name: t("page.edit") }).click();
      const content = page.getByRole("textbox", { name: t("editor.content.label") });
      await content.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(`Edit number ${n}. `);
      await page.getByRole("textbox", { name: t("editor.changeNote.placeholder") }).fill(`Change note ${n}`);
      await page.getByRole("button", { name: t("editor.update"), exact: true }).click();
      await expect(page).toHaveURL(pageViewPattern(TEAM, created.id));
      await expect(page.getByTestId("page-view")).toContainText(`Edit number ${n}.`);
    }

    // ··· → Page History (10 §4.1, §23).
    await page.getByRole("button", { name: t("pageMenu.label") }).click();
    await page.getByRole("menuitem", { name: t("pageMenu.history") }).click();
    await expect(page).toHaveURL(historyUrl(TEAM, created.id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("history.title"));
    await expect(page.getByText(t("history.intro"))).toBeVisible();
    await expect(page).toHaveTitle(startsWith(t("history.windowTitle", { title: "Versioned page" })));

    const table = historyTable(page, "Versioned page");
    await expect(table.getByRole("columnheader")).toHaveText([
      t("history.col.select"),
      t("history.col.version"),
      t("history.col.published"),
      t("history.col.changedBy"),
      t("history.col.comment"),
      t("history.col.actions"),
    ]);
    // Create made v. 1 (RD-056); the three Updates made v. 2 to v. 4.
    await expect(table.getByRole("rowheader")).toHaveText([
      t("history.current", { n: 4 }),
      t("history.version", { n: 3 }),
      t("history.version", { n: 2 }),
      t("history.version", { n: 1 }),
    ]);
    const rows = table.getByRole("row");
    await expect(rows.nth(1).getByRole("cell").nth(3)).toHaveText("Change note 3");
    await expect(rows.nth(2).getByRole("cell").nth(3)).toHaveText("Change note 2");
    await expect(rows.nth(3).getByRole("cell").nth(3)).toHaveText("Change note 1");
    await expect(rows.nth(4).getByRole("cell").nth(3)).toHaveText("");
    for (const i of [1, 2, 3, 4]) await expect(rows.nth(i).getByRole("cell").nth(2)).toHaveText(DEMO_BOB);

    // Every row has its box (whether CURRENT's starts ticked is RD-083 against the VB 3:51 frame:
    // slice-1-reference.spec.ts pins the frame); a past version's starts unticked; CURRENT has no actions.
    await expect(table.getByRole("checkbox")).toHaveCount(4);
    await expect(table.getByRole("checkbox", { name: t("history.select", { n: 3 }) })).not.toBeChecked();
    await expect(rows.nth(1).getByRole("button")).toHaveCount(0);
    await expect(table.getByRole("button", { name: t("history.restore.label", { n: 3 }) })).toBeVisible();
  });

  test("?version=N shows that version read-only under a banner, with no Edit", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "First title" });
    await publishSeries(page.request, TEAM, created, [
      { content: paragraphs("First text"), message: "first words" },
      { title: "Second title", content: paragraphs("Second text"), message: "second words" },
    ]);

    await page.goto(`${pageUrl(TEAM, created.id)}?version=2`);
    const banner = page.getByRole("status").filter({ hasText: t("pageView.version.banner", { n: 2 }) });
    await expect(banner).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("First title");
    await expect(page.getByTestId("page-view").getByText("First text")).toBeVisible();
    await expect(page.getByTestId("page-view").getByText("Second text")).toHaveCount(0);
    // The breadcrumb is the page's place, not the version's: `Pages` for a root page, and the past
    // title is nowhere in it (RD-080, RD-084; the exact trail is asserted in slice-1-reference.spec.ts).
    expect(await breadcrumbLinks(page)).toEqual([t("sidebar.pages")]);
    await expect(viewBreadcrumb(page)).not.toContainText("First title");
    await expect(page.getByRole("link", { name: t("page.edit") })).toHaveCount(0);
    await expect(page).toHaveTitle(/First title/);

    // `E` does not open the editor on a past version.
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("e");
    await expect(page).toHaveURL(/\?version=2$/);
    await expect(page.getByRole("textbox", { name: t("editor.content.label") })).toHaveCount(0);

    await banner.getByRole("link", { name: t("pageView.version.current") }).click();
    await expect(page).toHaveURL(pageViewPattern(TEAM, created.id));
    await expect(page).not.toHaveURL(/version=/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second title");
    await expect(page.getByRole("link", { name: t("page.edit") })).toBeVisible();
    await expect(page.getByText(t("pageView.version.banner", { n: 2 }))).toHaveCount(0);

    // The history's version links open the read-only view.
    await page.goto(historyUrl(TEAM, created.id));
    await historyTable(page, "Second title").getByRole("link", { name: t("history.version", { n: 1 }), exact: true }).click();
    await expect(page).toHaveURL(/\?version=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("First title");

    // ?version= the current number is the current view; unknown and malformed numbers are not found.
    await page.goto(`${pageUrl(TEAM, created.id)}?version=3`);
    await expect(page.getByRole("link", { name: t("page.edit") })).toBeVisible();
    await expect(page.getByText(t("pageView.version.banner", { n: 3 }))).toHaveCount(0);
    for (const bad of ["99", "0", "-1", "1.5", "01", "abc"]) {
      // The not-found screen (RD-080). Its HTTP status is asserted once, for every page route, in
      // slice-1-permissions.spec.ts ("… answers HTTP 404").
      await page.goto(`${pageUrl(TEAM, created.id)}?version=${bad}`);
      await expect(page.getByText(t("error.notFound")), `?version=${bad}`).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    }
  });

  test("Restore v. 2 publishes it again as v. 4, noted 'Restored from v. 2'", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Restore me" });
    // v. 1 is the empty page; give v. 2 and v. 3 their own content, then restore v. 2.
    await publishSeries(page.request, TEAM, created, [
      { content: paragraphs("Original text"), message: "original" },
      { content: paragraphs("Rewritten text"), message: "rewrite", title: "Renamed page" },
    ]);

    await page.goto(historyUrl(TEAM, created.id));
    await page.getByRole("button", { name: t("history.restore.label", { n: 2 }) }).click();
    const dialog = page.getByRole("dialog", { name: t("history.restore.title", { n: 2 }) });
    await expect(dialog).toContainText(t("history.restore.body", { n: 2 }));
    await expect(dialog.getByRole("button", { name: t("history.cancel") })).toBeFocused(); // the safe answer
    await dialog.getByRole("button", { name: t("history.restore"), exact: true }).click();

    await expect(page).toHaveURL(pageViewPattern(TEAM, created.id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Restore me");
    await expect(page.getByTestId("page-view").getByText("Original text")).toBeVisible();

    const versions = await listVersionsViaApi(page.request, TEAM, created.id);
    expect(versions.map((v) => [v.number, v.title, v.message, v.current])).toEqual([
      [4, "Restore me", t("history.restoredNote", { n: 2 }), true],
      [3, "Renamed page", "rewrite", false],
      [2, "Restore me", "original", false],
      [1, "Restore me", null, false],
    ]);
    await page.goto(historyUrl(TEAM, created.id));
    await expect(historyTable(page, "Restore me").getByRole("row").nth(1)).toContainText(t("history.restoredNote", { n: 2 }));
  });

  test("only a space admin may delete a past version; the current one is never deletable", async ({ page, browser }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Deletable" });
    await publishSeries(page.request, TEAM, created, [{ content: paragraphs("two") }, { content: paragraphs("three") }]);

    // bob has EDIT, not ADMIN: Restore yes, Delete hidden (RD-083), and the API refuses him.
    await page.goto(historyUrl(TEAM, created.id));
    const bobTable = historyTable(page, "Deletable");
    await expect(bobTable.getByRole("button", { name: t("history.restore.label", { n: 2 }) })).toBeVisible();
    await expect(bobTable.getByRole("button", { name: /^Delete v\./ })).toHaveCount(0);
    const refused = await page.request.delete(`${pageApi(TEAM, created.id)}/versions/2`, { headers: SAME_ORIGIN });
    expect(refused.status()).toBe(403);
    expect((await refused.json()) as { code: string }).toMatchObject({ code: "FORBIDDEN" });

    const admin = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const alice = await admin.newPage();
    await signIn(alice, "alice", historyUrl(TEAM, created.id));
    const table = historyTable(alice, "Deletable");
    await expect(table.getByRole("button", { name: t("history.delete.label", { n: 3 }) })).toHaveCount(0); // current
    await table.getByRole("button", { name: t("history.delete.label", { n: 2 }) }).click();
    const dialog = alice.getByRole("dialog", { name: t("history.delete.title", { n: 2 }) });
    await expect(dialog).toContainText(t("history.delete.body", { n: 2 }));
    await dialog.getByRole("button", { name: t("history.delete"), exact: true }).click();

    await expect(alice.getByRole("status").filter({ hasText: t("history.deleted", { n: 2 }) })).toBeVisible();
    await expect(table.getByRole("rowheader")).toHaveText([t("history.current", { n: 3 }), t("history.version", { n: 1 })]);
    await expect(alice.getByTestId("history-notice")).toBeFocused(); // focus kept on the message (RD-083)

    const current = await alice.request.delete(`${pageApi(TEAM, created.id)}/versions/3`, { headers: SAME_ORIGIN });
    expect(current.status()).toBe(409);
    expect((await current.json()) as { code: string }).toMatchObject({ code: "CURRENT_VERSION" });
    await admin.close();
  });

  test("a version pinned by a baseline shows Delete disabled with the reason, and cannot be deleted", async ({ page }) => {
    await signIn(page, "alice");
    const created = await createPageViaApi(page.request, TEAM, { title: "Pinned page" });
    await publishSeries(page.request, TEAM, created, [{ content: paragraphs("two") }]);
    // What a baseline freeze does to a version (05 §3.2, slice 13): only `pinned` may change.
    await withDatabase((prisma) => prisma.documentVersion.updateMany({ where: { documentId: created.id, number: 1 }, data: { pinned: true } }));

    await page.goto(historyUrl(TEAM, created.id));
    const del = historyTable(page, "Pinned page").getByRole("button", { name: t("history.delete.label", { n: 1 }) });
    await expect(del).toHaveAttribute("aria-disabled", "true");
    await expect(del).toHaveAttribute("title", t("history.pinned.unknown"));
    await expect(del).toHaveAccessibleDescription(t("history.pinned.unknown"));
    await del.click({ force: true }); // aria-disabled stays focusable and clickable (RD-078); it must do nothing
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const refused = await page.request.delete(`${pageApi(TEAM, created.id)}/versions/1`, { headers: SAME_ORIGIN });
    expect(refused.status()).toBe(409);
    expect((await refused.json()) as { code: string }).toMatchObject({ code: "PINNED_VERSION" });
  });

  test("Compare shows added, removed and changed blocks, each labelled in words", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Compared page" });
    await publishSeries(page.request, TEAM, created, [
      { content: docOf(p("Intro"), p("Beta"), p("Middle"), p("Removed one"), p("Removed two"), p("End")), message: "before" },
      { content: docOf(p("Intro"), p("Beta changed"), p("Middle"), p("Replacement"), p("End"), p("Added at end")), message: "after" },
    ]);

    await page.goto(historyUrl(TEAM, created.id));
    const compare = page.getByRole("button", { name: t("history.compare") });
    // Exactly two, no fewer and no more (RD-083). Start from none ticked, whatever the first state.
    await page.getByRole("checkbox", { name: t("history.select", { n: 3 }) }).uncheck();
    await expect(compare).toHaveAttribute("aria-disabled", "true");
    await expect(compare).toHaveAccessibleDescription(t("history.compare.hint", { n: 0 }));
    await page.getByRole("checkbox", { name: t("history.select", { n: 2 }) }).check();
    await expect(compare).toHaveAttribute("aria-disabled", "true");
    await expect(compare).toHaveAccessibleDescription(t("history.compare.hint", { n: 1 }));
    await compare.click({ force: true }); // aria-disabled stays focusable and clickable (RD-078); it must do nothing
    await expect(page).toHaveURL(historyUrl(TEAM, created.id));
    await page.getByRole("checkbox", { name: t("history.select", { n: 1 }) }).check();
    await expect(compare).toHaveAccessibleDescription(t("history.compare.ready", { a: 1, b: 2 }));
    await page.getByRole("checkbox", { name: t("history.select", { n: 3 }) }).check();
    await expect(compare).toHaveAttribute("aria-disabled", "true");
    await expect(compare).toHaveAccessibleDescription(t("history.compare.hint", { n: 3 }));
    await page.getByRole("checkbox", { name: t("history.select", { n: 1 }) }).uncheck();
    await expect(compare).not.toHaveAttribute("aria-disabled", "true");
    await expect(compare).toHaveAccessibleDescription(t("history.compare.ready", { a: 2, b: 3 }));
    await compare.click();

    await expect(page).toHaveURL(compareUrl(TEAM, created.id, 2, 3));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("compare.title", { a: 2, b: 3 }));
    await expect(page).toHaveTitle(startsWith(t("compare.windowTitle", { a: 2, b: 3, title: "Compared page" })));
    await expect(page.getByText(t("compare.summary", { added: 1, removed: 1, changed: 2 }))).toBeVisible();
    await expect(page.getByText(t("compare.titleChanged"))).toHaveCount(0);

    const table = page.getByRole("table", { name: t("compare.table", { a: 2, b: 3 }) });
    const rows = table.getByRole("rowgroup").nth(1).getByRole("row");
    await expect(rows).toHaveCount(7);
    const row = (hasText: string) => rows.filter({ hasText });
    // Every status carries a word as well as a colour (RD-083); unchanged rows say so to screen readers.
    await expect(row("Intro")).toContainText(t("compare.status.same"));
    await expect(row("Beta changed")).toContainText("Beta");
    await expect(row("Beta changed").getByText(t("compare.status.changed"), { exact: true })).toHaveCount(2);
    await expect(row("Replacement")).toContainText("Removed one");
    await expect(row("Replacement").getByText(t("compare.status.changed"), { exact: true })).toHaveCount(2);
    await expect(row("Removed two").getByText(t("compare.status.removed"), { exact: true })).toBeVisible();
    await expect(row("Removed two")).toContainText(t("compare.missing", { n: 3 }));
    await expect(row("Added at end").getByText(t("compare.status.added"), { exact: true })).toBeVisible();
    await expect(row("Added at end")).toContainText(t("compare.missing", { n: 2 }));

    await page.getByRole("link", { name: t("compare.back") }).click();
    await expect(page).toHaveURL(historyUrl(TEAM, created.id));

    // A hand-typed pair that is equal, or names no version, is the not-found screen (RD-083).
    for (const [a, b] of [
      [2, 2],
      [2, 9],
    ] as const) {
      await page.goto(compareUrl(TEAM, created.id, a, b));
      await expect(page.getByText(t("error.notFound")), `a=${a}&b=${b}`).toBeVisible();
    }
  });
});

const DEMO_BOB = "Bob Editor";
