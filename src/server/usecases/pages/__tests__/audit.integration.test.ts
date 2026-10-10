// 07 §6: every state-changing operation writes an audit row — actor, at, object, operation,
// parameters — and the operation can be reconstructed from it. Reads and personal state
// (drafts, watching, favourites, presence) write none.
import { beforeEach, describe, expect, it } from "vitest";
import {
  copyPage,
  createPage,
  deletePage,
  deleteVersion,
  discardDraft,
  getDraft,
  getEditorState,
  getPageView,
  heartbeatPresence,
  hideAttachment,
  listAttachments,
  listPageTree,
  listVersions,
  movePage,
  publishPage,
  renamePage,
  restoreVersion,
  saveDraft,
  setFavourite,
  setWatching,
} from "@/server/usecases/pages";
import { demoIds, paragraphDoc } from "@/test-support/documents-fixtures";
import { resetDemoInstance } from "@/test-support/fixtures";
import { TEAM, actors, auditRows, imageDoc, uploadPng, type Actors } from "./support";

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

describe("the audit trail of a page's life", () => {
  it("has exactly one row per state change, in order, with what an auditor would ask", async () => {
    const teamId = (await demoIds()).spaces.team;

    const first = await createPage(who.alice, TEAM, { title: "First" });
    const page = await createPage(who.bob, TEAM, { title: "Spec", parentId: first.id });
    const image = await uploadPng(who.bob, TEAM, page.id, "diagram.png");
    await setWatching(who.carol, TEAM, page.id, true);
    await publishPage(who.bob, TEAM, page.id, { title: "Spec", content: imageDoc(image), baseVersion: 1, message: "added a diagram", notifyWatchers: true });
    await renamePage(who.bob, TEAM, page.id, { title: "Specification" });
    await movePage(who.alice, TEAM, page.id, { parentId: null, index: 0 });
    const copy = await copyPage(who.bob, TEAM, page.id);
    await restoreVersion(who.bob, TEAM, page.id, 1);
    await deleteVersion(who.alice, TEAM, page.id, 2);
    await hideAttachment(who.bob, TEAM, page.id, image.id);
    await deletePage(who.alice, TEAM, first.id);

    // None of these write an audit row.
    await getPageView(who.carol, TEAM, page.id);
    await listPageTree(who.carol, TEAM);
    await listVersions(who.carol, TEAM, page.id);
    await listAttachments(who.carol, TEAM, page.id);
    await getEditorState(who.bob, TEAM, page.id);
    await saveDraft(who.bob, TEAM, page.id, { title: "x", content: paragraphDoc("x"), baseVersion: 4 });
    await getDraft(who.bob, TEAM, page.id);
    await discardDraft(who.bob, TEAM, page.id);
    await setFavourite(who.carol, TEAM, page.id, true);
    await heartbeatPresence(who.carol, TEAM, page.id);

    const rows = await auditRows();
    expect(rows.map((r) => [r.operation, r.objectType, r.objectId, r.actorId])).toEqual([
      ["page.create", "page", first.id, who.alice.id],
      ["page.create", "page", page.id, who.bob.id],
      ["attachment.upload", "attachment", image.id, who.bob.id],
      ["page.update", "page", page.id, who.bob.id],
      ["page.rename", "page", page.id, who.bob.id],
      ["page.move", "page", page.id, who.alice.id],
      ["page.copy", "page", copy.id, who.bob.id],
      ["page.restore-version", "page", page.id, who.bob.id],
      ["page.delete-version", "page", page.id, who.alice.id],
      ["attachment.delete", "attachment", image.id, who.bob.id],
      ["page.delete", "page", first.id, who.alice.id],
    ]);
    for (const r of rows) {
      expect(r.spaceId).toBe(teamId);
      expect(r.at).toBeInstanceOf(Date);
    }

    const params = rows.map((r) => r.parameters);
    expect(params[1]).toMatchObject({ title: "Spec", parentId: first.id, version: 1 });
    expect(params[2]).toMatchObject({ pageId: page.id, filename: "diagram.png", contentType: "image/png" });
    // Publish: the version, its base, the note, and how many watchers a notification would reach —
    // carol; bob watches as the creator but is the publisher, so he is left out (RD-061).
    expect(params[3]).toMatchObject({ version: 2, baseVersion: 1, message: "added a diagram", notifyWatchers: true, watcherCount: 1 });
    expect(params[4]).toEqual({ from: "Spec", to: "Specification", version: 3 });
    expect(params[5]).toMatchObject({ from: { parentId: first.id, ordinal: 0 }, to: { parentId: null, ordinal: 0 } });
    expect(params[6]).toMatchObject({ sourceId: page.id, sourceVersion: 3, title: "Copy of Specification" });
    expect(params[7]).toMatchObject({ restoredFrom: 1, version: 4, previousVersion: 3 });
    expect(params[8]).toMatchObject({ version: 2, title: "Spec" });
    expect(params[9]).toEqual({ pageId: page.id });
    expect(params[10]).toMatchObject({ title: "First", deletedCount: 1 });
  });
});
