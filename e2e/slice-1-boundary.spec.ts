// Large inputs and the limits' edges, through the real server (07 §4; RD-058, RD-063, RD-068,
// RD-075): a 10 MiB attachment round trip, the 5 MiB content limit decided on the parsed content
// (not on the wire, so an ASCII-escaped 13 MiB body of 4.4 MiB content is accepted), the transport
// cap, a 2,000-page tree and a 200-version history.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { APIResponse, Page } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import {
  SAME_ORIGIN,
  TEAM,
  createPageViaApi,
  docOf,
  dragRow,
  getPageViaApi,
  historyUrl,
  isMoveResponse,
  listPagesViaApi,
  overviewTree,
  p,
  pageApi,
  pageUrl,
  publishViaApi,
  seedPageTree,
  seedVersions,
  sha256,
  sidebarTree,
  titlesAt,
  treeItem,
} from "./pages";

const MIB = 1024 * 1024;
const CONTENT_LIMIT = 5 * MIB; // RD-063
const ATTACHMENT_LIMIT = 10 * MIB; // RD-058
const TRANSPORT_CAP = 3 * CONTENT_LIMIT + 64 * 1024; // RD-075

/** JSON as Python's json.dumps writes it by default: every non-ASCII code unit as \uXXXX. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const utf8Bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

async function putRaw(page: Page, url: string, body: string): Promise<APIResponse> {
  return page.request.put(url, { headers: { ...SAME_ORIGIN, "Content-Type": "application/json" }, data: body, timeout: 120_000 });
}

async function expectTooLarge(response: APIResponse, limit: number, what: string): Promise<void> {
  expect(response.status(), what).toBe(413);
  expect(response.headers()["content-type"], what).toContain("application/problem+json");
  expect(await response.json(), what).toMatchObject({ status: 413, code: "TOO_LARGE", limit });
}

/** The canonical JSON the server stores for a one-paragraph document whose text is `x`. */
async function canonicalOneParagraph(page: Page, pageId: string, title: string): Promise<unknown> {
  await publishViaApi(page.request, TEAM, pageId, { title, content: docOf(p("x")), baseVersion: 1 });
  return (await getPageViaApi(page.request, TEAM, pageId)).version.content;
}

test.describe("attachments at the 10 MiB limit (RD-058)", () => {
  test("a 10 MiB file uploads through the dialog and downloads byte-identical; one byte more is refused", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Big files" });
    const exact = randomBytes(ATTACHMENT_LIMIT); // random bytes: not an image, so a download (RD-071)
    await page.goto(pageUrl(TEAM, created.id));
    await page.getByRole("button", { name: t("pageMenu.attachments") }).click();
    const dialog = page.getByRole("dialog", { name: t("pageAttachments.title") });

    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: t("pageAttachments.upload") }).click();
    await (await chooser).setFiles({ name: "ten-mib.bin", mimeType: "application/octet-stream", buffer: exact });
    await expect(dialog.getByRole("status").filter({ hasText: t("pageAttachments.uploaded", { name: "ten-mib.bin" }) })).toBeVisible({ timeout: 60_000 });
    const listed = dialog.getByRole("row").filter({ hasText: "ten-mib.bin" });
    await expect(listed).toContainText(t("pageAttachments.size.mib", { n: 10 }));

    const download = page.waitForEvent("download");
    await listed.getByRole("link", { name: "ten-mib.bin" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("ten-mib.bin");
    const bytes = readFileSync(await file.path());
    expect(bytes.length).toBe(ATTACHMENT_LIMIT);
    expect(sha256(bytes)).toBe(sha256(exact));

    // One byte over: the dialog refuses it before sending anything (RD-071) …
    const uploads: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/attachments")) uploads.push(request.url());
    });
    const over = Buffer.concat([exact, Buffer.from([0])]);
    const chooser2 = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: t("pageAttachments.upload") }).click();
    await (await chooser2).setFiles({ name: "too-big.bin", mimeType: "application/octet-stream", buffer: over });
    await expect(dialog.getByRole("alert")).toHaveText(t("pageAttachments.upload.tooLarge", { name: "too-big.bin", mib: "10" }));
    expect(uploads).toEqual([]);

    // … and the server, sent it anyway, says TOO_LARGE with the documented limit.
    const refused = await page.request.post(`${pageApi(TEAM, created.id)}/attachments`, {
      headers: SAME_ORIGIN,
      multipart: { file: { name: "too-big.bin", mimeType: "application/octet-stream", buffer: over } },
      timeout: 60_000,
    });
    await expectTooLarge(refused, ATTACHMENT_LIMIT, "upload of 10 MiB + 1 byte");
    const names = ((await (await page.request.get(`${pageApi(TEAM, created.id)}/attachments`)).json()) as { filename: string; size: number }[]).map(
      (a) => [a.filename, a.size],
    );
    expect(names).toEqual([["ten-mib.bin", ATTACHMENT_LIMIT]]);
  });
});

test.describe("the 5 MiB content limit is the content's, not the wire's (RD-063, RD-075)", () => {
  test("a body over 10 MiB whose content is under 5 MiB is accepted and stored exactly", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Escaped" });
    // 23 paragraphs of 100,000 two-byte characters: about 4.4 MiB as UTF-8, about 13.2 MiB as
    // \u-escaped JSON — over 10 MiB on the wire, under the 15 MiB + 64 KiB transport cap.
    const alphabet = "éàüöñçßøåæ";
    const paragraphs = Array.from({ length: 23 }, (_, i) => {
      const chars = Array.from({ length: 100_000 }, (_, j) => alphabet[(i + j) % alphabet.length] ?? "é").join("");
      return p(`${i}:${chars}`);
    });
    const content = docOf(...paragraphs);
    const body = asciiJson({ title: "Escaped", content, baseVersion: 1, message: "ASCII-escaped body" });
    expect(Buffer.byteLength(body)).toBeGreaterThan(10 * MIB);
    expect(Buffer.byteLength(body)).toBeLessThan(TRANSPORT_CAP);
    expect(utf8Bytes(content)).toBeLessThan(CONTENT_LIMIT);

    const response = await putRaw(page, pageApi(TEAM, created.id), body);
    expect(response.status(), await response.text().catch(() => "")).toBe(200);
    expect(((await response.json()) as { version: { number: number } }).version.number).toBe(2);

    const stored = await getPageViaApi(page.request, TEAM, created.id);
    const texts = JSON.stringify(stored.version.content).match(/"text":"[^"]*"/g) ?? [];
    expect(texts).toHaveLength(23);
    expect(sha256(Buffer.from(texts.join("\n")))).toBe(sha256(Buffer.from(JSON.stringify(content).match(/"text":"[^"]*"/g)?.join("\n") ?? "")));
  });

  test("content of exactly 5 MiB is accepted; one byte more is TOO_LARGE, on publish and on draft save", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "At the limit" });
    // Measure the canonical envelope from the server's own answer, then fill it to the byte.
    const skeleton = await canonicalOneParagraph(page, created.id, "At the limit");
    const overhead = utf8Bytes(skeleton) - 1;
    const filled = (bytes: number) => JSON.parse(JSON.stringify(skeleton).replace('"text":"x"', `"text":"${"a".repeat(bytes - overhead)}"`)) as unknown;
    const atLimit = filled(CONTENT_LIMIT);
    const overLimit = filled(CONTENT_LIMIT + 1);
    expect(utf8Bytes(atLimit)).toBe(CONTENT_LIMIT);
    expect(utf8Bytes(overLimit)).toBe(CONTENT_LIMIT + 1);

    for (const path of ["", "/draft"]) {
      const over = await putRaw(page, `${pageApi(TEAM, created.id)}${path}`, JSON.stringify({ title: "At the limit", content: overLimit, baseVersion: 2 }));
      await expectTooLarge(over, CONTENT_LIMIT, `PUT …${path} with 5 MiB + 1 byte`);
    }
    expect((await getPageViaApi(page.request, TEAM, created.id)).version.number).toBe(2);

    const ok = await putRaw(page, pageApi(TEAM, created.id), JSON.stringify({ title: "At the limit", content: atLimit, baseVersion: 2 }));
    expect(ok.status(), "PUT with exactly 5 MiB").toBe(200);
    expect((await getPageViaApi(page.request, TEAM, created.id)).version.number).toBe(3);
  });

  test("a body over the transport cap is TOO_LARGE with the documented 5 MiB limit, whatever its content", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Padded" });
    // Tiny content, padded with JSON whitespace past 3 × 5 MiB + 64 KiB.
    const body = `{"title":"Padded","baseVersion":1,${" ".repeat(TRANSPORT_CAP)}"content":${JSON.stringify(docOf(p("tiny")))}}`;
    expect(Buffer.byteLength(body)).toBeGreaterThan(TRANSPORT_CAP);
    await expectTooLarge(await putRaw(page, pageApi(TEAM, created.id), body), CONTENT_LIMIT, "a padded body over the cap");
    expect((await getPageViaApi(page.request, TEAM, created.id)).version.number).toBe(1);
  });
});

test.describe("a big tree and a long history", () => {
  test("a 2,000-page tree renders in the overview and the sidebar, and a drag still works and persists", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await signIn(page, "bob");
    // 1,000 root pages with one child each: every root row is drawn, in both trees.
    const tree = await seedPageTree(TEAM, "bob", { idPrefix: "big", titlePrefix: "Big", roots: 1000, childrenPerRoot: 1 });
    expect((await listPagesViaApi(page.request, TEAM)).length).toBe(2000);

    const started = Date.now();
    await page.goto("/spaces/TEAM");
    const overview = overviewTree(page);
    await expect(overview.locator('[role="treeitem"][aria-level="1"]')).toHaveCount(1000, { timeout: 30_000 });
    await expect(sidebarTree(page).locator('[role="treeitem"][aria-level="1"]')).toHaveCount(1000);
    testInfo.annotations.push({ type: "timing", description: `overview of 2,000 pages drawn in ${Date.now() - started} ms` });

    // Drag root 500 before root 499 (both on screen once scrolled to).
    const source = treeItem(overview, tree.title(500));
    const target = treeItem(overview, tree.title(499));
    await target.scrollIntoViewIfNeeded();
    expect((await dragRow(page, source, target, "before")).status()).toBe(200);
    await expect.poll(async () => (await titlesAt(overview, 1)).slice(497, 501)).toEqual([tree.title(498), tree.title(500), tree.title(499), tree.title(501)]);

    // And a keyboard move on the big tree.
    await treeItem(overview, tree.title(1000)).focus();
    const moved = page.waitForResponse(isMoveResponse);
    await page.keyboard.press("Alt+ArrowUp");
    expect((await moved).status()).toBe(200);

    await page.reload();
    const after = await (async () => {
      await expect(overviewTree(page).locator('[role="treeitem"][aria-level="1"]')).toHaveCount(1000, { timeout: 30_000 });
      return titlesAt(overviewTree(page), 1);
    })();
    expect(after.slice(497, 501)).toEqual([tree.title(498), tree.title(500), tree.title(499), tree.title(501)]);
    expect(after.slice(-2)).toEqual([tree.title(1000), tree.title(999)]);

    // A page of the big space still opens, with its place in the tree (the view loads the whole tree, RD-081).
    const child = tree.children[699]?.[0] ?? "";
    await page.goto(pageUrl(TEAM, child));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(tree.title(700, 1), { timeout: 30_000 });
    await expect(treeItem(sidebarTree(page), tree.title(700, 1))).toHaveAttribute("aria-current", "page");
    await expect(treeItem(sidebarTree(page), tree.title(700))).toHaveAttribute("aria-expanded", "true");
  });

  test("a page with 200 versions lists them all in Page History, newest first, and compares the ends", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Long history" });
    const last = await seedVersions(created.id, "bob", 199);
    expect(last).toBe(200);

    const started = Date.now();
    await page.goto(historyUrl(TEAM, created.id));
    const table = page.getByRole("table", { name: t("history.table", { title: "Long history" }) });
    const heads = table.getByRole("rowheader");
    await expect(heads).toHaveCount(200, { timeout: 30_000 });
    testInfo.annotations.push({ type: "timing", description: `200-version history drawn in ${Date.now() - started} ms` });
    await expect(heads.first()).toHaveText(t("history.current", { n: 200 }));
    await expect(heads.nth(1)).toHaveText(t("history.version", { n: 199 }));
    await expect(heads.last()).toHaveText(t("history.version", { n: 1 }));
    await expect(table.getByRole("row").nth(1).getByRole("cell").nth(3)).toHaveText("Change 200");
    await expect(table.getByRole("row").nth(200).getByRole("cell").nth(3)).toHaveText("");

    await table.getByRole("checkbox", { name: t("history.select", { n: 1 }) }).check();
    await table.getByRole("checkbox", { name: t("history.select", { n: 200 }) }).check();
    await page.getByRole("button", { name: t("history.compare") }).click();
    await expect(page).toHaveURL(`${historyUrl(TEAM, created.id)}/compare?a=1&b=200`);
    await expect(page.getByText(t("compare.identical", { a: 1, b: 200 }))).toBeVisible();

    await page.goto(`${pageUrl(TEAM, created.id)}?version=137`);
    await expect(page.getByRole("status").filter({ hasText: t("pageView.version.banner", { n: 137 }) })).toBeVisible();
  });
});
