// The page view's `···` menu and its dialogs (10 §4.1; RD-056, RD-058, RD-059, RD-061, RD-074,
// RD-080, RD-081), and the header's toggles and Share.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { t } from "../src/copy";
import { DEMO, expect, signIn, test } from "./fixtures";
import {
  BASE_URL,
  PNG_1PX,
  TEAM,
  createPageViaApi,
  createTreeViaApi,
  getPageViaApi,
  historyUrl,
  listPagesViaApi,
  pageApi,
  pageUrl,
  pageViewPattern,
  paragraphs,
  publishSeries,
  sha256,
  signedInContext,
} from "./pages";

const actions = (page: Page) => page.getByRole("group", { name: t("pageView.actions") });

async function openMenu(page: Page) {
  await page.getByRole("button", { name: t("pageMenu.label") }).click();
  const menu = page.getByRole("menu", { name: t("pageMenu.label") });
  await expect(menu).toBeVisible();
  return menu;
}

async function openDialogFromMenu(page: Page, item: string, dialogName: string) {
  const menu = await openMenu(page);
  await menu.getByRole("menuitem", { name: item, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  return dialog;
}

const MENU_ORDER = [
  t("pageMenu.attachments"),
  t("pageMenu.history"),
  t("pageMenu.restrictions"),
  t("pageMenu.peopleWhoCanView"),
  t("pageMenu.info"),
  t("pageMenu.hierarchy"),
  t("pageMenu.exportWord"),
  t("pageMenu.reqforge"),
  t("pageMenu.copy"),
  t("pageMenu.move"),
  t("pageMenu.delete"),
];
const INERT = [t("pageMenu.restrictions"), t("pageMenu.peopleWhoCanView"), t("pageMenu.exportWord"), t("pageMenu.reqforge")];

test.describe("the ··· menu", () => {
  test("lists the items in the video's order; the ones not built yet are drawn inert and skipped", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Menu page" });
    await page.goto(pageUrl(TEAM, created.id));
    const trigger = page.getByRole("button", { name: t("pageMenu.label") });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    const menu = await openMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveText(MENU_ORDER);
    for (const name of INERT) {
      const entry = menu.getByRole("menuitem", { name, exact: true });
      await expect(entry).toHaveAttribute("aria-disabled", "true");
      await expect(entry).toHaveAttribute("title", t("shell.later"));
    }
    await expect(menu.getByRole("menuitem", { name: t("pageMenu.history") })).toHaveAttribute("href", historyUrl(TEAM, created.id));
    await expect(menu.getByRole("menuitem", { name: t("pageMenu.hierarchy") })).toHaveAttribute("href", `/spaces/TEAM?highlight=${created.id}`);
    // Not built: View Storage Format (10 §4.1).
    await expect(menu.getByText(/storage format/i)).toHaveCount(0);

    // The trigger toggles it shut; the arrows open it and skip the inert items. (Enter, Space and
    // Escape are checked in the keyboard-only pass, slice-1-a11y.spec.ts.)
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const focusedNames: string[] = [];
    for (let i = 0; i < 8; i++) {
      focusedNames.push((await page.evaluate(() => document.activeElement?.textContent ?? "")).trim());
      await page.keyboard.press("ArrowDown");
    }
    expect(focusedNames).toEqual([
      t("pageMenu.attachments"),
      t("pageMenu.history"),
      t("pageMenu.info"),
      t("pageMenu.hierarchy"),
      t("pageMenu.copy"),
      t("pageMenu.move"),
      t("pageMenu.delete"),
      t("pageMenu.attachments"), // wraps
    ]);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  test("Copy makes “Copy of <title>” of this page only, last among its siblings, and opens it", async ({ page }) => {
    await signIn(page, "bob");
    const tree = await createTreeViaApi(page.request, TEAM, [
      { title: "Parent", children: [{ title: "Spec", children: [{ title: "Spec child" }] }, { title: "Sibling" }] },
    ]);
    const spec = tree.Spec;
    if (!spec) throw new Error("set-up failed");
    await publishSeries(page.request, TEAM, spec, [{ content: paragraphs("Spec body text"), message: "body" }]);

    await page.goto(pageUrl(TEAM, spec.id));
    const dialog = await openDialogFromMenu(page, t("pageMenu.copy"), t("pageCopy.title", { title: "Spec" }));
    await expect(dialog).toHaveAccessibleDescription(t("pageCopy.body"));
    const field = dialog.getByRole("textbox", { name: t("pageCopy.field") });
    await expect(field).toHaveValue(t("page.copyOf", { title: "Spec" }));
    await expect(field).toBeFocused();

    // A title another page has is refused under the field, not silently renamed (RD-081).
    await field.fill("Sibling");
    await dialog.getByRole("button", { name: t("pageCopy.submit"), exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(t("pageCopy.field.taken"));
    await expect(field).toHaveAttribute("aria-invalid", "true");

    await field.fill(t("page.copyOf", { title: "Spec" }));
    await dialog.getByRole("button", { name: t("pageCopy.submit"), exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Copy of Spec");
    await expect(page.getByTestId("page-view").getByText("Spec body text")).toBeVisible();
    await expect(page.getByRole("navigation", { name: t("pageView.breadcrumb") })).toHaveText(/Pages\s*\/\s*Parent\s*\/\s*Copy of Spec/);

    const pages = await listPagesViaApi(page.request, TEAM);
    const copy = pages.find((p) => p.title === "Copy of Spec");
    expect(copy).toMatchObject({ parentId: tree.Parent?.id, ordinal: 2 });
    expect(pages.filter((p) => p.parentId === copy?.id)).toEqual([]); // not its child pages
    await expect(page).toHaveURL(pageViewPattern(TEAM, copy?.id ?? ""));

    // A second copy is offered the next free title (RD-067).
    await page.goto(pageUrl(TEAM, spec.id));
    const again = await openDialogFromMenu(page, t("pageMenu.copy"), t("pageCopy.title", { title: "Spec" }));
    await expect(again.getByRole("textbox", { name: t("pageCopy.field") })).toHaveValue(`${t("page.copyOf", { title: "Spec" })} 2`);
    await again.getByRole("button", { name: t("pageView.dialog.cancel") }).click();
    await expect(again).toHaveCount(0);
    await expect(page.getByRole("button", { name: t("pageMenu.label") })).toBeFocused();
  });

  test("Move offers every place but the page and its descendants, and moves it there", async ({ page }) => {
    await signIn(page, "bob");
    const tree = await createTreeViaApi(page.request, TEAM, [
      { title: "Parent", children: [{ title: "Child", children: [{ title: "Grandchild" }] }] },
      { title: "Other" },
    ]);
    await page.goto(pageUrl(TEAM, tree.Parent?.id ?? ""));
    const dialog = await openDialogFromMenu(page, t("pageMenu.move"), t("pageMove.title", { title: "Parent" }));
    await expect(dialog).toHaveAccessibleDescription(t("pageMove.body", { space: "Team" }));
    const list = dialog.getByRole("listbox", { name: t("pageMove.list") });
    await expect(list.getByRole("option")).toHaveText([`${t("pageMove.root")}${t("pageMove.currentTag")}`, "Other"]);
    await expect(list.getByRole("option", { name: new RegExp(`^${t("pageMove.root")}`) })).toHaveAttribute("aria-selected", "true");
    const submit = dialog.getByRole("button", { name: t("pageMove.submit"), exact: true });
    await expect(submit).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByText(t("pageMove.choice.same"))).toBeVisible();

    // The filter cannot find the page's own descendants either.
    await dialog.getByRole("searchbox", { name: t("pageMove.filter") }).fill("Grand");
    await expect(dialog.getByText(t("pageMove.none", { q: "Grand" }))).toBeVisible();
    await dialog.getByRole("searchbox", { name: t("pageMove.filter") }).fill("");

    await list.getByRole("option", { name: "Other" }).click();
    await expect(dialog.getByText(t("pageMove.choice.under", { parent: "Other" }))).toBeVisible();
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: t("pageView.breadcrumb") })).toHaveText(/Pages\s*\/\s*Other\s*\/\s*Parent/);

    const pages = await listPagesViaApi(page.request, TEAM);
    const parentOf = (title: string) => pages.find((p) => p.id === pages.find((q) => q.title === title)?.parentId)?.title ?? "(root)";
    expect([parentOf("Parent"), parentOf("Child"), parentOf("Grandchild")]).toEqual(["Other", "Parent", "Child"]);
  });

  test("Delete says how many pages go, removes the subtree and lands on the overview", async ({ page }) => {
    await signIn(page, "bob");
    const tree = await createTreeViaApi(page.request, TEAM, [
      { title: "Doomed", children: [{ title: "Doomed child", children: [{ title: "Doomed grandchild" }] }] },
      { title: "Leaf" },
      { title: "One child", children: [{ title: "The child" }] },
      { title: "Survivor" },
    ]);

    // The sentence follows the count (RD-056): a leaf, one child, several.
    for (const [title, body] of [
      ["Leaf", t("pageDelete.body.leaf")],
      ["One child", t("pageDelete.body.oneChild")],
    ] as const) {
      await page.goto(pageUrl(TEAM, tree[title]?.id ?? ""));
      const dialog = await openDialogFromMenu(page, t("pageMenu.delete"), t("pageDelete.title", { title }));
      await expect(dialog).toContainText(body);
      await dialog.getByRole("button", { name: t("pageView.dialog.cancel") }).click();
    }

    await page.goto("/spaces/TEAM");
    await page.getByRole("tree", { name: t("overview.tree", { space: "Team" }) }).getByRole("link", { name: "Doomed", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Doomed");
    const dialog = await openDialogFromMenu(page, t("pageMenu.delete"), t("pageDelete.title", { title: "Doomed" }));
    await expect(dialog).toContainText(t("pageDelete.body.children", { d: 2, n: 3 }));
    await expect(dialog.getByRole("button", { name: t("pageView.dialog.cancel") })).toBeFocused(); // the safe answer
    await dialog.getByRole("button", { name: t("pageDelete.confirm"), exact: true }).click();

    await expect(page).toHaveURL(/\/spaces\/TEAM$/);
    const overview = page.getByRole("tree", { name: t("overview.tree", { space: "Team" }) });
    await expect(overview.getByRole("treeitem", { name: "Survivor" })).toBeVisible();
    await expect(overview.getByRole("treeitem", { name: /^Doomed/ })).toHaveCount(0);
    const titles = (await listPagesViaApi(page.request, TEAM)).map((p) => p.title);
    expect(titles.filter((title) => title.startsWith("Doomed"))).toEqual([]);
    const gone = await page.request.get(pageApi(TEAM, tree.Doomed?.id ?? ""));
    expect(gone.status()).toBe(404);

    // The deleted page's history entry was replaced: Back does not land on a not-found screen (RD-081).
    await page.goBack();
    await expect(page.getByText(t("error.notFound"))).toHaveCount(0);
    await page.goto(pageUrl(TEAM, tree["Doomed child"]?.id ?? ""));
    await expect(page.getByText(t("error.notFound"))).toBeVisible();
  });

  test("Page information shows what the API says about the page, read-only", async ({ page, browser }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Info page" });
    const { context, page: alice } = await signedInContext(browser, "alice");
    await publishSeries(alice.request, TEAM, created, [{ content: paragraphs("alice was here") }]);
    await context.close();

    await page.goto(pageUrl(TEAM, created.id));
    const dialog = await openDialogFromMenu(page, t("pageMenu.info"), t("pageInfo.title"));
    const value = (label: string) => dialog.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
    await expect(value(t("pageInfo.pageTitle"))).toHaveText("Info page");
    await expect(value(t("pageInfo.id"))).toHaveText(created.id);
    await expect(value(t("pageInfo.space"))).toHaveText(t("pageInfo.spaceValue", { name: "Team", key: "TEAM" }));
    await expect(value(t("pageInfo.createdBy"))).toHaveText(DEMO.users.bob.name);
    await expect(value(t("pageInfo.lastModifiedBy"))).toHaveText(DEMO.users.alice.name);
    await expect(value(t("pageInfo.version")).getByRole("link", { name: t("pageInfo.versionValue", { n: 2 }) })).toHaveAttribute(
      "href",
      historyUrl(TEAM, created.id),
    );
    await expect(value(t("pageInfo.watching"))).toHaveText(t("pageInfo.watching.yes")); // the creator watches (RD-061)
    await expect(dialog.getByRole("textbox")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: t("pageMenu.label") })).toBeFocused();
  });

  test("Attachments: upload a PNG, see it listed, download the same bytes, hide it", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Files page" });
    await page.goto(pageUrl(TEAM, created.id));

    // The 📎 byline icon and ··· → Attachments open the same dialog.
    await page.getByRole("button", { name: t("pageMenu.attachments") }).click();
    const dialog = page.getByRole("dialog", { name: t("pageAttachments.title") });
    await expect(dialog.getByText(t("pageAttachments.empty"))).toBeVisible();
    await expect(dialog.getByText(t("pageAttachments.upload.help", { mib: "10" }))).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: t("pageAttachments.upload") }).click();
    await (await chooser).setFiles({ name: "pixel.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect(dialog.getByRole("status").filter({ hasText: t("pageAttachments.uploaded", { name: "pixel.png" }) })).toBeVisible();

    const table = dialog.getByRole("table", { name: t("pageAttachments.table", { title: "Files page" }) });
    const rowOf = table.getByRole("row").filter({ hasText: "pixel.png" });
    await expect(rowOf).toContainText(t("pageAttachments.size.bytes", { n: PNG_1PX.length }));
    await expect(rowOf).toContainText(DEMO.users.bob.name);
    const thumbnail = rowOf.locator("img"); // decorative (alt=""), so not in the accessibility tree
    await expect.poll(() => thumbnail.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1);

    const download = page.waitForEvent("download");
    await rowOf.getByRole("link", { name: "pixel.png" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("pixel.png");
    expect(sha256(readFileSync(await file.path()))).toBe(sha256(PNG_1PX));
    const url = await rowOf.getByRole("link", { name: "pixel.png" }).getAttribute("href");

    await rowOf.getByRole("button", { name: t("pageAttachments.hide.label", { name: "pixel.png" }) }).click();
    const confirm = page.getByRole("dialog", { name: t("pageAttachments.hide.title", { name: "pixel.png" }) });
    await expect(confirm).toContainText(t("pageAttachments.hide.body"));
    await confirm.getByRole("button", { name: t("pageAttachments.hide"), exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: t("pageAttachments.hidden", { name: "pixel.png" }) })).toBeVisible();
    await expect(dialog.getByText(t("pageAttachments.empty"))).toBeVisible();
    await expect(dialog.getByRole("button", { name: t("pageAttachments.upload") })).toBeFocused();

    // Hiding keeps the bytes: old versions still render it (RD-058, RD-070).
    const bytes = await page.request.get(url ?? "");
    expect(bytes.status()).toBe(200);
    expect(sha256(await bytes.body())).toBe(sha256(PNG_1PX));
  });
});

test.describe("the page header's toggles and Share", () => {
  test("Save for later and Watching change at once and persist across a reload", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Toggle page" });
    await page.goto(pageUrl(TEAM, created.id));
    const save = actions(page).getByRole("button", { name: t("page.saveForLater") });
    const watch = actions(page).getByRole("button", { name: t("page.watching") });
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await expect(watch).toHaveAttribute("aria-pressed", "true"); // on by default for the author (10 §4.1)

    await save.click();
    await watch.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await expect(watch).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await getPageViaApi(page.request, TEAM, created.id)).page).toMatchObject({ favourite: true, watching: false });

    await page.reload();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await expect(watch).toHaveAttribute("aria-pressed", "false");

    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await getPageViaApi(page.request, TEAM, created.id)).page.favourite).toBe(false);
    await page.reload();
    await expect(save).toHaveAttribute("aria-pressed", "false");
  });

  test("Share copies the page's own address and says so", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Shared link" });
    await publishSeries(page.request, TEAM, created, [{ content: paragraphs("v2") }]);

    // Even from a past version, Share copies the page itself, never ?version=N (RD-080).
    await page.goto(`${pageUrl(TEAM, created.id)}?version=1`);
    await actions(page).getByRole("button", { name: t("page.share") }).click();
    await expect(page.getByRole("status").filter({ hasText: t("pageShare.copied") })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${BASE_URL}${pageUrl(TEAM, created.id)}`);
  });
});
