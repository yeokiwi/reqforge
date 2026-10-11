// The `···` dialogs' requests against the REAL route handlers and database: the very calls the
// dialogs make (page-requests.ts through callApi), with the bodies their helpers compute — the
// Move index, the suggested copy title, the delete count — so the client's side of 08 §3 and the
// server's cannot drift apart unnoticed.
//
//            TEAM
//  alice   VIEW EDIT EXPORT ADMIN
//  bob     VIEW EDIT EXPORT
//  carol   VIEW
// spec: docs/specs/08-api-surface.md section 3; docs/specs/09-decision-log.md sections RD-056, RD-058, RD-067, RD-071, RD-072, RD-074
import { beforeEach, describe, expect, it } from "vitest";
import * as attachmentRoute from "@/app/api/v1/spaces/[spaceKey]/pages/[id]/attachments/[attachmentId]/route";
import * as attachmentsRoute from "@/app/api/v1/spaces/[spaceKey]/pages/[id]/attachments/route";
import * as copyRoute from "@/app/api/v1/spaces/[spaceKey]/pages/[id]/copy/route";
import * as moveRoute from "@/app/api/v1/spaces/[spaceKey]/pages/[id]/move/route";
import * as pageRoute from "@/app/api/v1/spaces/[spaceKey]/pages/[id]/route";
import { t } from "@/copy";
import type { Actor } from "@/server/authz/actor";
import { getPageView, listPageTree } from "@/server/usecases/pages";
import { apiRequest, routeContext, sessionFor } from "@/test-support/api-harness";
import { buildTree } from "@/test-support/documents-fixtures";
import { actorFor, resetDemoInstance, type Handle } from "@/test-support/fixtures";
import { ApiError, type FetchLike } from "@/ui/api-client";
import { suggestCopyTitle } from "../copy-suggestion";
import { copyFailure, deleteConfirmation, uploadFailureMessage } from "../dialog-messages";
import { moveBodyFor, moveTargets } from "../move-targets";
import { fetchAttachments, requestCopy, requestDelete, requestHide, requestMove, requestUpload } from "../page-requests";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** A browser's fetch, but answered by the route handlers in-process, signed in as `handle`. */
async function browserAs(handle: Handle): Promise<FetchLike> {
  const session = await sessionFor(handle);
  return async (url, init) => {
    const method = init?.method ?? "GET";
    const match = /^\/api\/v1\/spaces\/([^/]+)\/pages\/([^/]+)(?:\/(copy|move|attachments)(?:\/([^/]+))?)?$/.exec(url);
    if (!match) throw new Error(`no route for ${url}`);
    const [, spaceKey = "", id = "", tail, attachmentId] = match;
    const params: Record<string, string> = { spaceKey: decodeURIComponent(spaceKey), id: decodeURIComponent(id) };
    let module: Partial<Record<string, Handler>>;
    if (tail === undefined) module = pageRoute as Partial<Record<string, Handler>>;
    else if (tail === "copy") module = copyRoute as Partial<Record<string, Handler>>;
    else if (tail === "move") module = moveRoute as Partial<Record<string, Handler>>;
    else if (attachmentId === undefined) module = attachmentsRoute as Partial<Record<string, Handler>>;
    else {
      module = attachmentRoute as Partial<Record<string, Handler>>;
      params.attachmentId = decodeURIComponent(attachmentId);
    }
    const handler = module[method];
    if (handler === undefined) throw new Error(`${url} serves no ${method}`);
    const request = apiRequest(method, url, {
      session,
      body: init?.body ?? undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return handler(request, routeContext(params));
  };
}

let alice: Actor;

beforeEach(async () => {
  await resetDemoInstance();
  alice = await actorFor("alice");
});

async function tree() {
  return (await listPageTree(alice, "TEAM")).pages;
}

describe("Move: { parentId, index } puts the page last, where the dialog said", () => {
  it("under another page, and at the top level", async () => {
    const ids = await buildTree("alice", "team", [
      { title: "Product", children: [{ title: "Specifications", children: [{ title: "Detail" }] }, { title: "Glossary" }] },
      { title: "Team notes", children: [{ title: "Minutes" }] },
    ]);
    const spec = ids["Specifications"] ?? "";
    const bob = await browserAs("bob");

    // The dialog never offers the page or its descendants; everything it offers, the API accepts.
    const offered = moveTargets(await tree(), spec, ids["Product"] ?? null);
    expect(offered.map((target) => target.title)).toEqual(["", "Product", "Glossary", "Team notes", "Minutes"]);

    await requestMove("TEAM", spec, moveBodyFor(await tree(), spec, ids["Team notes"] ?? null), bob);
    let pages = await tree();
    const underNotes = pages.filter((p) => p.parentId === ids["Team notes"]).sort((a, b) => a.ordinal - b.ordinal);
    expect(underNotes.map((p) => p.title)).toEqual(["Minutes", "Specifications"]);
    expect(pages.find((p) => p.id === ids["Detail"])?.parentId).toBe(spec);

    await requestMove("TEAM", spec, moveBodyFor(pages, spec, null), bob);
    pages = await tree();
    const roots = pages.filter((p) => p.parentId === null).sort((a, b) => a.ordinal - b.ordinal);
    expect(roots.map((p) => p.title)).toEqual(["Product", "Team notes", "Specifications"]);
  });

  it("under its own descendant is CYCLE; a viewer without EDIT is FORBIDDEN", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Top", children: [{ title: "Child" }] }]);
    const top = ids["Top"] ?? "";
    const cycle = await requestMove("TEAM", top, { parentId: ids["Child"] ?? "", index: 0 }, await browserAs("bob")).catch((e: unknown) => e);
    expect(cycle).toBeInstanceOf(ApiError);
    expect(cycle).toMatchObject({ code: "CYCLE" });
    const forbidden = await requestMove("TEAM", top, { parentId: null, index: 1 }, await browserAs("carol")).catch((e: unknown) => e);
    expect(forbidden).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Copy: the suggested title is the one the page gets", () => {
  it("copies one page, not its children, as the suggestion, last among its siblings", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Product", children: [{ title: "Spec", children: [{ title: "Spec child" }] }, { title: "Other" }] }]);
    const suggestion = suggestCopyTitle("Spec", await tree());
    expect(suggestion).toBe("Copy of Spec");

    const copyId = await requestCopy("TEAM", ids["Spec"] ?? "", suggestion, await browserAs("bob"));
    expect(copyId).not.toBeNull();
    const pages = await tree();
    const copy = pages.find((p) => p.id === copyId);
    expect(copy).toMatchObject({ title: "Copy of Spec", parentId: ids["Product"] });
    const siblings = pages.filter((p) => p.parentId === ids["Product"]).sort((a, b) => a.ordinal - b.ordinal);
    expect(siblings.map((p) => p.title)).toEqual(["Spec", "Other", "Copy of Spec"]);
    expect(pages.filter((p) => p.parentId === copyId)).toEqual([]);

    // The next suggestion skips the title now taken.
    expect(suggestCopyTitle("Spec", pages)).toBe("Copy of Spec 2");
  });

  it("a title already taken (any case) is TITLE_TAKEN, shown under the field", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Spec" }, { title: "Copy of Spec" }]);
    const error = await requestCopy("TEAM", ids["Spec"] ?? "", "COPY OF SPEC", await browserAs("bob")).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "TITLE_TAKEN" });
    expect(copyFailure(error)).toEqual({ where: "field", message: t("pageCopy.field.taken") });
  });

  it("a viewer without EDIT is FORBIDDEN", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Spec" }]);
    const error = await requestCopy("TEAM", ids["Spec"] ?? "", "Mine", await browserAs("carol")).catch((e: unknown) => e);
    expect(copyFailure(error)).toEqual({ where: "alert", message: t("pageCopy.forbidden") });
  });
});

describe("Delete: the confirmation's count is what goes", () => {
  it("deletedCount is 1 + descendantCount", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Root", children: [{ title: "A", children: [{ title: "A1" }] }, { title: "B" }] }]);
    const root = ids["Root"] ?? "";
    const { page } = await getPageView(alice, "TEAM", root);
    expect(page.descendantCount).toBe(3);
    expect(deleteConfirmation(page.descendantCount)).toContain("4 pages");
    expect(await requestDelete("TEAM", root, await browserAs("bob"))).toBe(4);
    expect(await tree()).toEqual([]);
  });

  it("a viewer without EDIT is FORBIDDEN, and nothing goes", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Keep" }]);
    const error = await requestDelete("TEAM", ids["Keep"] ?? "", await browserAs("carol")).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect((await tree()).map((p) => p.title)).toEqual(["Keep"]);
  });
});

// A 1×1 PNG.
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

describe("Attachments: upload, list, hide", () => {
  it("an image uploads as multipart `file`, is listed with image: true, and Hide takes it off the list", async () => {
    const ids = await buildTree("alice", "team", [{ title: "With files" }]);
    const id = ids["With files"] ?? "";
    const bob = await browserAs("bob");

    await requestUpload("TEAM", id, new Blob([PNG], { type: "image/png" }), "dot.png", bob);
    await requestUpload("TEAM", id, new Blob(["plain text"], { type: "text/plain" }), "notes.txt", bob);
    const listed = await fetchAttachments("TEAM", id, bob);
    expect(listed.map((a) => [a.filename, a.image])).toEqual([
      ["notes.txt", false],
      ["dot.png", true],
    ]);
    const dot = listed.find((a) => a.filename === "dot.png");
    expect(dot?.url).toMatch(/^\/api\/v1\/attachments\/[^/]+\/dot\.png$/);

    await requestHide("TEAM", id, dot?.id ?? "", bob);
    expect((await fetchAttachments("TEAM", id, bob)).map((a) => a.filename)).toEqual(["notes.txt"]);
  });

  it("an SVG is refused as UNSUPPORTED_MEDIA and an empty file as VALIDATION, worded as the dialog says", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Files" }]);
    const id = ids["Files"] ?? "";
    const bob = await browserAs("bob");
    const svg = await requestUpload("TEAM", id, new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>']), "x.svg", bob).catch((e: unknown) => e);
    expect(svg).toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    expect(uploadFailureMessage(svg, "x.svg")).toBe(t("pageAttachments.upload.unsupported", { name: "x.svg" }));
    const empty = await requestUpload("TEAM", id, new Blob([]), "empty.txt", bob).catch((e: unknown) => e);
    expect(empty).toMatchObject({ code: "VALIDATION" });
    expect(uploadFailureMessage(empty, "empty.txt")).toBe(t("pageAttachments.upload.empty", { name: "empty.txt" }));
  });

  it("a viewer without EDIT may list but not upload or hide", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Files" }]);
    const id = ids["Files"] ?? "";
    await requestUpload("TEAM", id, new Blob(["x"]), "a.txt", await browserAs("alice"));
    const carol = await browserAs("carol");
    const [only] = await fetchAttachments("TEAM", id, carol);
    expect(only?.filename).toBe("a.txt");
    await expect(requestUpload("TEAM", id, new Blob(["y"]), "b.txt", carol)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestHide("TEAM", id, only?.id ?? "", carol)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
