// Who may do what with pages (07 §2, RD-051, RD-064, RD-072, RD-080): a viewer reads and changes
// nothing; a page or space you cannot see is not found; the API's Origin and session gates.
import type { Browser, Page } from "@playwright/test";
import { t } from "../src/copy";
import { DEMO, expect, signIn, test } from "./fixtures";
import {
  PLAT,
  SAME_ORIGIN,
  TEAM,
  compareUrl,
  createPageViaApi,
  createTreeViaApi,
  editUrl,
  historyUrl,
  pageApi,
  pageUrl,
  pagesApi,
  paragraphs,
  publishSeries,
  signedInContext,
} from "./pages";

const actions = (page: Page) => page.getByRole("group", { name: t("pageView.actions") });
const sidebarTree = (page: Page) => page.getByRole("complementary", { name: t("sidebar.nav") }).getByRole("tree", { name: t("tree.label") });

test.describe("a viewer (VIEW only)", () => {
  test("carol reads TEAM's pages, and nothing that changes them is offered", async ({ page, browser }) => {
    const { context, page: bob } = await signedInContext(browser, "bob");
    const tree = await createTreeViaApi(bob.request, TEAM, [{ title: "Visible parent", children: [{ title: "Visible child" }] }]);
    const parent = tree["Visible parent"];
    if (!parent) throw new Error("set-up failed");
    await publishSeries(bob.request, TEAM, parent, [{ content: paragraphs("Readable text"), message: "v2" }]);
    await context.close();

    await signIn(page, "carol", pageUrl(TEAM, parent.id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Visible parent");
    await expect(page.getByTestId("page-view").getByText("Readable text")).toBeVisible();

    // No Edit, and `E` does nothing.
    await expect(actions(page).getByRole("link", { name: t("page.edit") })).toHaveCount(0);
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("e");
    await expect(page).toHaveURL(pageUrl(TEAM, parent.id));

    // Create is the space picker, with no space to pick (RD-052, RD-079).
    const create = page.getByRole("banner").getByRole("button", { name: t("shell.create") });
    await expect(create).toHaveAttribute("aria-haspopup", "menu");
    await create.click();
    await expect(page.getByRole("menuitem", { name: t("shell.create.noSpace") })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { level: 1 }).click();

    // The tree: no "+", no drag, no keyboard moves.
    const sidebar = sidebarTree(page);
    await sidebar.getByRole("treeitem", { name: "Visible parent" }).focus();
    await page.keyboard.press("ArrowRight"); // expanding is reading, not editing
    await expect(sidebar.getByRole("treeitem", { name: "Visible child" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Create a page/ })).toHaveCount(0);
    await expect(sidebar.locator("[draggable]")).toHaveCount(0);
    await expect(sidebar).not.toHaveAttribute("aria-describedby", /.+/); // no keyboard-move help
    const moves: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/")) moves.push(`${request.method()} ${request.url()}`);
    });
    await sidebar.getByRole("treeitem", { name: "Visible child" }).focus();
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    await page.keyboard.press("Alt+ArrowUp");

    // The ··· menu: no Copy, Move or Delete (07 §2.4, RD-059).
    await page.getByRole("button", { name: t("pageMenu.label") }).click();
    await expect(page.getByRole("menu", { name: t("pageMenu.label") }).getByRole("menuitem")).toHaveText([
      t("pageMenu.attachments"),
      t("pageMenu.history"),
      t("pageMenu.restrictions"),
      t("pageMenu.peopleWhoCanView"),
      t("pageMenu.info"),
      t("pageMenu.hierarchy"),
      t("pageMenu.exportWord"),
      t("pageMenu.reqforge"),
    ]);
    await page.getByRole("menuitem", { name: t("pageMenu.attachments") }).click();
    const attachments = page.getByRole("dialog", { name: t("pageAttachments.title") });
    await expect(attachments.getByText(t("pageAttachments.empty"))).toBeVisible();
    await expect(attachments.getByRole("button", { name: t("pageAttachments.upload") })).toHaveCount(0);
    await attachments.getByRole("button", { name: t("pageView.dialog.close") }).click();

    // Page History: no Restore, no Delete, the Actions column still there (RD-083).
    await page.goto(historyUrl(TEAM, parent.id));
    const history = page.getByRole("table", { name: t("history.table", { title: "Visible parent" }) });
    await expect(history.getByRole("columnheader", { name: t("history.col.actions") })).toBeVisible();
    await expect(history.getByRole("button")).toHaveCount(0);

    // The space overview: no Create a page.
    await page.goto("/spaces/TEAM");
    await expect(page.getByRole("tree", { name: t("overview.tree", { space: "Team" }) })).toBeVisible();
    await expect(page.getByRole("button", { name: t("tree.createPage"), exact: true })).toHaveCount(0);
    expect(moves).toEqual([]);
  });

  test("carol's direct visit to the editor is sent to the page view", async ({ page, browser }) => {
    const { context, page: bob } = await signedInContext(browser, "bob");
    const created = await createPageViaApi(bob.request, TEAM, { title: "Not yours to edit" });
    await context.close();

    await signIn(page, "carol");
    await page.goto(editUrl(TEAM, created.id));
    await expect(page).toHaveURL(pageUrl(TEAM, created.id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not yours to edit");
    await expect(page.getByRole("textbox", { name: t("editor.content.label") })).toHaveCount(0);
  });

  test("a viewer can still watch and save for later (VIEW is enough, 08 §3)", async ({ page, browser }) => {
    const { context, page: bob } = await signedInContext(browser, "bob");
    const created = await createPageViaApi(bob.request, TEAM, { title: "Watch me" });
    await context.close();
    await signIn(page, "carol", pageUrl(TEAM, created.id));
    const watch = actions(page).getByRole("button", { name: t("page.watching") });
    await expect(watch).toHaveAttribute("aria-pressed", "false");
    await watch.click();
    await expect(watch).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(watch).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("what you cannot see does not exist", () => {
  test("an unauthenticated page URL goes to sign-in, and back to the page after it", async ({ page, browser }) => {
    const { context, page: bob } = await signedInContext(browser, "bob");
    const created = await createPageViaApi(bob.request, TEAM, { title: "Deep link" });
    await context.close();

    await page.goto(pageUrl(TEAM, created.id));
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(pageUrl(TEAM, created.id))}`);
    await page.getByLabel(t("auth.email")).fill(DEMO.users.bob.email);
    await page.getByLabel(t("auth.password")).fill("e2e-password-123");
    await page.getByRole("button", { name: t("auth.submit") }).click();
    await expect(page).toHaveURL(pageUrl(TEAM, created.id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deep link");
  });

  test("a page in a space carol cannot see is the not-found screen, on every page route", async ({ page, browser }) => {
    const { context, page: alice } = await signedInContext(browser, "alice");
    const secret = await createPageViaApi(alice.request, PLAT, { title: "Platform secret" });
    await publishSeries(alice.request, PLAT, secret, [{ content: paragraphs("classified") }]);
    await context.close();

    await signIn(page, "carol");
    for (const url of [pageUrl(PLAT, secret.id), `${pageUrl(PLAT, secret.id)}?version=1`, historyUrl(PLAT, secret.id), compareUrl(PLAT, secret.id, 1, 2), editUrl(PLAT, secret.id), pageUrl(TEAM, secret.id)]) {
      await page.goto(url);
      await expect(page.getByText(t("error.notFound")), url).toBeVisible();
      await expect(page.getByText("Platform secret")).toHaveCount(0);
      await expect(page.getByText("classified")).toHaveCount(0);
    }
  });

  test("every unknown, invisible or malformed page URL answers HTTP 404 (RD-051, RD-080)", async ({ page, browser }) => {
    const { context, page: alice } = await signedInContext(browser, "alice");
    const secret = await createPageViaApi(alice.request, PLAT, { title: "Platform secret" });
    await context.close();
    await signIn(page, "carol");
    const team = await createPageForCarolToSee(browser);

    const urls = [
      pageUrl(PLAT, secret.id), // a space carol cannot see
      pageUrl(TEAM, "no-such-page"), // a page that does not exist
      `${pageUrl(TEAM, team)}?version=99`, // a version that does not exist
      `${pageUrl(TEAM, team)}?version=abc`, // a malformed version
      historyUrl(PLAT, secret.id),
      historyUrl(TEAM, "no-such-page"),
      compareUrl(TEAM, team, 1, 1),
      editUrl(PLAT, secret.id),
    ];
    for (const url of urls) {
      const response = await page.goto(url);
      await expect(page.getByText(t("error.notFound")), url).toBeVisible();
      expect.soft(response?.status(), `HTTP status of ${url}`).toBe(404);
    }
  });
});

/** A TEAM page made by bob, which carol can see. */
async function createPageForCarolToSee(browser: Browser): Promise<string> {
  const { context, page: bob } = await signedInContext(browser, "bob");
  const created = await createPageViaApi(bob.request, TEAM, { title: "Carol can see this" });
  await context.close();
  return created.id;
}

test.describe("the API's gates (RD-064, RD-072)", () => {
  test("without a session every call is 401 problem+json, never a redirect", async ({ request }) => {
    for (const [method, url] of [
      ["GET", pagesApi(TEAM)],
      ["GET", pageApi(TEAM, "anything")],
      ["POST", pagesApi(TEAM)],
      ["GET", "/api/v1/attachments/anything/x.png"],
    ] as const) {
      const response = await request.fetch(url, { method, headers: SAME_ORIGIN, maxRedirects: 0 });
      expect(response.status(), `${method} ${url}`).toBe(401);
      expect(response.headers()["content-type"]).toContain("application/problem+json");
      expect(await response.json()).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    }
  });

  test("a state-changing call without this host's Origin is 403 ORIGIN_MISMATCH, even signed in", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Origin checked" });
    for (const origin of [null, "https://evil.example", "null", "http://localhost:9", "file://"]) {
      const headers: Record<string, string> = origin === null ? {} : { Origin: origin };
      for (const [method, url, data] of [
        ["POST", pagesApi(TEAM), {}],
        ["PUT", pageApi(TEAM, created.id), { title: "x", content: paragraphs("x"), baseVersion: 1 }],
        ["DELETE", pageApi(TEAM, created.id), undefined],
        ["PUT", `${pageApi(TEAM, created.id)}/watch`, undefined],
      ] as const) {
        const response = await page.request.fetch(url, { method, headers, ...(data === undefined ? {} : { data }) });
        expect(response.status(), `${method} ${url} with Origin ${String(origin)}`).toBe(403);
        expect(await response.json()).toMatchObject({ code: "ORIGIN_MISMATCH" });
      }
    }
    // Nothing happened, and reading needs no Origin.
    const read = await page.request.get(pageApi(TEAM, created.id));
    expect(read.status()).toBe(200);
    expect((await read.json()) as { page: { currentVersion: number } }).toMatchObject({ page: { title: "Origin checked", currentVersion: 1 } });
  });

  test("a viewer's write is 403 FORBIDDEN; a space it cannot see is 404 NOT_FOUND", async ({ page, browser }) => {
    const { context, page: alice } = await signedInContext(browser, "alice");
    const team = await createPageViaApi(alice.request, TEAM, { title: "Team page" });
    const plat = await createPageViaApi(alice.request, PLAT, { title: "Plat page" });
    await context.close();

    await signIn(page, "carol");
    const read = await page.request.get(pageApi(TEAM, team.id));
    expect(read.status()).toBe(200);
    for (const [method, url, data] of [
      ["POST", pagesApi(TEAM), {}],
      ["PUT", pageApi(TEAM, team.id), { title: "Team page", content: paragraphs("carol"), baseVersion: 1 }],
      ["PATCH", pageApi(TEAM, team.id), { title: "Renamed by carol" }],
      ["DELETE", pageApi(TEAM, team.id), undefined],
      ["POST", `${pageApi(TEAM, team.id)}/move`, { parentId: null, index: 0 }],
      ["POST", `${pageApi(TEAM, team.id)}/copy`, {}],
    ] as const) {
      const response = await page.request.fetch(url, { method, headers: SAME_ORIGIN, ...(data === undefined ? {} : { data }) });
      expect(response.status(), `${method} ${url}`).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
    for (const url of [pageApi(PLAT, plat.id), pagesApi(PLAT), `${pageApi(PLAT, plat.id)}/versions`]) {
      const response = await page.request.get(url);
      expect(response.status(), url).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    // A write to a space it cannot see is 404 too, never 403: nothing is revealed (RD-072).
    const hidden = await page.request.put(pageApi(PLAT, plat.id), { headers: SAME_ORIGIN, data: { title: "x", content: paragraphs("x"), baseVersion: 1 } });
    expect(hidden.status()).toBe(404);
  });
});
