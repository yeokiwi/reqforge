// The visibility matrix for pages: every repository reader of page data, for each demo user
// and for the grant shapes that matter. A page the viewer cannot see behaves exactly as if it
// did not exist — null, empty, or left out; never "forbidden".
// spec: docs/specs/07-permissions-and-limits.md section 2.1 (RD-051) and section 2.2 (rule X2); RD-058
import { beforeEach, describe, expect, it } from "vitest";
import { getAttachmentForRead, insertAttachment, listAttachments, allAttachmentIdsForPage, softDeleteAttachment } from "@/server/repositories/attachments";
import { countLiveDescendants, getPage, listPages, listTitlesInSpace } from "@/server/repositories/documents";
import { getDraft, upsertDraft } from "@/server/repositories/drafts";
import { listPresence, setWatching, touchPresence, watcherCount } from "@/server/repositories/social";
import { rootDb, transaction } from "@/server/repositories/transaction";
import { getVersion, listVersions } from "@/server/repositories/versions";
import { softDeleteSubtree } from "@/server/repositories/documents";
import { createPageAs, demoIds, paragraphDoc, type DemoIds, type SpaceHandle } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

interface Fixture {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly attachmentId: string;
  readonly hiddenAttachmentId: string;
}

const NOW = new Date("2026-10-09T12:00:00.000Z");
const WINDOW_START = new Date(NOW.getTime() - 45_000);

let ids: DemoIds;
let team: Fixture;
let plat: Fixture;

async function fixturePage(space: SpaceHandle, title: string): Promise<Fixture> {
  const page = await createPageAs("alice", space, { title, versions: 2 });
  await createPageAs("alice", space, { title: `${title} child`, parentId: page.id });
  const att = await insertAttachment(rootDb, {
    documentId: page.id,
    filename: "a.png",
    contentType: "image/png",
    data: new Uint8Array([1, 2, 3]),
    uploadedById: ids.users.alice,
  });
  const hidden = await insertAttachment(rootDb, {
    documentId: page.id,
    filename: "old.png",
    contentType: "image/png",
    data: new Uint8Array([4, 5, 6]),
    uploadedById: ids.users.alice,
  });
  await softDeleteAttachment(rootDb, page.id, hidden.id);
  for (const userId of Object.values(ids.users)) {
    await upsertDraft(rootDb, { documentId: page.id, userId, title, content: paragraphDoc("draft"), baseVersionNumber: 2 });
    await touchPresence(rootDb, page.id, userId, NOW);
  }
  return { id: page.id, spaceId: page.spaceId, title, attachmentId: att.id, hiddenAttachmentId: hidden.id };
}

beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
  team = await fixturePage("team", "Team page");
  plat = await fixturePage("plat", "Platform page");
});

/** What each reader reveals about `page` to `viewerId`: true = the page is there. */
async function probe(viewerId: string, page: Fixture): Promise<Record<string, boolean>> {
  return {
    listPages: (await listPages(rootDb, viewerId, page.spaceId)).some((p) => p.id === page.id),
    listTitlesInSpace: (await listTitlesInSpace(rootDb, viewerId, page.spaceId)).includes(page.title),
    getPage: (await getPage(rootDb, viewerId, page.id)) !== null,
    countLiveDescendants: (await countLiveDescendants(rootDb, viewerId, page.id)) !== null,
    listVersions: (await listVersions(rootDb, viewerId, page.id)) !== null,
    getVersion: (await getVersion(rootDb, viewerId, page.id, 1)) !== null,
    getDraft: (await getDraft(rootDb, viewerId, page.id)) !== null,
    listAttachments: (await listAttachments(rootDb, viewerId, page.id)) !== null,
    getAttachmentForRead: (await getAttachmentForRead(rootDb, viewerId, page.attachmentId)) !== null,
    getHiddenAttachmentForRead: (await getAttachmentForRead(rootDb, viewerId, page.hiddenAttachmentId)) !== null,
    allAttachmentIdsForPage: (await allAttachmentIdsForPage(rootDb, viewerId, page.id)).size > 0,
    listPresence: (await listPresence(rootDb, viewerId, page.id, WINDOW_START)).length > 0,
  };
}

const everywhere = (visible: boolean) =>
  Object.fromEntries(
    [
      "listPages",
      "listTitlesInSpace",
      "getPage",
      "countLiveDescendants",
      "listVersions",
      "getVersion",
      "getDraft",
      "listAttachments",
      "getAttachmentForRead",
      "getHiddenAttachmentForRead",
      "allAttachmentIdsForPage",
      "listPresence",
    ].map((k) => [k, visible]),
  );

describe("page visibility — the demo grants (07 §2.1, RD-051)", () => {
  it("alice (direct grants in both spaces) sees both pages through every reader", async () => {
    expect(await probe(ids.users.alice, team)).toEqual(everywhere(true));
    expect(await probe(ids.users.alice, plat)).toEqual(everywhere(true));
  });

  it("carol (VIEW on TEAM only) sees TEAM pages and nothing at all of PLAT pages", async () => {
    expect(await probe(ids.users.carol, team)).toEqual(everywhere(true));
    expect(await probe(ids.users.carol, plat)).toEqual(everywhere(false));
  });

  it("bob sees PLAT pages through the platform-viewers group", async () => {
    expect(await probe(ids.users.bob, plat)).toEqual(everywhere(true));
  });

  it("removing bob from the group hides PLAT pages from every reader", async () => {
    await prisma.groupMember.delete({ where: { groupId_userId: { groupId: ids.groupId, userId: ids.users.bob } } });
    expect(await probe(ids.users.bob, plat)).toEqual(everywhere(false));
    expect(await probe(ids.users.bob, team)).toEqual(everywhere(true)); // his direct TEAM grant is untouched
  });
});

describe("page visibility — grant shapes", () => {
  it("a membership with EDIT, EXPORT and ADMIN but not VIEW sees nothing", async () => {
    await prisma.membership.create({ data: { spaceId: ids.spaces.plat, userId: ids.users.carol, permissions: ["EDIT", "EXPORT", "ADMIN"] } });
    expect(await probe(ids.users.carol, plat)).toEqual(everywhere(false));
  });

  it("a group grant without VIEW sees nothing either", async () => {
    await prisma.membership.updateMany({ where: { spaceId: ids.spaces.plat, groupId: ids.groupId }, data: { permissions: ["EDIT"] } });
    expect(await probe(ids.users.bob, plat)).toEqual(everywhere(false));
  });

  it("grants combine as a union: VIEW through a group plus EDIT directly is visible", async () => {
    await prisma.membership.create({ data: { spaceId: ids.spaces.plat, userId: ids.users.carol, permissions: ["EDIT"] } });
    expect(await probe(ids.users.carol, plat)).toEqual(everywhere(false));
    await prisma.groupMember.create({ data: { groupId: ids.groupId, userId: ids.users.carol } });
    expect(await probe(ids.users.carol, plat)).toEqual(everywhere(true));
  });

  it("a VIEW grant in another space does not leak across spaces", async () => {
    // carol's TEAM grant must not open the PLAT page even when asked through the TEAM space id.
    expect((await listPages(rootDb, ids.users.carol, ids.spaces.team)).some((p) => p.id === plat.id)).toBe(false);
    expect(await getPage(rootDb, ids.users.carol, plat.id)).toBeNull();
  });
});

describe("an invisible page is indistinguishable from a missing or deleted one (rule X2)", () => {
  it("a page id that never existed answers exactly like an invisible page", async () => {
    const missing: Fixture = { ...plat, id: "no-such-page", attachmentId: "no-such-att", hiddenAttachmentId: "no-such-att-2", title: "nope" };
    expect(await probe(ids.users.carol, missing)).toEqual(await probe(ids.users.carol, plat));
  });

  it("a soft-deleted page disappears from every reader, even for alice", async () => {
    await transaction((tx) => softDeleteSubtree(tx, { documentId: team.id, deletedById: ids.users.alice }));
    expect(await probe(ids.users.alice, team)).toEqual(everywhere(false));
  });
});

describe("per-row visibility of OTHER users", () => {
  it("watcherCount counts only watchers who can still view the page", async () => {
    for (const userId of Object.values(ids.users)) await setWatching(rootDb, plat.id, userId, true);
    expect(await watcherCount(rootDb, plat.id)).toBe(2); // alice, bob — not carol
    expect(await watcherCount(rootDb, plat.id, { excludeUserId: ids.users.alice })).toBe(1);
    await prisma.groupMember.delete({ where: { groupId_userId: { groupId: ids.groupId, userId: ids.users.bob } } });
    expect(await watcherCount(rootDb, plat.id)).toBe(1);
  });

  it("listPresence never shows a user who cannot view the page, nor the viewer themselves", async () => {
    // Every demo user has a heartbeat on the PLAT page; carol cannot view it.
    const seenByAlice = await listPresence(rootDb, ids.users.alice, plat.id, WINDOW_START);
    expect(seenByAlice.map((u) => u.id)).toEqual([ids.users.bob]);
    const seenByBob = await listPresence(rootDb, ids.users.bob, plat.id, WINDOW_START);
    expect(seenByBob.map((u) => u.id)).toEqual([ids.users.alice]);
  });
});
