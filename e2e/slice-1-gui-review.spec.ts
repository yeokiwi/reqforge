// GUI review artefact for slice 1 (PLAN.md: "pass the side-by-side review against the 0:18 and
// 0:46 reference frames"; RD-031, RD-084). Saves 1920×1080 screenshots of every slice-1 screen to
// test-results/gui-review/slice-1/NN-<screen>.png and, after the run, writes INDEX.md listing each
// file, what it shows and the reference frame to compare it with. When the git-ignored screencasts
// are present (docs/research/*.mp4) and ffmpeg is installed, the reference frames are extracted to
// test-results/gui-review/reference/ and a side-by-side composite (ours | the frame's application
// window) is written to slice-1/side-by-side/. Playwright empties test-results/ at the start of
// every run, which is why the frames are re-extracted here rather than kept there.
// A human signs the review off; nothing here diffs pixels against a different product.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import {
  GUI_REVIEW_DIR,
  PNG_1PX,
  SAME_ORIGIN,
  TEAM,
  compareUrl,
  createPageViaApi,
  createTreeViaApi,
  docOf,
  editUrl,
  historyUrl,
  overviewTree,
  p,
  pageApi,
  pageUrl,
  paragraphs,
  publishSeries,
  shoot,
  signedInContext,
  specificationsDoc,
  treeItem,
  uploadViaApi,
} from "./pages";

// ------------------------------------------------------------------------- the frame index

type Video = "main" | "vb";
const VIDEO_FILE: Record<Video, string> = {
  main: "docs/research/ry-screencast.mp4",
  vb: "docs/research/How to create baselines and compare requirement versions - Confluence Data Center - Requirement Yogi (1080p).mp4",
};
/** The application window inside each recording (the rest is the vendor's title card). */
const APP_WINDOW: Record<Video, string> = { main: "crop=838:676:394:14", vb: "crop=1220:984:630:48" };
const REFERENCE_DIR = "test-results/gui-review/reference";

interface Shot {
  readonly file: string;
  readonly shows: string;
  /** The reference frame: recording and time (requirement-yogi-video.md §10a, videos-2 §6). */
  readonly ref?: { readonly video: Video; readonly at: string; readonly note?: string };
  /** An element screenshot (no composite is made). */
  readonly element?: boolean;
}

const SHOTS: readonly Shot[] = [
  { file: "01-sidebar-expanded-tree.png", shows: "Page view of the child page Page Heading with the space sidebar expanded: PAGE TREE with Specifications open, Page Heading bold, Test session 1a closed with a child, Team notes.", ref: { video: "main", at: "1:46" } },
  { file: "02-sidebar-collapsed-rail.png", shows: "Page view of the root page Specifications with the sidebar collapsed to the icon rail.", ref: { video: "main", at: "0:19" } },
  { file: "03-overview-empty.png", shows: "Space overview of an empty space (10 §12 empty state, Create a page for an editor)." },
  { file: "04-overview-populated.png", shows: "Space overview with a populated page tree (Specifications open)." },
  { file: "05-overview-highlighted.png", shows: "Space overview after View in Hierarchy: the page highlighted (amber ring) and its path open." },
  { file: "06-page-view-content.png", shows: "Page view of Specifications, sidebar expanded: breadcrumb, byline icons, actions, title, byline, a table with a header row, headings, lists, a task list, a link and a code block.", ref: { video: "main", at: "3:24" } },
  { file: "07-page-menu-open.png", shows: "Page view with the ··· menu open (RD-059 order; inert items greyed).", ref: { video: "vb", at: "3:50" } },
  { file: "08-dialog-attachments.png", shows: "··· → Attachments dialog with one image attachment." },
  { file: "09-dialog-page-information.png", shows: "··· → Page information dialog." },
  { file: "10-dialog-copy.png", shows: "··· → Copy dialog, prefilled Copy of Specifications." },
  { file: "11-dialog-move.png", shows: "··· → Move dialog with the filterable list of places." },
  { file: "12-dialog-delete.png", shows: "··· → Delete dialog naming how many pages go." },
  { file: "13-version-banner.png", shows: "A past version (?version=2) under the version banner, no Edit." },
  { file: "14-draft-notice.png", shows: "Page view with the viewer's draft notice (Continue editing, Discard draft)." },
  { file: "15-editor-empty.png", shows: "Editor on a new Untitled page made by Create: toolbar row 1, breadcrumb, title, placeholder, footer Ready to go.", ref: { video: "main", at: "0:46", note: "layout" } },
  { file: "16-editor-content.png", shows: "Editor on Specifications with content: toolbar, breadcrumb Team / Pages / Specifications, title, table.", ref: { video: "main", at: "0:46" } },
  { file: "17-editor-table-row2.png", shows: "Editor with the caret in a table: toolbar row 2 (table tools) shown.", ref: { video: "main", at: "0:58" } },
  { file: "18-editor-macro-suggestions.png", shows: "Editor with the { Macro suggestions popup open.", ref: { video: "main", at: "0:59" } },
  { file: "19-editor-insert-menu.png", shows: "Editor with the + ▾ Insert more content menu open.", ref: { video: "main", at: "1:06" } },
  { file: "20-editor-text-colour-menu.png", shows: "Editor with the A▾ text colour menu open." },
  { file: "21-editor-status-colours.png", shows: "Editor with the Status lozenge's Edit status dialog (text and colour choices) open." },
  { file: "22-editor-conflict-banner.png", shows: "Editor with the conflict banner (someone published meanwhile): Overwrite, Reload latest." },
  { file: "23-editor-footer-ready.png", shows: "Editor footer, before any edit: Ready to go, What did you change?, Notify watchers (ticked), Update, Close, ···.", ref: { video: "main", at: "0:46", note: "footer" }, element: true },
  { file: "24-editor-footer-saving.png", shows: "Editor footer while an autosave is in flight: Saving changes.", element: true },
  { file: "25-editor-footer-saved.png", shows: "Editor footer after an autosave: Changes saved.", ref: { video: "main", at: "0:58", note: "footer" }, element: true },
  { file: "26-page-history.png", shows: "Page History: intro, Compare selected versions, the table with CURRENT, comments and Restore / Delete (alice, ADMIN).", ref: { video: "vb", at: "3:51" } },
  { file: "27-compare.png", shows: "Compare v. 2 with v. 3: added, removed and changed blocks, each with a word and a colour." },
  { file: "28-create-picker-non-editable.png", shows: "carol (VIEW only) in TEAM: Create is the space picker, with no space to pick." },
];

const refName = (video: Video, at: string) => `ref-${video}-${at.replace(":", "").padStart(3, "0")}.png`;

function ffmpeg(args: readonly string[]): boolean {
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "pipe", timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

/** The reference frame's path, extracting it from the screencast when it is missing; null when it cannot be had. */
function referenceFrame(video: Video, at: string): string | null {
  const path = `${REFERENCE_DIR}/${refName(video, at)}`;
  if (existsSync(path)) return path;
  if (!existsSync(VIDEO_FILE[video])) return null;
  mkdirSync(REFERENCE_DIR, { recursive: true });
  return ffmpeg(["-ss", at, "-i", VIDEO_FILE[video], "-frames:v", "1", path]) && existsSync(path) ? path : null;
}

test.afterAll(() => {
  mkdirSync(`${GUI_REVIEW_DIR}/side-by-side`, { recursive: true });
  const lines = [
    "# Slice 1 — GUI review (1920×1080)",
    "",
    "Generated by `e2e/slice-1-gui-review.spec.ts` on every run (Playwright empties `test-results/` first).",
    "Reference frames come from the git-ignored screencasts (`docs/research/*.mp4`; frame index in",
    "`docs/research/requirement-yogi-video.md` §10a and `requirement-yogi-videos-2.md`). The recordings show",
    "Confluence's chrome (logo, name), which Reqforge replaces; everything else in the application area is the",
    "reference (RD-031, RD-084). Compare layout, order, proportions, glyphs, spacing, colours and copy — not pixels.",
    "Side-by-side composites put ours on the left and the frame's application window, scaled to 1080 px high, on the right.",
    "",
    "| # | Screenshot | What it shows | Reference frame | Side by side |",
    "|---|---|---|---|---|",
  ];
  for (const shot of SHOTS) {
    const ours = `${GUI_REVIEW_DIR}/${shot.file}`;
    const have = existsSync(ours);
    let refCell = "— (no frame shows this screen; ours, in the video's register)";
    let sideCell = "—";
    if (shot.ref) {
      const frame = referenceFrame(shot.ref.video, shot.ref.at);
      const label = `${shot.ref.video === "main" ? "ry-screencast" : "VB"} ${shot.ref.at}${shot.ref.note ? ` (${shot.ref.note})` : ""}`;
      refCell = frame ? `[${label}](../reference/${refName(shot.ref.video, shot.ref.at)})` : `${label} — frame not available (screencast or ffmpeg missing)`;
      if (frame && have && !shot.element) {
        const side = `${GUI_REVIEW_DIR}/side-by-side/${shot.file}`;
        const made = ffmpeg([
          "-i",
          ours,
          "-i",
          frame,
          "-filter_complex",
          `[0]scale=-2:1080[a];[1]${APP_WINDOW[shot.ref.video]},scale=-2:1080[b];[a][b]hstack=inputs=2`,
          side,
        ]);
        sideCell = made ? `[side-by-side/${shot.file}](side-by-side/${shot.file})` : "composite failed";
      }
    }
    const no = shot.file.slice(0, 2);
    lines.push(`| ${no} | ${have ? `[${shot.file}](${shot.file})` : `${shot.file} — **missing** (its test failed before the shot)`} | ${shot.shows} | ${refCell} | ${sideCell} |`);
  }
  writeFileSync(`${GUI_REVIEW_DIR}/INDEX.md`, `${lines.join("\n")}\n`);
});

// --------------------------------------------------------------------------------- helpers

/** Takes `file` (which must be in SHOTS) with the pointer parked off any control. */
async function snap(page: Page, file: string, target?: Locator): Promise<void> {
  if (!SHOTS.some((s) => s.file === file)) throw new Error(`${file} is not in the shot list`);
  await page.mouse.move(1919, 1079);
  await shoot(target ?? page, file);
}

const menuTrigger = (page: Page) => page.getByRole("button", { name: t("pageMenu.label") });

/** The video's space: Specifications (with the requirements tables) > Page Heading, Test session 1a > Session notes; Team notes. */
async function videoSpace(page: Page) {
  const tree = await createTreeViaApi(page.request, TEAM, [
    { title: "Specifications", children: [{ title: "Page Heading" }, { title: "Test session 1a", children: [{ title: "Session notes" }] }] },
    { title: "Team notes" },
  ]);
  const specs = tree.Specifications;
  const heading = tree["Page Heading"];
  if (!specs || !heading) throw new Error("set-up failed");
  await publishSeries(page.request, TEAM, specs, [
    { content: paragraphs("First draft of the specifications."), message: "first draft" },
    { content: specificationsDoc(), message: "the requirements tables" },
  ]);
  await publishSeries(page.request, TEAM, heading, [
    { content: docOf({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Heading 1" }] }, p("Lorem ipsum dolor sit amet, consectetur adipiscing elit.")) },
  ]);
  return { specs, heading };
}

// ----------------------------------------------------------------------------------- shots

test.describe("GUI review screenshots (1920×1080)", () => {
  test("the sidebar, expanded and collapsed, and the page view", async ({ page }) => {
    await signIn(page, "bob");
    const { specs, heading } = await videoSpace(page);

    await page.goto(pageUrl(TEAM, heading.id));
    await expect(treeItem(page.getByRole("tree", { name: t("tree.label") }), "Page Heading")).toHaveAttribute("aria-current", "page");
    await snap(page, "01-sidebar-expanded-tree.png");

    await page.goto(pageUrl(TEAM, specs.id));
    await expect(page.getByRole("table")).toBeVisible();
    await snap(page, "06-page-view-content.png");

    await page.getByRole("button", { name: t("sidebar.collapse") }).click();
    await expect(page.getByRole("complementary", { name: t("sidebar.nav") })).toHaveAttribute("data-state", "collapsed");
    await snap(page, "02-sidebar-collapsed-rail.png");
  });

  test("the space overview: empty, populated, highlighted", async ({ page }) => {
    await signIn(page, "bob", "/spaces/TEAM");
    await expect(page.getByText(t("space.empty"))).toBeVisible();
    await snap(page, "03-overview-empty.png");

    const { heading } = await videoSpace(page);
    await page.reload();
    const tree = overviewTree(page);
    await treeItem(tree, "Specifications").focus();
    await page.keyboard.press("ArrowRight");
    await expect(treeItem(tree, "Page Heading")).toBeVisible();
    await page.locator("body").click({ position: { x: 1900, y: 1060 } });
    await snap(page, "04-overview-populated.png");

    await page.goto(`/spaces/TEAM?highlight=${heading.id}`);
    await expect(treeItem(overviewTree(page), "Page Heading")).toHaveAttribute("aria-current", "true");
    await snap(page, "05-overview-highlighted.png");
  });

  test("the ··· menu and its dialogs, the version banner and the draft notice", async ({ page }) => {
    await signIn(page, "bob");
    const { specs } = await videoSpace(page);
    await uploadViaApi(page.request, TEAM, specs.id, { name: "architecture.png", mimeType: "image/png", buffer: PNG_1PX });
    await page.goto(pageUrl(TEAM, specs.id));

    await menuTrigger(page).click();
    await expect(page.getByRole("menu", { name: t("pageMenu.label") })).toBeVisible();
    await snap(page, "07-page-menu-open.png");
    await menuTrigger(page).click();

    const dialogs: readonly (readonly [string, string, string])[] = [
      [t("pageMenu.attachments"), t("pageAttachments.title"), "08-dialog-attachments.png"],
      [t("pageMenu.info"), t("pageInfo.title"), "09-dialog-page-information.png"],
      [t("pageMenu.copy"), t("pageCopy.title", { title: "Specifications" }), "10-dialog-copy.png"],
      [t("pageMenu.move"), t("pageMove.title", { title: "Specifications" }), "11-dialog-move.png"],
      [t("pageMenu.delete"), t("pageDelete.title", { title: "Specifications" }), "12-dialog-delete.png"],
    ];
    for (const [item, title, file] of dialogs) {
      await menuTrigger(page).click();
      await page.getByRole("menu", { name: t("pageMenu.label") }).getByRole("menuitem", { name: item, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      if (file.includes("attachments")) await expect(dialog.getByRole("row").filter({ hasText: "architecture.png" })).toBeVisible();
      if (file.includes("move")) await expect(dialog.getByRole("option").first()).toBeVisible();
      if (file.includes("delete")) await expect(dialog).toContainText(t("pageDelete.body.children", { d: 3, n: 4 }));
      await snap(page, file);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }

    await page.goto(`${pageUrl(TEAM, specs.id)}?version=2`);
    await expect(page.getByText(t("pageView.version.banner", { n: 2 }))).toBeVisible();
    await snap(page, "13-version-banner.png");

    const draft = await page.request.put(`${pageApi(TEAM, specs.id)}/draft`, {
      headers: SAME_ORIGIN,
      data: { title: "Specifications", content: specificationsDoc(), baseVersion: 3 },
    });
    expect(draft.status()).toBe(200);
    await page.goto(pageUrl(TEAM, specs.id));
    await expect(page.getByText(t("pageView.draft.notice"))).toBeVisible();
    await snap(page, "14-draft-notice.png");
  });

  test("the editor: empty, with content, in a table, popups, menus, dialogs and footer states", async ({ page }) => {
    await signIn(page, "bob");
    const { specs } = await videoSpace(page);
    const content = page.getByRole("textbox", { name: t("editor.content.label") });
    const toolbar = page.getByRole("toolbar", { name: t("editor.toolbar") });
    const footer = page.getByTestId("editor-footer");
    const saveState = footer.getByRole("status");

    // Empty: a new page from Create.
    await page.goto(pageUrl(TEAM, specs.id));
    await page.getByRole("banner").getByRole("button", { name: t("shell.create"), exact: true }).click();
    await page.waitForURL(/\/edit$/);
    await expect(saveState).toHaveText(t("editor.state.ready"));
    await snap(page, "15-editor-empty.png");
    await snap(page, "23-editor-footer-ready.png", footer);

    // With content.
    await page.goto(editUrl(TEAM, specs.id));
    await expect(content.getByRole("table")).toBeVisible();
    await snap(page, "16-editor-content.png");

    // In a table: row 2. Hold the autosave so `Saving changes` can be photographed, then let it land.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/draft$/, async (route) => {
      if (route.request().method() === "PUT") await held;
      await route.continue();
    });
    await content.getByRole("cell", { name: "Patricia" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (lead)");
    await expect(page.getByRole("toolbar", { name: t("editor.tableToolbar") })).toBeVisible();
    await expect(saveState).toHaveText(t("editor.state.saving"));
    await snap(page, "24-editor-footer-saving.png", footer);
    release();
    await expect(saveState).toHaveText(t("editor.state.saved"));
    await page.unroute(/\/draft$/);
    await snap(page, "17-editor-table-row2.png");
    await snap(page, "25-editor-footer-saved.png", footer);

    // `{` Macro suggestions, at the end of the page. Leaving the table removes toolbar row 2 and
    // shifts the page up under the pointer, so click once to leave it and again to place the caret.
    await content.getByText("npm run build").click();
    await expect(page.getByRole("toolbar", { name: t("editor.tableToolbar") })).toHaveCount(0);
    await content.getByText("npm run build").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // leaves the code block
    await page.keyboard.type("{");
    await expect(page.getByRole("listbox", { name: t("autocomplete.title") })).toBeVisible();
    await snap(page, "18-editor-macro-suggestions.png");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");

    // The + menu.
    await toolbar.getByRole("button", { name: t("editor.insertMore") }).click();
    await expect(page.getByRole("menu", { name: t("editor.insertMore") })).toBeVisible();
    await snap(page, "19-editor-insert-menu.png");
    await page.keyboard.press("Escape");

    // The text colour menu.
    await toolbar.getByRole("button", { name: t("editor.textColour") }).click();
    await expect(page.getByRole("menu", { name: t("editor.textColour") })).toBeVisible();
    await snap(page, "20-editor-text-colour-menu.png");
    await page.keyboard.press("Escape");

    // The Status lozenge's colours.
    await toolbar.getByRole("button", { name: t("editor.insertMore") }).click();
    await page.getByRole("menu", { name: t("editor.insertMore") }).getByRole("menuitem", { name: t("editor.macro.status") }).click();
    await expect(page.getByRole("dialog", { name: t("editor.status.title") })).toBeVisible();
    await snap(page, "21-editor-status-colours.png");
    await page.keyboard.press("Escape");
  });

  test("the editor's conflict banner", async ({ page, browser }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Shared page" });
    await publishSeries(page.request, TEAM, created, [{ content: specificationsDoc(), message: "start" }]);
    await page.goto(editUrl(TEAM, created.id));
    const content = page.getByRole("textbox", { name: t("editor.content.label") });
    await expect(content.getByRole("table")).toBeVisible();
    const { context, page: alice } = await signedInContext(browser, "alice");
    await publishSeries(alice.request, TEAM, { ...created, currentVersion: 2 }, [{ content: specificationsDoc(), message: "alice" }]);
    await context.close();
    await content.getByText("Business Requirements").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (draft)");
    await expect(page.getByRole("alert").filter({ hasText: t("editor.conflict.help") })).toBeVisible();
    await snap(page, "22-editor-conflict-banner.png");
  });

  test("Page History and Compare", async ({ page }) => {
    await signIn(page, "alice");
    const created = await createPageViaApi(page.request, TEAM, { title: "Specifications" });
    await publishSeries(page.request, TEAM, created, [
      { content: docOf(p("Intro"), p("Beta"), p("Middle"), p("Removed one"), p("End")), message: "before the review" },
      { content: docOf(p("Intro"), p("Beta, changed"), p("Middle"), p("End"), p("Added at the end")), message: "after the review" },
    ]);
    await page.goto(historyUrl(TEAM, created.id));
    await expect(page.getByRole("table", { name: t("history.table", { title: "Specifications" }) })).toBeVisible();
    await snap(page, "26-page-history.png");

    await page.goto(compareUrl(TEAM, created.id, 2, 3));
    await expect(page.getByText(t("compare.summary", { added: 1, removed: 1, changed: 1 }))).toBeVisible();
    await snap(page, "27-compare.png");
  });

  test("the Create picker in a space the viewer cannot edit", async ({ page }) => {
    await signIn(page, "carol", "/spaces/TEAM");
    await page.getByRole("banner").getByRole("button", { name: t("shell.create"), exact: true }).click();
    await expect(page.getByRole("menuitem", { name: t("shell.create.noSpace") })).toBeVisible();
    await snap(page, "28-create-picker-non-editable.png");
  });
});
