// Security in the browser (RD-058, RD-063, RD-068, RD-069, RD-071, RD-075): hostile titles and
// content render as text, unsafe links are refused, SVG never gets in, and the bytes and HTML
// routes are served so that a browser cannot be talked into running them.
import type { Page } from "@playwright/test";
import { t } from "../src/copy";
import { expect, signIn, test } from "./fixtures";
import {
  PNG_1PX,
  SAME_ORIGIN,
  TEAM,
  createPageViaApi,
  docOf,
  editUrl,
  forbidScript,
  link,
  p,
  pageApi,
  pageUrl,
  paragraph,
  pasteInto,
  publishViaApi,
  text,
  uploadViaApi,
} from "./pages";

const HOSTILE_TITLE = `<script>alert("title")</script><img src=x onerror=alert(1)>`;
const LONG_WORD = "A".repeat(6000);

function editorOf(page: Page) {
  return {
    content: page.getByRole("textbox", { name: t("editor.content.label") }),
    title: page.getByRole("textbox", { name: t("editor.title.label") }),
    toolbar: page.getByRole("toolbar", { name: t("editor.toolbar") }),
    update: page.getByRole("button", { name: t("editor.update"), exact: true }),
  };
}

/** No horizontal scrolling anywhere: the page and its scrolling main region fit the window. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(widths).toEqual({ document: 0, main: 0 });
}

test.describe("hostile content renders as text", () => {
  test("a title and a body full of markup, and a very long word, are shown literally and never run", async ({ page }) => {
    const seen = forbidScript(page);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: HOSTILE_TITLE });
    await publishViaApi(page.request, TEAM, created.id, {
      title: HOSTILE_TITLE,
      baseVersion: 1,
      content: docOf(p(`<script>alert("body")</script>`), p(`<img src=x onerror=alert(2)>`), p(`<a href="javascript:alert(3)">x</a>`), p(LONG_WORD)),
    });

    await page.goto(pageUrl(TEAM, created.id));
    const view = page.getByTestId("page-view");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HOSTILE_TITLE);
    await expect(view.getByText(`<script>alert("body")</script>`)).toBeVisible();
    await expect(view.getByText(`<img src=x onerror=alert(2)>`)).toBeVisible();
    await expect(view.locator("script")).toHaveCount(0);
    await expect(view.locator("img")).toHaveCount(0);
    await expect(view.getByRole("link", { name: "x", exact: true })).toHaveCount(0);
    await expect(page).toHaveTitle(new RegExp(`^${HOSTILE_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByRole("navigation", { name: t("pageView.breadcrumb") })).toContainText(HOSTILE_TITLE);
    await expect(page.getByRole("tree", { name: t("tree.label") }).getByRole("treeitem", { name: HOSTILE_TITLE })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto(editUrl(TEAM, created.id));
    await expect(editorOf(page).title).toHaveValue(HOSTILE_TITLE);
    await expect(editorOf(page).content).toContainText(`<script>alert("body")</script>`);
    await expect(editorOf(page).content.locator("script, img[onerror]")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.goto(`${pageUrl(TEAM, created.id)}/history`);
    await expect(page.getByRole("table", { name: t("history.table", { title: HOSTILE_TITLE }) })).toBeVisible();
    expect(seen).toEqual({ errors: [], dialogs: [] });
  });

  test("pasted HTML loses its script, its event handlers and its javascript: links, and keeps the text", async ({ page }) => {
    const seen = forbidScript(page);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Pasted HTML" });
    await page.goto(editUrl(TEAM, created.id));
    const e = editorOf(page);
    await e.content.click();
    await pasteInto(e.content, {
      html:
        `<p>Click <a href="javascript:alert(3)">here</a> now</p>` +
        `<img src="x" onerror="alert(4)"><script>alert(5)</script>` +
        `<p onclick="alert(6)" style="background:url(javascript:alert(7))">para</p>` +
        `<p><a href="https://example.com/safe" onmouseover="alert(8)">safe link</a></p>` +
        `<iframe src="javascript:alert(9)"></iframe><svg onload="alert(10)"><circle r="1"/></svg>`,
      text: "Click here now",
    });
    await expect(e.content).toContainText("Click here now");
    await expect(e.content).toContainText("para");
    await expect(e.content.getByRole("link", { name: "here" })).toHaveCount(0); // unwrapped, text kept
    await expect(e.content.getByRole("link", { name: "safe link" })).toHaveAttribute("href", "https://example.com/safe");
    await expect(e.content.locator("[onclick], [onmouseover], [onerror], [onload], script, iframe, svg")).toHaveCount(0);
    await expect(e.content.locator('img[src="x"]')).toHaveCount(0);

    await e.update.click();
    await expect(page).toHaveURL(pageUrl(TEAM, created.id));
    const view = page.getByTestId("page-view");
    await expect(view).toContainText("Click here now");
    await expect(view.locator('[href^="javascript" i], [onclick], [onerror], script, iframe, svg')).toHaveCount(0);
    await view.getByText("para").click();
    expect(seen).toEqual({ errors: [], dialogs: [] });
  });
});

test.describe("unsafe links are refused", () => {
  test("the link dialog refuses javascript:, data: and vbscript: addresses and keeps the dialog open", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Link dialog" });
    await page.goto(editUrl(TEAM, created.id));
    const e = editorOf(page);
    await e.content.click();
    await page.keyboard.type("unsafe");
    await page.keyboard.press("Shift+Home");
    await e.toolbar.getByRole("button", { name: t("editor.link"), exact: true }).click();

    const dialog = page.getByRole("dialog", { name: t("editor.linkDialog.title") });
    const address = dialog.getByRole("textbox", { name: t("editor.linkDialog.url") });
    for (const bad of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "#top", "//evil.example/x"]) {
      await address.fill(bad);
      await dialog.getByRole("button", { name: t("editor.linkDialog.submit") }).click();
      await expect(dialog.getByRole("alert"), bad).toHaveText(t("editor.linkDialog.invalid"));
      await expect(address).toHaveAttribute("aria-invalid", "true");
    }
    await expect(e.content.getByRole("link")).toHaveCount(0);

    await address.fill("https://example.com/ok");
    await dialog.getByRole("button", { name: t("editor.linkDialog.submit") }).click();
    await expect(dialog).toHaveCount(0);
    await expect(e.content.getByRole("link", { name: "unsafe" })).toHaveAttribute("href", "https://example.com/ok");
  });

  test("the API refuses content with an unsafe link (RD-063, RD-068)", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "API links" });
    for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x", " https://example.com", "https:/\\evil"]) {
      const response = await page.request.put(pageApi(TEAM, created.id), {
        headers: SAME_ORIGIN,
        data: { title: "API links", baseVersion: 1, content: docOf(paragraph(text("click", [link(href)]))) },
      });
      expect(response.status(), href).toBe(422);
      expect(await response.json()).toMatchObject({ code: "VALIDATION" });
    }
  });
});

test.describe("files a browser could be talked into running", () => {
  const SVG = Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>`);

  test("an SVG is refused with the copy deck's message, however it is named", async ({ page }) => {
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "No SVG here" });
    await page.goto(pageUrl(TEAM, created.id));
    await page.getByRole("button", { name: t("pageMenu.attachments") }).click();
    const dialog = page.getByRole("dialog", { name: t("pageAttachments.title") });

    for (const file of [
      { name: "evil.svg", mimeType: "image/svg+xml" },
      { name: "disguised.png", mimeType: "image/png" }, // the bytes decide (RD-071)
    ]) {
      const chooser = page.waitForEvent("filechooser");
      await dialog.getByRole("button", { name: t("pageAttachments.upload") }).click();
      await (await chooser).setFiles({ ...file, buffer: SVG });
      await expect(dialog.getByRole("alert")).toHaveText(t("pageAttachments.upload.unsupported", { name: file.name }));
    }
    await expect(dialog.getByText(t("pageAttachments.empty"))).toBeVisible();

    // The editor's paste path says so in its own words.
    await page.goto(editUrl(TEAM, created.id));
    await editorOf(page).content.click();
    await pasteInto(editorOf(page).content, { files: [{ name: "pasted.svg", mimeType: "image/svg+xml", buffer: SVG }] });
    await expect(page.getByRole("region", { name: t("editor.upload.region") })).toContainText(t("editor.upload.unsupported", { name: "pasted.svg" }));
    await expect(editorOf(page).content.locator("img[src]")).toHaveCount(0);

    const api = await page.request.post(`${pageApi(TEAM, created.id)}/attachments`, {
      headers: SAME_ORIGIN,
      multipart: { file: { name: "evil.svg", mimeType: "image/svg+xml", buffer: SVG } },
    });
    expect(api.status()).toBe(415);
    expect(await api.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA" });
  });

  test("attachment bytes carry nosniff, a sandboxing CSP and private, no-cache; non-images only download", async ({ page }) => {
    const seen = forbidScript(page);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "Bytes page" });
    const png = await uploadViaApi(page.request, TEAM, created.id, { name: "pixel.png", mimeType: "image/png", buffer: PNG_1PX });
    const html = await uploadViaApi(page.request, TEAM, created.id, {
      name: "page.html",
      mimeType: "text/html",
      buffer: Buffer.from(`<html><body><script>alert("attachment")</script></body></html>`),
    });
    expect(png.image).toBe(true);
    expect(html.image).toBe(false);

    for (const [ref, type, disposition] of [
      [png, "image/png", /^inline;/],
      [html, "application/octet-stream", /^attachment;/],
    ] as const) {
      const response = await page.request.get(ref.url);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      expect(headers["cache-control"]).toBe("private, no-cache");
      expect(headers["content-type"]).toBe(type);
      expect(headers["content-disposition"]).toMatch(disposition);
      expect(headers.etag).toMatch(/^"[0-9a-f]{64}"$/);

      // Revalidation answers 304 with the same protections and no body (RD-072, RD-075).
      const again = await page.request.get(ref.url, { headers: { "If-None-Match": headers.etag ?? "" } });
      expect(again.status()).toBe(304);
      expect(again.headers()["x-content-type-options"]).toBe("nosniff");
      expect(again.headers()["cache-control"]).toBe("private, no-cache");
    }

    // Opening the HTML attachment in the browser downloads it; nothing runs.
    const download = page.waitForEvent("download");
    await page.goto(html.url).catch(() => undefined);
    expect((await download).suggestedFilename()).toBe("page.html");
    expect(seen).toEqual({ errors: [], dialogs: [] });
  });

  test("?format=html is escaped and served sandboxed", async ({ page }) => {
    const seen = forbidScript(page);
    await signIn(page, "bob");
    const created = await createPageViaApi(page.request, TEAM, { title: "HTML format" });
    await publishViaApi(page.request, TEAM, created.id, {
      title: "HTML format",
      baseVersion: 1,
      content: docOf(p(`<script>alert("fragment")</script>`), paragraph(text("a link", [link("https://example.com/")]))),
    });

    const response = await page.request.get(`${pageApi(TEAM, created.id)}?format=html`);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["content-security-policy"]).toBe("sandbox");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("private, no-store");
    const body = await response.text();
    expect(body.startsWith('<div class="rf-content">')).toBe(true);
    expect(body).toContain("&lt;script&gt;alert(&quot;fragment&quot;)&lt;/script&gt;");
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/\son[a-z]+=/i);

    await page.goto(`${pageApi(TEAM, created.id)}?format=html`);
    await expect(page.getByText(`<script>alert("fragment")</script>`)).toBeVisible();
    expect(seen).toEqual({ errors: [], dialogs: [] });
  });
});
