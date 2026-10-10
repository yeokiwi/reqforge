// The permission matrix of every pages use case (07 §2.1 and §2.4, RD-051, 08 §3):
//
//            TEAM                        PLAT
//  alice   VIEW EDIT EXPORT ADMIN      VIEW EDIT EXPORT ADMIN
//  bob     VIEW EDIT EXPORT            VIEW  (through the platform-viewers group)
//  carol   VIEW                        — (cannot see the space at all)
//
// A space the caller cannot see is 404 NOT_FOUND; a visible space without the permission is
// 403 FORBIDDEN; and a page id of one space addressed through another space's key is 404 for
// everyone (the IDOR check). A refused call writes nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import {
  compareVersions,
  copyPage,
  createPage,
  deletePage,
  deleteVersion,
  discardDraft,
  getDraft,
  getEditorState,
  getPageView,
  getVersion,
  heartbeatPresence,
  hideAttachment,
  listAttachments,
  listPageTree,
  listPeople,
  listVersions,
  movePage,
  publishPage,
  readAttachment,
  renamePage,
  restoreVersion,
  saveDraft,
  setFavourite,
  setWatching,
  uploadAttachment,
} from "@/server/usecases/pages";
import { createPageAs, freshTitle, paragraphDoc, type SpaceHandle } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance, type Handle } from "@/test-support/fixtures";
import { actors, pngBytes, rejection, uploadPng, type Actors } from "./support";

type Need = "VIEW" | "EDIT" | "ADMIN";

const GRANTS: Readonly<Record<SpaceHandle, Readonly<Record<Handle, readonly Need[]>>>> = {
  team: { alice: ["VIEW", "EDIT", "ADMIN"], bob: ["VIEW", "EDIT"], carol: ["VIEW"] },
  plat: { alice: ["VIEW", "EDIT", "ADMIN"], bob: ["VIEW"], carol: [] },
};
const KEY: Readonly<Record<SpaceHandle, string>> = { team: "TEAM", plat: "PLAT" };

type Outcome = "ok" | "FORBIDDEN" | "NOT_FOUND";

function expected(handle: Handle, space: SpaceHandle, need: Need): Outcome {
  const grants = GRANTS[space][handle];
  if (!grants.includes("VIEW")) return "NOT_FOUND";
  return grants.includes(need) ? "ok" : "FORBIDDEN";
}

interface Fixture {
  readonly pageId: string;
  readonly attachmentId: string;
}

interface Op {
  readonly name: string;
  readonly need: Need;
  /** False for operations addressed to the space only (no page id in the URL). */
  readonly pageScoped: boolean;
  readonly run: (actor: Actor, spaceKey: string, fx: Fixture) => Promise<unknown>;
}

const OPS: readonly Op[] = [
  { name: "listPageTree", need: "VIEW", pageScoped: false, run: (a, k) => listPageTree(a, k) },
  { name: "listPeople", need: "VIEW", pageScoped: false, run: (a, k) => listPeople(a, k, "") },
  { name: "getPageView", need: "VIEW", pageScoped: true, run: (a, k, f) => getPageView(a, k, f.pageId) },
  { name: "getPageView ?version", need: "VIEW", pageScoped: true, run: (a, k, f) => getPageView(a, k, f.pageId, 1) },
  { name: "listVersions", need: "VIEW", pageScoped: true, run: (a, k, f) => listVersions(a, k, f.pageId) },
  { name: "getVersion", need: "VIEW", pageScoped: true, run: (a, k, f) => getVersion(a, k, f.pageId, 1) },
  { name: "compareVersions", need: "VIEW", pageScoped: true, run: (a, k, f) => compareVersions(a, k, f.pageId, 1, 2) },
  { name: "setWatching", need: "VIEW", pageScoped: true, run: (a, k, f) => setWatching(a, k, f.pageId, true) },
  { name: "setFavourite", need: "VIEW", pageScoped: true, run: (a, k, f) => setFavourite(a, k, f.pageId, true) },
  { name: "heartbeatPresence", need: "VIEW", pageScoped: true, run: (a, k, f) => heartbeatPresence(a, k, f.pageId) },
  { name: "listAttachments", need: "VIEW", pageScoped: true, run: (a, k, f) => listAttachments(a, k, f.pageId) },
  { name: "createPage", need: "EDIT", pageScoped: false, run: (a, k) => createPage(a, k, { title: freshTitle("Created") }) },
  { name: "getEditorState", need: "EDIT", pageScoped: true, run: (a, k, f) => getEditorState(a, k, f.pageId) },
  {
    name: "publishPage",
    need: "EDIT",
    pageScoped: true,
    run: (a, k, f) => publishPage(a, k, f.pageId, { title: freshTitle("Published"), content: paragraphDoc("x"), baseVersion: 2 }),
  },
  { name: "renamePage", need: "EDIT", pageScoped: true, run: (a, k, f) => renamePage(a, k, f.pageId, { title: freshTitle("Renamed") }) },
  { name: "movePage", need: "EDIT", pageScoped: true, run: (a, k, f) => movePage(a, k, f.pageId, { parentId: null, index: 0 }) },
  { name: "copyPage", need: "EDIT", pageScoped: true, run: (a, k, f) => copyPage(a, k, f.pageId) },
  { name: "deletePage", need: "EDIT", pageScoped: true, run: (a, k, f) => deletePage(a, k, f.pageId) },
  { name: "getDraft", need: "EDIT", pageScoped: true, run: (a, k, f) => getDraft(a, k, f.pageId) },
  {
    name: "saveDraft",
    need: "EDIT",
    pageScoped: true,
    run: (a, k, f) => saveDraft(a, k, f.pageId, { title: "Draft", content: paragraphDoc("d"), baseVersion: 2 }),
  },
  { name: "discardDraft", need: "EDIT", pageScoped: true, run: (a, k, f) => discardDraft(a, k, f.pageId) },
  { name: "restoreVersion", need: "EDIT", pageScoped: true, run: (a, k, f) => restoreVersion(a, k, f.pageId, 1) },
  {
    name: "uploadAttachment",
    need: "EDIT",
    pageScoped: true,
    run: (a, k, f) => uploadAttachment(a, k, f.pageId, { filename: "x.png", bytes: pngBytes() }),
  },
  { name: "hideAttachment", need: "EDIT", pageScoped: true, run: (a, k, f) => hideAttachment(a, k, f.pageId, f.attachmentId) },
  { name: "deleteVersion", need: "ADMIN", pageScoped: true, run: (a, k, f) => deleteVersion(a, k, f.pageId, 1) },
];

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

/** A fresh page with two versions and one attachment, made by alice (who may do anything). */
async function fixture(space: SpaceHandle): Promise<Fixture> {
  const page = await createPageAs("alice", space, { versions: 2 });
  const att = await uploadPng(who.alice, KEY[space], page.id);
  return { pageId: page.id, attachmentId: att.id };
}

async function outcomeOf(promise: Promise<unknown>): Promise<Outcome | string> {
  try {
    await promise;
    return "ok";
  } catch (e) {
    if (e instanceof NotFoundError) return "NOT_FOUND";
    if (e instanceof ForbiddenError) return "FORBIDDEN";
    return `unexpected ${String(e)}`;
  }
}

const writeCount = async () =>
  (await prisma.auditEvent.count()) + (await prisma.documentVersion.count()) + (await prisma.documentDraft.count()) + (await prisma.attachment.count());

describe.each(OPS)("$name needs $need", (op) => {
  it("answers each caller in each space per the matrix, and a refusal writes nothing", async () => {
    const results: string[] = [];
    const wanted: string[] = [];
    for (const space of ["team", "plat"] as const) {
      for (const handle of ["alice", "bob", "carol"] as const) {
        const fx = await fixture(space);
        const before = await writeCount();
        const outcome = await outcomeOf(op.run(who[handle], KEY[space], fx));
        results.push(`${handle}@${space}: ${outcome}`);
        wanted.push(`${handle}@${space}: ${expected(handle, space, op.need)}`);
        if (outcome !== "ok") expect(await writeCount(), `${handle}@${space} wrote something`).toBe(before);
      }
    }
    expect(results).toEqual(wanted);
  });

  it.runIf(op.pageScoped)("never reaches a page of another space through this one's key (IDOR)", async () => {
    // Alice can do anything in both spaces; bob can edit TEAM but only view PLAT. Neither may reach a
    // PLAT page through TEAM's key — the URL's space decides the permissions, so it must own the page.
    // The space permission is decided first, for every page id alike: a caller who lacks it in the
    // URL's space gets that 403 whatever the id; a caller who has it gets 404 for the foreign page.
    for (const handle of ["alice", "bob"] as const) {
      const fx = await fixture("plat");
      const before = await writeCount();
      const inTeam = expected(handle, "team", op.need);
      expect(await outcomeOf(op.run(who[handle], "TEAM", fx)), handle).toBe(inTeam === "ok" ? "NOT_FOUND" : inTeam);
      expect(await writeCount()).toBe(before);
    }
  });

  it.runIf(op.pageScoped)("answers a caller without the permission the same for every page id, so it reveals nothing", async () => {
    const fx = await fixture("team");
    const forbidden = (["alice", "bob", "carol"] as const).filter((h) => expected(h, "team", op.need) === "FORBIDDEN");
    for (const handle of forbidden) {
      const real = await outcomeOf(op.run(who[handle], "TEAM", fx));
      const unknown = await outcomeOf(op.run(who[handle], "TEAM", { ...fx, pageId: "c0000000000000000000000000" }));
      expect([real, unknown]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    }
  });

  it.runIf(op.pageScoped)("is NOT_FOUND for an unknown, malformed or deleted page", async () => {
    const fx = await fixture("team");
    for (const pageId of ["c0000000000000000000000000", "../x", "a b", "x".repeat(65)]) {
      expect(await outcomeOf(op.run(who.alice, "TEAM", { ...fx, pageId }))).toBe("NOT_FOUND");
    }
    await deletePage(who.alice, "TEAM", fx.pageId);
    expect(await outcomeOf(op.run(who.alice, "TEAM", fx))).toBe("NOT_FOUND");
  });
});

describe("readAttachment needs VIEW on the attachment's page", () => {
  it("serves it to everyone who can view the space and is NOT_FOUND for everyone else", async () => {
    const results: string[] = [];
    const wanted: string[] = [];
    for (const space of ["team", "plat"] as const) {
      const fx = await fixture(space);
      for (const handle of ["alice", "bob", "carol"] as const) {
        results.push(`${handle}@${space}: ${await outcomeOf(readAttachment(who[handle], fx.attachmentId))}`);
        wanted.push(`${handle}@${space}: ${expected(handle, space, "VIEW")}`);
      }
    }
    expect(results).toEqual(wanted);
    expect(await rejection(readAttachment(who.alice, "c0000000000000000000000000"))).toBeInstanceOf(NotFoundError);
  });
});
