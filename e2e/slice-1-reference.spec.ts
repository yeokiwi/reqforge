// Reference-derived checks (RD-084): what the vendor screencast's frames show, asserted on the
// running application. The frames (test-results/gui-review/reference/, git-ignored, pulled from
// docs/research/ry-screencast.mp4 with ffmpeg; index in requirement-yogi-video.md §10a):
//   0:19 (ref-main-019) page view of the root page "Specifications": breadcrumb `Pages` alone, then
//        🔓 📎 ⛹, then right-aligned `✎ Edit · ☆ Save for later · ◉ Watching · ⇪ Share · ···`;
//        title; `Created by admin, last modified 6 minutes ago` under it.
//   1:46 (ref-main-146) page view of its child "Page Heading": breadcrumb `Pages / Specifications`.
//   0:46 (ref-main-046) editor of "Specifications": the global top bar (`Create`, `Spaces ▾`,
//        search, avatar) above the toolbar, NO space sidebar, breadcrumb `Team / Pages / Specifications`.
//   0:59 (ref-main-059) the `{` popup headed `Macro suggestions` in sentence case.
//   VB 3:50 (ref-vb-350) the `···` menu in three groups divided by separators.
//   VB 3:51 (ref-vb-351) Page History: every row's box empty, CURRENT's too; no box in the header.
// RD-084 supersedes RD-078's view-mode breadcrumb and RD-080's "no top bar" editor. Where these
// fail, the application still follows the superseded readings: the failure is the deliverable.
import type { Locator, Page } from "@playwright/test";
import { t } from "../src/copy";
import { DEMO, expect, signIn, test } from "./fixtures";
import { PNG_1PX, type PageDetail, TEAM, createTreeViaApi, editUrl, historyUrl, pageUrl, paragraphs, publishSeries, uploadViaApi, viewBreadcrumb } from "./pages";

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (b === null) throw new Error(`${String(locator)} is not on screen`);
  return b;
}

const editorBreadcrumb = (page: Page) => page.getByRole("navigation", { name: t("editor.breadcrumb") });

/** The accessible names of the buttons in `container`, in document order (from Playwright's ARIA snapshot). */
async function buttonNames(container: Locator): Promise<string[]> {
  const snapshot = await container.ariaSnapshot();
  return [...snapshot.matchAll(/- button "((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1] ?? ""}"`) as string);
}

/** `link` in tailwind.config.ts (#0B5BD3): the colour every link in the content is drawn in. */
const LINK_BLUE = "rgb(11, 91, 211)";

/** The video's own tree: Specifications > Page Heading > Subsection. */
async function videoTree(page: Page): Promise<Record<string, PageDetail>> {
  return createTreeViaApi(page.request, TEAM, [{ title: "Specifications", children: [{ title: "Page Heading", children: [{ title: "Subsection" }] }] }]);
}

const id = (pages: Record<string, PageDetail>, title: string): string => {
  const found = pages[title];
  if (!found) throw new Error(`no page ${title}`);
  return found.id;
};

test.describe("RD-084: the page view, as the frames show it", () => {
  test("a root page's breadcrumb is `Pages` alone — the page is not in its own trail (0:19)", async ({ page }) => {
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(pageUrl(TEAM, id(pages, "Specifications")));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Specifications");
    const crumbs = viewBreadcrumb(page);
    await expect(crumbs.getByRole("link", { name: t("sidebar.pages"), exact: true })).toHaveAttribute("href", "/spaces/TEAM");
    await expect(crumbs).toHaveText(t("sidebar.pages"));
    await expect(crumbs).not.toContainText("Specifications");
  });

  test("a child's breadcrumb is `Pages / <ancestors>`, links all, without its own title (1:46)", async ({ page }) => {
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(pageUrl(TEAM, id(pages, "Page Heading")));
    const crumbs = viewBreadcrumb(page);
    await expect(crumbs).toHaveText(/^Pages\s*\/\s*Specifications$/);
    await expect(crumbs.getByRole("link")).toHaveText([t("sidebar.pages"), "Specifications"]);
    await expect(crumbs.getByRole("link", { name: "Specifications" })).toHaveAttribute("href", pageUrl(TEAM, id(pages, "Specifications")));
    await expect(crumbs.locator('[aria-current="page"]')).toHaveCount(0);

    await page.goto(pageUrl(TEAM, id(pages, "Subsection")));
    await expect(viewBreadcrumb(page)).toHaveText(/^Pages\s*\/\s*Specifications\s*\/\s*Page Heading$/);
  });

  test("the header row: breadcrumb, the 🔓 📎 ⛹ icons right after it, and Edit · Save for later · Watching · Share · ··· on the right (0:19)", async ({ page }) => {
    await signIn(page, "bob");
    const pages = await videoTree(page);
    // 0:19 shows 📎 on a page that has attachments; 1:46 shows no 📎 on one that seems to have none.
    // Whether Reqforge hides 📎 without attachments is not decided (10 §4.1 lists it unconditionally),
    // so the page here has one and the three icons are expected either way.
    await uploadViaApi(page.request, TEAM, id(pages, "Page Heading"), { name: "diagram.png", mimeType: "image/png", buffer: PNG_1PX });
    await page.goto(pageUrl(TEAM, id(pages, "Page Heading")));
    const header = page.getByTestId("page-header");
    const crumbs = viewBreadcrumb(page);
    const icons = [t("restrictions.title"), t("pageMenu.attachments"), t("pageView.byline.requirements")].map((name) =>
      header.getByRole("button", { name, exact: true }),
    );
    const actions = page.getByRole("group", { name: t("pageView.actions") });
    const right = [
      actions.getByRole("link", { name: t("page.edit") }),
      actions.getByRole("button", { name: t("page.saveForLater") }),
      actions.getByRole("button", { name: t("page.watching") }),
      actions.getByRole("button", { name: t("page.share") }),
      actions.getByRole("button", { name: t("pageMenu.label") }),
    ];
    // Visible labels on the right, as drawn (the ··· is a glyph).
    await expect(actions.getByRole("link", { name: t("page.edit") })).toHaveText(t("page.edit"));
    for (const [i, label] of [t("page.saveForLater"), t("page.watching"), t("page.share")].entries()) await expect(right[i + 1] as Locator).toHaveText(label);

    // Document (and so Tab) order: breadcrumb, icons, actions.
    const names = await header.locator("a, button").evaluateAll((els) => els.map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()));
    const order = [
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
    ];
    expect(names.filter((name) => order.includes(name))).toEqual(order);

    // One row; the icons follow the breadcrumb closely; the actions sit at the far right, in order.
    const crumbBox = await box(crumbs);
    const iconBoxes = await Promise.all(icons.map(box));
    const rightBoxes = await Promise.all(right.map(box));
    const headerBox = await box(header);
    const middle = (b: { y: number; height: number }) => b.y + b.height / 2;
    for (const b of [...iconBoxes, ...rightBoxes]) expect(Math.abs(middle(b) - middle(crumbBox))).toBeLessThanOrEqual(8);
    const firstIcon = iconBoxes[0];
    const lastIcon = iconBoxes[2];
    const edit = rightBoxes[0];
    const dots = rightBoxes[4];
    if (!firstIcon || !lastIcon || !edit || !dots) throw new Error("unreachable");
    expect(firstIcon.x - (crumbBox.x + crumbBox.width)).toBeGreaterThanOrEqual(0);
    expect(firstIcon.x - (crumbBox.x + crumbBox.width)).toBeLessThanOrEqual(24);
    for (let i = 1; i < iconBoxes.length; i++) expect((iconBoxes[i]?.x ?? 0) > (iconBoxes[i - 1]?.x ?? 0)).toBe(true);
    for (let i = 1; i < rightBoxes.length; i++) expect((rightBoxes[i]?.x ?? 0) > (rightBoxes[i - 1]?.x ?? 0)).toBe(true);
    expect(Math.abs(headerBox.x + headerBox.width - (dots.x + dots.width))).toBeLessThanOrEqual(4);
    expect(edit.x - (lastIcon.x + lastIcon.width)).toBeGreaterThan(200); // a wide gap between the two clusters
  });

  test("the breadcrumb's crumbs are links drawn in link blue, in the view and in the editor (0:19, 1:46, 0:46)", async ({ page }) => {
    // Every frame draws `Pages`, the ancestors and the editor's `Team / Pages` in the blue of a link
    // (10 §0: colour roles are reproduced; 10 §1.1 "link blue").
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(pageUrl(TEAM, id(pages, "Page Heading")));
    for (const name of [t("sidebar.pages"), "Specifications"]) {
      await expect.soft(viewBreadcrumb(page).getByRole("link", { name, exact: true }), `view crumb ${name}`).toHaveCSS("color", LINK_BLUE);
    }
    await page.goto(editUrl(TEAM, id(pages, "Page Heading")));
    for (const name of ["Team", t("sidebar.pages"), "Specifications"]) {
      await expect.soft(editorBreadcrumb(page).getByRole("link", { name, exact: true }), `editor crumb ${name}`).toHaveCSS("color", LINK_BLUE);
    }
  });

  test("`Created by <name>, last modified <relative time>` sits under the title, left-aligned with it (0:19)", async ({ page }) => {
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(pageUrl(TEAM, id(pages, "Specifications")));
    const title = page.getByRole("heading", { level: 1 });
    const byline = page.getByTestId("page-byline");
    const sentence = t("page.byline", { author: DEMO.users.bob.name, relative: "@@" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(byline).toHaveText(new RegExp(`^${sentence.replace("@@", "(now|\\d+ seconds? ago|\\d+ minutes? ago)")}$`));
    // The relative time is a <time> with the absolute time on hover (10 §4.1).
    await expect(byline.locator("time")).toHaveAttribute("title", /^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}$/);
    const titleBox = await box(title);
    const bylineBox = await box(byline);
    expect(bylineBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
    expect(bylineBox.y - (titleBox.y + titleBox.height)).toBeLessThanOrEqual(16);
    expect(Math.abs(bylineBox.x - titleBox.x)).toBeLessThanOrEqual(2);
    // Nothing between them: the byline is the title's next sibling.
    await expect(title.locator("xpath=following-sibling::*[1]")).toHaveAttribute("data-testid", "page-byline");
  });
});

test.describe("what the other slice-1 frames show (RD-084: the frame wins unless a decision sanctions the difference)", () => {
  test("the ··· menu is drawn in three groups with separators: view · page · structure (VB 3:50)", async ({ page }) => {
    // VB 3:50 (ref-vb-350): Attachments … People who can view, Analytics | Page Information …
    // Requirement Yogi | Copy, Move, Delete. Analytics, Resolved comments, View Source, View
    // Storage Format, Export to PDF and Import Word Document are not v1 (10 §4.1), so the groups are:
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(pageUrl(TEAM, id(pages, "Specifications")));
    await page.getByRole("button", { name: t("pageMenu.label") }).click();
    const menu = page.getByRole("menu", { name: t("pageMenu.label") });
    await expect(menu).toBeVisible();
    const drawn = await menu
      .locator('[role="menuitem"], [role="separator"]')
      .evaluateAll((els) => els.map((el) => (el.getAttribute("role") === "separator" ? "|" : (el.textContent ?? "").trim())));
    expect(drawn).toEqual([
      t("pageMenu.attachments"),
      t("pageMenu.history"),
      t("pageMenu.restrictions"),
      t("pageMenu.peopleWhoCanView"),
      "|",
      t("pageMenu.info"),
      t("pageMenu.hierarchy"),
      t("pageMenu.exportWord"),
      t("pageMenu.reqforge"),
      "|",
      t("pageMenu.copy"),
      t("pageMenu.move"),
      t("pageMenu.delete"),
    ]);
  });

  test("Page History opens with every box unticked, CURRENT's included, and no header box (VB 3:51)", async ({ page }) => {
    // The frame (ref-vb-351; zoomed, the CURRENT row's box is the same empty ☐ as v. 233's) answers
    // the question RD-083 left open ("Revisit against videos-2 frame 3:46–3:54"): RD-083 read a `●`
    // there and ships CURRENT pre-ticked.
    await signIn(page, "bob");
    const pages = await videoTree(page);
    const specs = pages.Specifications;
    if (!specs) throw new Error("set-up failed");
    await publishSeries(page.request, TEAM, specs, [{ content: paragraphs("v2") }]);
    await page.goto(historyUrl(TEAM, specs.id));
    const table = page.getByRole("table", { name: t("history.table", { title: "Specifications" }) });
    await expect(table.getByRole("columnheader").first().getByRole("checkbox")).toHaveCount(0);
    await expect(table.getByRole("checkbox")).toHaveCount(2);
    await expect(table.getByRole("checkbox", { name: t("history.select", { n: 1 }) })).not.toBeChecked();
    await expect(table.getByRole("checkbox", { name: t("history.select", { n: 2 }) })).not.toBeChecked();
    await expect(page.getByRole("button", { name: t("history.compare") })).toHaveAccessibleDescription(t("history.compare.hint", { n: 0 }));
  });

  test("the { popup is headed `Macro suggestions` as written, not upper-cased (0:59)", async ({ page }) => {
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(editUrl(TEAM, id(pages, "Specifications")));
    await page.getByRole("textbox", { name: t("editor.content.label") }).click();
    await page.keyboard.type("{");
    const list = page.getByRole("listbox", { name: t("autocomplete.title") });
    await expect(list).toBeVisible();
    // The listbox is named by the heading; what a sighted user reads is its rendered text.
    const heading = page.getByTestId("macro-suggestions").getByText(t("autocomplete.title"), { exact: true });
    await expect(heading).toHaveText(t("autocomplete.title"), { useInnerText: true });
  });
});

test.describe("RD-084: the editor, as the 0:46 frame shows it", () => {
  test("the editor shows the global top bar — Create, Spaces ▾, search, avatar — above the toolbar, and no space sidebar", async ({ page }) => {
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(editUrl(TEAM, id(pages, "Specifications")));
    const toolbar = page.getByRole("toolbar", { name: t("editor.toolbar") });
    await expect(toolbar).toBeVisible();

    // No space sidebar: neither the expanded sidebar nor its icon rail.
    await expect(page.getByRole("complementary", { name: t("sidebar.nav") })).toHaveCount(0);

    // The global top bar (10 §2), as on every other screen.
    const bar = page.getByRole("banner");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: t("app.name") })).toBeVisible();
    await expect(bar.getByRole("button", { name: t("shell.spaces"), exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: t("shell.create"), exact: true })).toBeVisible();
    await expect(bar.getByRole("searchbox", { name: t("shell.search.label") })).toBeVisible();
    await expect(bar.getByRole("button", { name: t("shell.avatar") })).toBeVisible();
    const barBox = await box(bar);
    const toolbarBox = await box(toolbar);
    expect(barBox.y).toBeLessThanOrEqual(1);
    expect(toolbarBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  });

  test("toolbar row 1 is in the frames' order: the alignment group reads left, centre, right (0:46, 0:59)", async ({ page }) => {
    // Zoomed, the three alignment glyphs after ⇤ ⇥ are left-aligned, centred and right-aligned lines,
    // in that order (test-results/gui-review/reference/ref-main-059.png). RD-057 read them as left,
    // right, centre and said the mapping was a guess to revisit against the 0:46 frame.
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(editUrl(TEAM, id(pages, "Specifications")));
    const toolbar = page.getByRole("toolbar", { name: t("editor.toolbar") });
    await expect(toolbar).toBeVisible();
    const expected = [
      t("editor.style.label"),
      t("editor.bold"),
      t("editor.italic"),
      t("editor.underline"),
      t("editor.textColour"),
      t("editor.moreFormatting"),
      t("editor.bulletList"),
      t("editor.orderedList"),
      t("editor.taskList"),
      t("editor.outdent"),
      t("editor.indent"),
      t("editor.alignLeft"),
      t("editor.alignCentre"),
      t("editor.alignRight"),
      t("editor.infoPanel"),
      t("editor.files"),
      t("editor.link"),
      t("editor.table"),
      t("editor.emoji"),
      t("editor.insertMore"),
      t("editor.undo"),
      t("editor.redo"),
      t("editor.find"),
      t("editor.help"),
    ];
    // Dropdowns that show a value are named "label value" (RD-078): compare their label part.
    const names = (await buttonNames(toolbar)).map((name) => expected.find((label) => name === label || name.startsWith(`${label} `)) ?? name);
    expect(names).toEqual(expected);
  });

  test("the editor's breadcrumb is `<space> / Pages / <ancestors> / <title>` (0:46)", async ({ page }) => {
    await signIn(page, "bob");
    const pages = await videoTree(page);
    await page.goto(editUrl(TEAM, id(pages, "Specifications")));
    await expect(editorBreadcrumb(page)).toHaveText(/^Team\s*\/\s*Pages\s*\/\s*Specifications$/);
    await expect(editorBreadcrumb(page).getByRole("link")).toHaveText(["Team", t("sidebar.pages")]);

    await page.goto(editUrl(TEAM, id(pages, "Page Heading")));
    await expect(editorBreadcrumb(page)).toHaveText(/^Team\s*\/\s*Pages\s*\/\s*Specifications\s*\/\s*Page Heading$/);
    await expect(editorBreadcrumb(page).getByRole("link")).toHaveText(["Team", t("sidebar.pages"), "Specifications"]);
    // The breadcrumb, then the 🏷 and 🔓 icons, sit between the toolbar and the editable title.
    const crumbBox = await box(editorBreadcrumb(page));
    const titleBox = await box(page.getByRole("textbox", { name: t("editor.title.label") }));
    const toolbarBox = await box(page.getByRole("toolbar", { name: t("editor.toolbar") }));
    expect(crumbBox.y).toBeGreaterThan(toolbarBox.y);
    expect(titleBox.y).toBeGreaterThan(crumbBox.y);
    for (const name of [t("editor.labels"), t("restrictions.title")]) {
      const icon = await box(page.getByTestId("editor-header").getByRole("button", { name, exact: true }));
      expect(icon.x).toBeGreaterThan(crumbBox.x + crumbBox.width - 1);
      expect(Math.abs(icon.y + icon.height / 2 - (crumbBox.y + crumbBox.height / 2))).toBeLessThanOrEqual(8);
    }
  });
});
