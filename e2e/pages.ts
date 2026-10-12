// Helpers for the slice-1 end-to-end specs (PLAN.md slice 1):
//   - the pages API (08 §3) called through a signed-in browser context, with the same-site
//     Origin a browser would send (RD-064) — for set-up, and for the API assertions;
//   - fast set-up straight in the e2e database for the large fixtures (a 2,000-page tree,
//     a 200-version page) that would take minutes through the API;
//   - ProseMirror content builders, paste and drop events, the axe check and the GUI-review
//     screenshots.
// Every test starts from a freshly seeded demo instance (fixtures.ts), so nothing here cleans up.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import {
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
  type TestInfo,
  expect,
} from "@playwright/test";
import type {
  AttachmentRef,
  GetPageResponse,
  PageDetail,
  PageSummary,
  PublishResponse,
  VersionSummary,
} from "../src/domain/documents/api-types";
import { t } from "../src/copy";
import { DEMO, signIn } from "./fixtures";

export type { AttachmentRef, GetPageResponse, PageDetail, PageSummary, PublishResponse, VersionSummary };
export type Handle = keyof typeof DEMO.users;

export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://localhost:${PORT}`;
/** What a same-site browser sends with a state-changing request; the API refuses one without it (RD-064). */
export const SAME_ORIGIN: Readonly<Record<string, string>> = { Origin: BASE_URL };

export const TEAM = DEMO.spaces.team.key;
export const PLAT = DEMO.spaces.plat.key;

// ----------------------------------------------------------------------------------- URLs

const enc = encodeURIComponent;
export const pagesApi = (space: string) => `/api/v1/spaces/${enc(space)}/pages`;
export const pageApi = (space: string, id: string) => `${pagesApi(space)}/${enc(id)}`;
export const pageUrl = (space: string, id: string) => `/spaces/${enc(space)}/pages/${enc(id)}`;
export const editUrl = (space: string, id: string) => `${pageUrl(space, id)}/edit`;
export const historyUrl = (space: string, id: string) => `${pageUrl(space, id)}/history`;
export const compareUrl = (space: string, id: string, a: number, b: number) => `${historyUrl(space, id)}/compare?a=${a}&b=${b}`;

/** A URL regex for the page view of `id` (no `/edit`, no `/history`). */
export const pageViewPattern = (space: string, id: string) => new RegExp(`/spaces/${space}/pages/${id}(\\?.*)?$`);

// ------------------------------------------------------------------------------- the API

async function expectStatus(response: APIResponse, status: number): Promise<void> {
  if (response.status() !== status) {
    throw new Error(`${response.url()} answered ${response.status()}, expected ${status}: ${await response.text()}`);
  }
}

/** The JSON body of a response that must have `status`. */
async function bodyOf<T>(response: APIResponse, status: number): Promise<T> {
  await expectStatus(response, status);
  return (await response.json()) as T;
}

export async function createPageViaApi(request: APIRequestContext, space: string, body: { title?: string; parentId?: string | null } = {}): Promise<PageDetail> {
  return bodyOf<PageDetail>(await request.post(pagesApi(space), { headers: SAME_ORIGIN, data: body }), 201);
}

export interface PublishInput {
  readonly title: string;
  readonly content: unknown;
  readonly baseVersion: number;
  readonly message?: string;
  readonly overwrite?: boolean;
}

export async function publishViaApi(request: APIRequestContext, space: string, id: string, input: PublishInput): Promise<PublishResponse> {
  return bodyOf<PublishResponse>(await request.put(pageApi(space, id), { headers: SAME_ORIGIN, data: input }), 200);
}

export async function getPageViaApi(request: APIRequestContext, space: string, id: string, version?: number): Promise<GetPageResponse> {
  const query = version === undefined ? "" : `?version=${version}`;
  return bodyOf<GetPageResponse>(await request.get(`${pageApi(space, id)}${query}`), 200);
}

export async function listPagesViaApi(request: APIRequestContext, space: string): Promise<PageSummary[]> {
  return bodyOf<PageSummary[]>(await request.get(pagesApi(space)), 200);
}

export async function listVersionsViaApi(request: APIRequestContext, space: string, id: string): Promise<VersionSummary[]> {
  return bodyOf<VersionSummary[]>(await request.get(`${pageApi(space, id)}/versions`), 200);
}

export interface FileInput {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

export async function uploadViaApi(request: APIRequestContext, space: string, id: string, file: FileInput): Promise<AttachmentRef> {
  const response = await request.post(`${pageApi(space, id)}/attachments`, { headers: SAME_ORIGIN, multipart: { file } });
  return bodyOf<AttachmentRef>(response, 201);
}

/** A tree of pages made through the API, pre-order; returns title → page. */
export interface TreeSpec {
  readonly title: string;
  readonly children?: readonly TreeSpec[];
}

export async function createTreeViaApi(
  request: APIRequestContext,
  space: string,
  roots: readonly TreeSpec[],
  parentId: string | null = null,
): Promise<Record<string, PageDetail>> {
  const out: Record<string, PageDetail> = {};
  for (const node of roots) {
    const page = await createPageViaApi(request, space, { title: node.title, parentId });
    out[node.title] = page;
    if (node.children) Object.assign(out, await createTreeViaApi(request, space, node.children, page.id));
  }
  return out;
}

/** Publishes `contents` one after another on top of the page's current version; returns the last answer. */
export async function publishSeries(
  request: APIRequestContext,
  space: string,
  page: { readonly id: string; readonly title: string; readonly currentVersion: number },
  versions: readonly { readonly content: unknown; readonly message?: string; readonly title?: string }[],
): Promise<PublishResponse | null> {
  let base = page.currentVersion;
  let last: PublishResponse | null = null;
  for (const version of versions) {
    last = await publishViaApi(request, space, page.id, {
      title: version.title ?? page.title,
      content: version.content,
      baseVersion: base,
      ...(version.message === undefined ? {} : { message: version.message }),
    });
    base = last.version.number;
  }
  return last;
}

// ------------------------------------------------------------------------------- content

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Mark = { type: string; attrs?: { [key: string]: Json } };

export const text = (value: string, marks?: Mark[]): Json => (marks && marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value });
export const paragraph = (...inline: Json[]): Json => (inline.length > 0 ? { type: "paragraph", content: inline } : { type: "paragraph" });
export const p = (value: string): Json => paragraph(text(value));
export const heading = (level: number, value: string): Json => ({ type: "heading", attrs: { level }, content: [text(value)] });
export const docOf = (...blocks: Json[]): Json => ({ type: "doc", content: blocks.length > 0 ? blocks : [paragraph()] });
export const paragraphs = (...values: string[]): Json => docOf(...values.map(p));
export const link = (href: string): Mark => ({ type: "link", attrs: { href } });
export const image = (ref: { readonly id: string; readonly url: string }, alt = ""): Json => ({
  type: "image",
  attrs: { attachmentId: ref.id, src: ref.url, alt },
});

export const strong = (value: string): Json => text(value, [{ type: "bold" }]);
export const em = (value: string): Json => text(value, [{ type: "italic" }]);
export const listOf = (type: "bulletList" | "orderedList", items: readonly string[]): Json => ({
  type,
  content: items.map((item) => ({ type: "listItem", content: [p(item)] })),
});
export const taskListOf = (items: readonly (readonly [string, boolean])[]): Json => ({
  type: "taskList",
  content: items.map(([item, checked]) => ({ type: "taskItem", attrs: { checked }, content: [p(item)] })),
});
export const codeBlock = (code: string): Json => ({ type: "codeBlock", content: [text(code)] });
/** A table whose first row is a header row (as the editor makes them, RD-078). */
export const tableOf = (header: readonly string[], rows: readonly (readonly string[])[]): Json => ({
  type: "table",
  content: [
    { type: "tableRow", content: header.map((cell) => ({ type: "tableHeader", content: [p(cell)] })) },
    ...rows.map((row) => ({ type: "tableRow", content: row.map((cell) => ({ type: "tableCell", content: [p(cell)] })) })),
  ],
});

/**
 * The page the video shows at 0:19 and 1:46, in our words: headings, a requirements-shaped table
 * with a header row, lists, a task list, a link and a code block (no requirement macros yet:
 * they are slice 2).
 */
export function specificationsDoc(): Json {
  return docOf(
    heading(2, "Business Requirements"),
    tableOf(
      ["Requirement", "Description", "Owner"],
      [
        ["BR-01", "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut iaculis maximus orci, et iaculis quam porta in.", "Albert"],
        ["BR-02", "Suspendisse egestas neque eget placerat imperdiet. Etiam lacus massa, interdum quis egestas in, laoreet eu velit.", "Albert"],
        ["BR-03", "Quisque vitae dolor at velit rutrum aliquet. Donec ac sollicitudin est.", "John"],
        ["BR-04", "Maecenas ultricies eros velit, tempor interdum nulla sodales vitae.", "Patricia"],
      ],
    ),
    heading(2, "Functional Requirements"),
    paragraph(text("Each function is "), strong("traceable"), text(" to a business requirement and "), em("tested"), text(".")),
    listOf("bulletList", ["Requirements are written in tables", "Each requirement has an owner"]),
    listOf("orderedList", ["Draft the page", "Review it", "Publish a version"]),
    taskListOf([
      ["Write the acceptance tests", true],
      ["Review with the customer", false],
    ]),
    paragraph(text("See "), text("the specification guide", [link("https://example.com/guide")]), text(" for the conventions.")),
    codeBlock("npm run build"),
  );
}

/** The canonical empty document (emptyDocument() in src/editor/schema), for rows written with SQL. */
export const EMPTY_CANONICAL_DOC = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: null, indent: 0 } }] };

// --------------------------------------------------------------------------------- bytes

/** The smallest valid PNG: one transparent pixel. Decided an image from its bytes (RD-071). */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==",
  "base64",
);

/** A small but visible PNG: `size`×`size` pixels of one colour, made without an image library. */
export function solidPng(size: number, rgb: readonly [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, () => Buffer.from(rgb)))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  // A stored (uncompressed) deflate stream: zlib header, one final stored block per 65535 bytes, Adler-32.
  const blocks: Buffer[] = [];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const piece = raw.subarray(at, at + 65535);
    const head = Buffer.alloc(5);
    head[0] = at + 65535 >= raw.length ? 1 : 0;
    head.writeUInt16LE(piece.length, 1);
    head.writeUInt16LE(piece.length ^ 0xffff, 3);
    blocks.push(head, piece);
    if (raw.length === 0) break;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  const zlib = Buffer.concat([Buffer.from([0x78, 0x01]), ...blocks, adler]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const sha256 = (bytes: Buffer | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// ------------------------------------------------------------------------------ browsers

/** A second, independent browser session signed in as `handle` (its own cookies and storage). */
export async function signedInContext(browser: Browser, handle: Handle, next?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await signIn(page, handle, next);
  return { context, page };
}

/** Fails the test on any page error or any JavaScript dialog (alert, confirm, prompt) — script must never run. */
export function forbidScript(page: Page): { readonly errors: string[]; readonly dialogs: string[] } {
  const seen = { errors: [] as string[], dialogs: [] as string[] };
  page.on("pageerror", (error) => seen.errors.push(error.message));
  page.on("dialog", (dialog) => {
    if (dialog.type() !== "beforeunload") seen.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  return seen;
}

// --------------------------------------------------------------------------- the page view

/**
 * The page view below its header row: banners, title, byline, content and footer. The header
 * row (breadcrumb, byline icons, actions, `···`) is chrome and carries SVG icons, so checks for
 * what the CONTENT may contain must not include it.
 */
export const pageBody = (page: Page): Locator => page.getByTestId("page-view").locator(':scope > :not([data-testid="page-header"])');

/** The page view's breadcrumb (10 §4.1). */
export const viewBreadcrumb = (page: Page): Locator => page.getByRole("navigation", { name: t("pageView.breadcrumb") });

/** The texts of the breadcrumb's links: `Pages` and the ancestors, root first (RD-084). */
export async function breadcrumbLinks(page: Page): Promise<string[]> {
  return viewBreadcrumb(page)
    .getByRole("link")
    .evaluateAll((links) => links.map((a) => (a.textContent ?? "").trim()));
}

// ----------------------------------------------------------------------------- the tree

/** The expanded sidebar's PAGE TREE (10 §3.2). */
export const sidebarTree = (page: Page): Locator =>
  page.getByRole("complementary", { name: t("sidebar.nav") }).getByRole("tree", { name: t("tree.label") });
/** The space overview's tree (10 §11). */
export const overviewTree = (page: Page, spaceName = "Team"): Locator => page.getByRole("tree", { name: t("overview.tree", { space: spaceName }) });
export const treeItem = (tree: Locator, title: string): Locator => tree.getByRole("treeitem", { name: title, exact: true });
/** The row of a treeitem: the draggable part (chevron, title, "+"), without its children. */
export const treeRow = (treeitem: Locator): Locator => treeitem.locator(":scope > div");

export const isMoveResponse = (response: Response): boolean =>
  response.request().method() === "POST" && /\/pages\/[^/]+\/move$/.test(new URL(response.url()).pathname);

/** Titles of the treeitems drawn at `level`, in order (a closed parent's children are not drawn). */
export async function titlesAt(tree: Locator, level: number): Promise<string[]> {
  return tree.locator(`[role="treeitem"][aria-level="${level}"]`).evaluateAll((items) =>
    items.map((li) => document.getElementById(li.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""),
  );
}

/** Drags a row onto another with a real mouse path; `zone` picks the drop position (RD-082). */
export async function dragRow(page: Page, source: Locator, target: Locator, zone: "before" | "inside" | "after"): Promise<Response> {
  const box = await treeRow(target).boundingBox();
  if (box === null) throw new Error("drop target is not on screen");
  const y = zone === "before" ? 2 : zone === "after" ? box.height - 2 : box.height / 2;
  const moved = page.waitForResponse(isMoveResponse);
  await treeRow(source).dragTo(treeRow(target), { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: Math.min(120, box.width / 2), y } });
  return moved;
}

// ----------------------------------------------------------------------------- the editor

/**
 * Clicks a text block of the editor so that the caret lands at its start or its end. ProseMirror
 * ignores DOM selection changes for about 50 ms after it handles a click, so a Home/End/Ctrl+End
 * sent by the test straight after a click can move the browser's caret while the editor keeps the
 * click position, and the next key acts there (seen: Enter splitting `npm run build` mid-word).
 * Placing the caret with the click itself has no such window.
 */
export async function clickAtEdge(block: Locator, edge: "start" | "end"): Promise<void> {
  const box = await block.boundingBox();
  if (box === null) throw new Error("text block is not on screen");
  const inset = Math.min(box.height / 2, 8);
  await block.click({ position: edge === "start" ? { x: 1, y: inset } : { x: Math.max(1, box.width - 1), y: box.height - inset } });
}

/** The editor's content area (role textbox, named from the copy deck). */
export const editorContent = (page: Page, name: string): Locator => page.getByRole("textbox", { name });

/**
 * Pastes into the editor the way a browser does: a `paste` ClipboardEvent whose DataTransfer
 * carries text, HTML and/or files. ProseMirror reads `event.clipboardData`, so this exercises
 * the editor's real paste path (transformPastedHTML, handlePaste, the upload of files).
 */
export async function pasteInto(
  target: Locator,
  data: { readonly text?: string; readonly html?: string; readonly files?: readonly FileInput[] },
): Promise<void> {
  const payload = {
    text: data.text ?? null,
    html: data.html ?? null,
    files: (data.files ?? []).map((f) => ({ name: f.name, type: f.mimeType, base64: f.buffer.toString("base64") })),
  };
  await target.evaluate((element, input) => {
    const transfer = new DataTransfer();
    if (input.text !== null) transfer.setData("text/plain", input.text);
    if (input.html !== null) transfer.setData("text/html", input.html);
    for (const file of input.files) {
      const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
    }
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, payload);
}

/** Drops files on the editor at a point inside it (dragenter, dragover, drop — what a file drag delivers). */
export async function dropFilesOn(target: Locator, files: readonly FileInput[], at: { readonly x: number; readonly y: number }): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, type: f.mimeType, base64: f.buffer.toString("base64") }));
  await target.evaluate(
    (element, input) => {
      const transfer = new DataTransfer();
      for (const file of input.files) {
        const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const rect = element.getBoundingClientRect();
      const init = { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: rect.left + input.x, clientY: rect.top + input.y };
      element.dispatchEvent(new DragEvent("dragenter", init));
      element.dispatchEvent(new DragEvent("dragover", init));
      element.dispatchEvent(new DragEvent("drop", init));
    },
    { files: payload, x: at.x, y: at.y },
  );
}

// ------------------------------------------------------------------------- the database

/**
 * Direct database access for set-up that would be slow through the API. Only for creating rows
 * the application could have created itself — never to bypass a rule under test.
 */
export async function withDatabase<T>(work: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = new PrismaClient();
  try {
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function ids(prisma: PrismaClient, space: string, handle: Handle): Promise<{ spaceId: string; userId: string }> {
  const s = await prisma.space.findUniqueOrThrow({ where: { key: space }, select: { id: true } });
  const u = await prisma.user.findUniqueOrThrow({ where: { email: DEMO.users[handle].email }, select: { id: true } });
  return { spaceId: s.id, userId: u.id };
}

export interface SeededTree {
  /** Root ids in order. */
  readonly roots: readonly string[];
  /** Child ids per root, in order. */
  readonly children: readonly (readonly string[])[];
  /** `${titlePrefix} 007` for root 7, `${titlePrefix} 007.012` for its 12th child (wider when there are 1,000 or more). */
  readonly title: (root: number, child?: number) => string;
}

/**
 * Writes a two-level tree straight into the database: `roots` root pages after the space's
 * existing roots, each with `childrenPerRoot` children, every page with an empty first version
 * — the rows `POST /pages` would write, minus the audit trail. Ids are `${idPrefix}-r007-c012`.
 */
export async function seedPageTree(
  space: string,
  handle: Handle,
  spec: { readonly idPrefix: string; readonly titlePrefix: string; readonly roots: number; readonly childrenPerRoot: number },
): Promise<SeededTree> {
  // At least 3 digits, and enough for the largest number (Postgres lpad would cut `1000` to `100`).
  const width = Math.max(3, String(Math.max(spec.roots, spec.childrenPerRoot)).length);
  const pad = (n: number) => String(n).padStart(width, "0");
  const title = (root: number, child?: number) => (child === undefined ? `${spec.titlePrefix} ${pad(root)}` : `${spec.titlePrefix} ${pad(root)}.${pad(child)}`);
  const rootId = (r: number) => `${spec.idPrefix}-r${pad(r)}`;
  const childId = (r: number, c: number) => `${rootId(r)}-c${pad(c)}`;
  const empty = JSON.stringify(EMPTY_CANONICAL_DOC);
  await withDatabase(async (prisma) => {
    const { spaceId, userId } = await ids(prisma, space, handle);
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "Document" ("id", "spaceId", "parentId", "title", "ordinal", "createdById")
          SELECT ${spec.idPrefix} || '-r' || lpad(r::text, ${width}::int, '0'), ${spaceId}, NULL,
                 ${spec.titlePrefix} || ' ' || lpad(r::text, ${width}::int, '0'),
                 (SELECT count(*) FROM "Document" WHERE "spaceId" = ${spaceId} AND "parentId" IS NULL AND "deletedAt" IS NULL)::int + r - 1,
                 ${userId}
          FROM generate_series(1, ${spec.roots}::int) AS r`;
        if (spec.childrenPerRoot > 0) {
          await tx.$executeRaw`
            INSERT INTO "Document" ("id", "spaceId", "parentId", "title", "ordinal", "createdById")
            SELECT ${spec.idPrefix} || '-r' || lpad(r::text, ${width}::int, '0') || '-c' || lpad(c::text, ${width}::int, '0'), ${spaceId},
                   ${spec.idPrefix} || '-r' || lpad(r::text, ${width}::int, '0'),
                   ${spec.titlePrefix} || ' ' || lpad(r::text, ${width}::int, '0') || '.' || lpad(c::text, ${width}::int, '0'),
                   c - 1, ${userId}
            FROM generate_series(1, ${spec.roots}::int) AS r, generate_series(1, ${spec.childrenPerRoot}::int) AS c`;
        }
        await tx.$executeRaw`
          INSERT INTO "DocumentVersion" ("id", "documentId", "number", "title", "content", "authorId")
          SELECT d."id" || '-v1', d."id", 1, d."title", ${empty}::jsonb, ${userId}
          FROM "Document" d WHERE d."spaceId" = ${spaceId} AND d."id" LIKE ${`${spec.idPrefix}-%`}`;
        await tx.$executeRaw`
          UPDATE "Document" SET "currentVersionId" = "id" || '-v1'
          WHERE "spaceId" = ${spaceId} AND "id" LIKE ${`${spec.idPrefix}-%`}`;
      },
      { timeout: 120_000 },
    );
  });
  const roots = Array.from({ length: spec.roots }, (_, i) => rootId(i + 1));
  const children = roots.map((_, i) => Array.from({ length: spec.childrenPerRoot }, (_, j) => childId(i + 1, j + 1)));
  return { roots, children, title };
}

/**
 * Appends `count` versions to a page straight in the database (what `count` Updates would
 * write, minus the audit rows): the current title and content, the note `Change n`, a minute
 * apart and in the past, the last one current.
 */
export async function seedVersions(pageId: string, handle: Handle, count: number): Promise<number> {
  return withDatabase(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO.users[handle].email }, select: { id: true } });
    return prisma.$transaction(
      async (tx) => {
        const doc = await tx.document.findUniqueOrThrow({ where: { id: pageId }, include: { currentVersion: true } });
        const current = doc.currentVersion;
        if (!current) throw new Error(`page ${pageId} has no current version`);
        await tx.$executeRaw`
          INSERT INTO "DocumentVersion" ("id", "documentId", "number", "title", "content", "authorId", "message", "createdAt")
          SELECT ${pageId} || '-sv' || n, ${pageId}, ${current.number}::int + n, ${current.title}, ${JSON.stringify(current.content)}::jsonb,
                 ${user.id}, 'Change ' || (${current.number}::int + n), now() - ((${count}::int - n) * interval '1 minute')
          FROM generate_series(1, ${count}::int) AS n`;
        const last = current.number + count;
        await tx.$executeRaw`UPDATE "Document" SET "currentVersionId" = ${`${pageId}-sv${count}`} WHERE "id" = ${pageId}`;
        return last;
      },
      { timeout: 120_000 },
    );
  });
}

// -------------------------------------------------------------------------- accessibility

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

/**
 * Runs axe on the page as it is now. Serious and critical violations fail the test (softly, so
 * every screen of a test is reported); every violation is attached to the report and logged.
 */
export async function checkA11y(page: Page, testInfo: TestInfo, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  const describe = (v: (typeof results.violations)[number]) => {
    const first = v.nodes[0];
    const why = first ? [...first.any, ...first.all, ...first.none].map((check) => check.message).find((m) => m.length > 0) : undefined;
    return `${v.impact ?? "unknown"} ${v.id}: ${v.help} — ${v.nodes
      .slice(0, 5)
      .map((n) => n.target.join(" "))
      .join(" | ")}${v.nodes.length > 5 ? ` (+${v.nodes.length - 5} more)` : ""}${why ? ` — first: ${why}` : ""}`;
  };
  if (results.violations.length > 0) {
    await testInfo.attach(`axe-${screen}`, { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });
    for (const v of results.violations) console.log(`[axe ${screen}] ${describe(v)}`);
  }
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map(describe);
  expect.soft(blocking, `axe: serious or critical WCAG 2.1 AA violations on "${screen}"`).toEqual([]);
}

// ---------------------------------------------------------------------------- GUI review

export const GUI_REVIEW_DIR = "test-results/gui-review/slice-1";

/** Saves a GUI-review screenshot (10 §0: reviewed side by side with the reference frames). */
export async function shoot(target: Page | Locator, file: string): Promise<string> {
  mkdirSync(GUI_REVIEW_DIR, { recursive: true });
  const path = `${GUI_REVIEW_DIR}/${file}`;
  await target.screenshot({ path, animations: "disabled", caret: "hide" });
  return path;
}
