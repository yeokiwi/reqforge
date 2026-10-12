// The sidebar's PAGE TREE and the space overview (10 §3.2, §11; RD-056, RD-082): nesting, the
// current page, create a child with "+", drag and keyboard moves that persist, the refused move,
// View in Hierarchy, and remembered expansion.
import type { Locator, Page, Response } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import {
  type PageDetail,
  TEAM,
  createTreeViaApi,
  editUrl,
  listPagesViaApi,
  pageUrl,
  seedPageTree,
} from "./pages";

const sidebarTree = (page: Page) => page.getByRole("complementary", { name: t("sidebar.nav") }).getByRole("tree", { name: t("tree.label") });
const overviewTree = (page: Page) => page.getByRole("tree", { name: t("overview.tree", { space: "Team" }) });
const item = (tree: Locator, title: string) => tree.getByRole("treeitem", { name: title, exact: true });
/** The row of a treeitem: the draggable part (chevron, title, "+"), without its children. */
const row = (treeitem: Locator) => treeitem.locator(":scope > div");

/** Titles of the treeitems drawn at `level`, in order (a closed parent's children are not drawn). */
async function titlesAt(tree: Locator, level: number): Promise<string[]> {
  return tree.locator(`[role="treeitem"][aria-level="${level}"]`).evaluateAll((items) =>
    items.map((li) => document.getElementById(li.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""),
  );
}

/** Every drawn treeitem as "level:title", in document order. */
async function drawnTree(tree: Locator): Promise<string[]> {
  return tree.getByRole("treeitem").evaluateAll((items) =>
    items.map((li) => `${li.getAttribute("aria-level")}:${document.getElementById(li.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""}`),
  );
}

const isMove = (response: Response) => response.request().method() === "POST" && /\/pages\/[^/]+\/move$/.test(new URL(response.url()).pathname);

/** The space's pages as `parent > title` lines in sibling order (the server's truth). */
async function serverTree(page: Page): Promise<string[]> {
  const pages = await listPagesViaApi(page.request, TEAM);
  const byId = new Map(pages.map((p) => [p.id, p]));
  return [...pages]
    .sort((a, b) => (a.parentId ?? "").localeCompare(b.parentId ?? "") || a.ordinal - b.ordinal)
    .map((p) => `${p.parentId === null ? "(root)" : byId.get(p.parentId)?.title} > ${p.title}`);
}

/** Drags a row onto another with a real mouse path; `zone` picks the drop position (RD-082). */
async function dragRow(page: Page, source: Locator, target: Locator, zone: "before" | "inside" | "after"): Promise<Response> {
  const box = await row(target).boundingBox();
  if (box === null) throw new Error("drop target is not on screen");
  const y = zone === "before" ? 2 : zone === "after" ? box.height - 2 : box.height / 2;
  const moved = page.waitForResponse(isMove);
  await row(source).dragTo(row(target), { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: Math.min(120, box.width / 2), y } });
  return moved;
}

const SPEC: Parameters<typeof createTreeViaApi>[2] = [
  { title: "Specifications", children: [{ title: "Page Heading" }, { title: "Test session 1a", children: [{ title: "Session notes" }] }] },
  { title: "Team notes" },
  { title: "Archive" },
];

test.describe("the page tree", () => {
  let pages: Record<string, PageDetail>;
  const id = (title: string) => pages[title]?.id ?? "";

  test.beforeEach(async ({ page }) => {
    await signIn(page, "bob");
    pages = await createTreeViaApi(page.request, TEAM, SPEC);
  });

  test("nests pages, opens the current page's ancestors and shows it in bold", async ({ page }) => {
    await page.goto(pageUrl(TEAM, id("Session notes")));
    const tree = sidebarTree(page);
    expect(await drawnTree(tree)).toEqual(["1:Specifications", "2:Page Heading", "2:Test session 1a", "3:Session notes", "1:Team notes", "1:Archive"]);
    await expect(item(tree, "Specifications")).toHaveAttribute("aria-expanded", "true");
    await expect(item(tree, "Test session 1a")).toHaveAttribute("aria-expanded", "true");
    await expect(item(tree, "Team notes")).not.toHaveAttribute("aria-expanded", /.*/); // no children: no toggle
    const current = item(tree, "Session notes");
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current.getByRole("link", { name: "Session notes" })).toHaveCSS("font-weight", "700");
    await expect(item(tree, "Page Heading").getByRole("link")).toHaveCSS("font-weight", "400");
    await expect(tree.locator('[aria-current="page"]')).toHaveCount(1);

    // Following a link moves the current page; the tree is refetched on navigation (RD-082).
    await item(tree, "Team notes").getByRole("link").click();
    await expect(page).toHaveURL(pageUrl(TEAM, id("Team notes")));
    await expect(item(tree, "Team notes")).toHaveAttribute("aria-current", "page");
    await expect(current).not.toHaveAttribute("aria-current", /.*/);
  });

  test("“+” on a row creates a child page and opens the editor on it", async ({ page }) => {
    await page.goto(pageUrl(TEAM, id("Team notes")));
    const tree = sidebarTree(page);
    const specs = item(tree, "Specifications");
    await row(specs).hover(); // the sidebar shows "+" on hover or focus (RD-082)
    await specs.getByRole("button", { name: t("tree.createChild", { title: "Specifications" }) }).click();

    await page.waitForURL(/\/pages\/[^/]+\/edit$/);
    await expect(page.getByRole("textbox", { name: t("editor.title.label") })).toHaveValue(t("page.untitled"));
    const all = await listPagesViaApi(page.request, TEAM);
    const created = all.find((p) => p.title === t("page.untitled"));
    expect(created).toMatchObject({ parentId: id("Specifications"), ordinal: 2 }); // last among its siblings
    expect(page.url()).toContain(editUrl(TEAM, created?.id ?? ""));

    await page.getByRole("button", { name: t("editor.close"), exact: true }).click();
    await expect(item(sidebarTree(page), t("page.untitled"))).toHaveAttribute("aria-level", "2");
  });

  test("dragging a page before, after and onto another reorders and re-parents it, and it persists", async ({ page }) => {
    await page.goto("/spaces/TEAM");
    const tree = overviewTree(page);
    expect(await titlesAt(tree, 1)).toEqual(["Specifications", "Team notes", "Archive"]);

    // Archive before Specifications (the row's top quarter).
    expect((await dragRow(page, item(tree, "Archive"), item(tree, "Specifications"), "before")).status()).toBe(200);
    await expect.poll(() => titlesAt(tree, 1)).toEqual(["Archive", "Specifications", "Team notes"]);

    // Team notes onto Archive (the middle): its last child; the closed parent opens.
    expect((await dragRow(page, item(tree, "Team notes"), item(tree, "Archive"), "inside")).status()).toBe(200);
    await expect.poll(() => drawnTree(tree)).toEqual(["1:Archive", "2:Team notes", "1:Specifications"]);
    await expect(item(tree, "Archive")).toHaveAttribute("aria-expanded", "true");

    // Archive after Specifications (the bottom quarter): back to the end of the roots, with its child.
    expect((await dragRow(page, item(tree, "Archive"), item(tree, "Specifications"), "after")).status()).toBe(200);
    await expect.poll(() => titlesAt(tree, 1)).toEqual(["Specifications", "Archive"]);

    const expected = [
      "(root) > Specifications",
      "(root) > Archive",
      `${"Specifications"} > Page Heading`,
      `${"Specifications"} > Test session 1a`,
      "Archive > Team notes",
      "Test session 1a > Session notes",
    ];
    expect((await serverTree(page)).sort()).toEqual(expected.sort());
    await page.reload();
    expect(await titlesAt(overviewTree(page), 1)).toEqual(["Specifications", "Archive"]);
    expect((await serverTree(page)).sort()).toEqual(expected.sort());
  });

  test("Alt+arrow keys move the focused page, announce where it went, and the move persists", async ({ page }) => {
    await page.goto("/spaces/TEAM");
    const tree = overviewTree(page);
    const archive = item(tree, "Archive");
    await archive.focus();

    const announced = page.locator('[data-page-tree="overview"]').getByRole("status");
    let moved = page.waitForResponse(isMove);
    await page.keyboard.press("Alt+Shift+ArrowRight"); // under the page above it
    expect((await moved).status()).toBe(200);
    await expect(announced).toHaveText(t("tree.moved.under", { title: "Archive", parent: "Team notes", position: 1, count: 1 }));
    await expect(item(tree, "Archive")).toHaveAttribute("aria-level", "2");
    await expect(item(tree, "Archive")).toBeFocused(); // focus follows the page

    moved = page.waitForResponse(isMove);
    await page.keyboard.press("Alt+Shift+ArrowLeft"); // up a level, after its parent
    expect((await moved).status()).toBe(200);
    await expect(announced).toHaveText(t("tree.moved.root", { title: "Archive", position: 3, count: 3 }));

    for (const position of [2, 1]) {
      moved = page.waitForResponse(isMove);
      await page.keyboard.press("Alt+ArrowUp");
      expect((await moved).status()).toBe(200);
      await expect(announced).toHaveText(t("tree.moved.root", { title: "Archive", position, count: 3 }));
    }
    await expect(item(tree, "Archive")).toBeFocused();
    expect(await titlesAt(tree, 1)).toEqual(["Archive", "Specifications", "Team notes"]);

    await page.reload();
    expect(await titlesAt(overviewTree(page), 1)).toEqual(["Archive", "Specifications", "Team notes"]);
  });

  test("a drop onto the dragged page's own descendant is not offered, and nothing is sent", async ({ page }) => {
    await page.goto("/spaces/TEAM");
    const tree = overviewTree(page);
    await item(tree, "Specifications").focus();
    await page.keyboard.press("ArrowRight");
    await expect(item(tree, "Specifications")).toHaveAttribute("aria-expanded", "true");
    const moves: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/move")) moves.push(request.url());
    });

    const source = row(item(tree, "Specifications"));
    const child = row(item(tree, "Test session 1a"));
    const other = row(item(tree, "Team notes"));
    const sourceBox = await source.boundingBox();
    const childBox = await child.boundingBox();
    const otherBox = await other.boundingBox();
    if (!sourceBox || !childBox || !otherBox) throw new Error("rows are not on screen");

    await page.mouse.move(sourceBox.x + 8, sourceBox.y + 8);
    await page.mouse.down();
    // Over a page that is not a descendant: the drop is offered (the row shows where it would go).
    await page.mouse.move(otherBox.x + 100, otherBox.y + otherBox.height / 2, { steps: 8 });
    await expect(other).toHaveAttribute("data-drop", "inside");
    // Over its own child: no drop affordance at all (RD-082).
    await page.mouse.move(childBox.x + 100, childBox.y + childBox.height / 2, { steps: 8 });
    await expect(child).not.toHaveAttribute("data-drop", /.*/);
    await expect(other).not.toHaveAttribute("data-drop", /.*/);
    await page.mouse.up();

    await expect(item(tree, "Test session 1a")).toHaveAttribute("aria-level", "2");
    expect(moves).toEqual([]);
    expect(await serverTree(page)).toContain("Specifications > Test session 1a");
    // No refusal to roll back and explain: nothing was attempted. (Next's route announcer is also
    // role=alert, so look inside the tree's own region.)
    await expect(page.locator('[data-page-tree="overview"]').getByRole("alert")).toHaveCount(0);
  });

  test("View in Hierarchy opens the overview with the page highlighted and scrolled into view", async ({ page }) => {
    const bulk = await seedPageTree(TEAM, "bob", { idPrefix: "hier", titlePrefix: "Bulk", roots: 60, childrenPerRoot: 3 });
    const target = bulk.children[59]?.[2] ?? "";
    await page.goto(pageUrl(TEAM, target));
    await page.getByRole("button", { name: t("pageMenu.label") }).click();
    await page.getByRole("menuitem", { name: t("pageMenu.hierarchy") }).click();

    await expect(page).toHaveURL(`/spaces/TEAM?highlight=${target}`);
    const tree = overviewTree(page);
    const highlighted = item(tree, bulk.title(60, 3));
    await expect(highlighted).toHaveAttribute("aria-current", "true");
    await expect(item(tree, bulk.title(60))).toHaveAttribute("aria-expanded", "true");
    await expect(highlighted).toBeInViewport();
    await expect(item(tree, bulk.title(1))).not.toBeInViewport();
  });

  test("which pages are open is remembered across a reload; the overview draws the sidebar's tree", async ({ page }) => {
    await page.goto("/spaces/TEAM");
    const overview = overviewTree(page);
    const specs = item(overview, "Specifications");
    await expect(specs).toHaveAttribute("aria-expanded", "false");
    await specs.focus();
    await page.keyboard.press("ArrowRight");
    await expect(specs).toHaveAttribute("aria-expanded", "true");
    await page.reload();
    await expect(item(overviewTree(page), "Specifications")).toHaveAttribute("aria-expanded", "true");

    // The same pages, levels and open state in both trees (one shared store, RD-082).
    expect(await drawnTree(overviewTree(page))).toEqual(await drawnTree(sidebarTree(page)));
    expect(await drawnTree(overviewTree(page))).toEqual(["1:Specifications", "2:Page Heading", "2:Test session 1a", "1:Team notes", "1:Archive"]);
    await expect(page.getByRole("button", { name: t("tree.createPage"), exact: true })).toBeVisible();

    await item(overviewTree(page), "Specifications").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(item(overviewTree(page), "Specifications")).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(item(overviewTree(page), "Specifications")).toHaveAttribute("aria-expanded", "false");
    await expect(item(sidebarTree(page), "Specifications")).toHaveAttribute("aria-expanded", "false");
  });

  test("the overview's Create a page makes a root page and opens the editor", async ({ page }) => {
    await page.goto("/spaces/TEAM");
    await page.getByRole("button", { name: t("tree.createPage"), exact: true }).click();
    await page.waitForURL(/\/pages\/[^/]+\/edit$/);
    const created = (await listPagesViaApi(page.request, TEAM)).find((p) => p.title === t("page.untitled"));
    expect(created).toMatchObject({ parentId: null, ordinal: 3 });
  });
});
