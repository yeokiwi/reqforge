// loadPageScreen against a real database: what the page view route renders from, and every way
// it becomes the 404 page (RD-051: a viewer without access never learns the page exists).
//
//            TEAM                        PLAT
//  alice   VIEW EDIT EXPORT ADMIN      VIEW EDIT EXPORT ADMIN
//  bob     VIEW EDIT EXPORT            VIEW
//  carol   VIEW                        — (cannot see the space at all)
// spec: docs/specs/10-ui-reference.md sections 4 and 11; docs/specs/09-decision-log.md sections RD-051, RD-055, RD-060
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { deletePage, saveDraft } from "@/server/usecases/pages";
import { buildTree, createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { actorFor, resetDemoInstance } from "@/test-support/fixtures";
import { loadPageScreen } from "../load-page";

let alice: Actor;
let bob: Actor;
let carol: Actor;

beforeEach(async () => {
  await resetDemoInstance();
  [alice, bob, carol] = await Promise.all([actorFor("alice"), actorFor("bob"), actorFor("carol")]);
});

async function notFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(NotFoundError);
}

describe("loadPageScreen — the current version", () => {
  it("loads the page and its current version, with the canonical space key (the tree is the frame's, not loaded here)", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Product", children: [{ title: "Specifications" }, { title: "Glossary" }] }]);
    const id = ids["Specifications"] ?? "";

    const screen = await loadPageScreen(alice, "team", id);

    expect(screen.space).toEqual({ key: "TEAM", name: "Team" });
    expect(screen.page).toMatchObject({
      id,
      title: "Specifications",
      spaceKey: "TEAM",
      ancestors: [{ id: ids["Product"], title: "Product" }],
      currentVersion: 1,
      permissions: { canEdit: true, canAdmin: true },
      hasDraft: false,
    });
    expect(screen.page.createdBy.name).toBe("Alice Admin");
    expect(screen.version).toMatchObject({ number: 1, title: "Specifications", current: true });
    expect(screen.version.content).toEqual(paragraphDoc("Specifications v1"));
    expect(Object.keys(screen).sort()).toEqual(["page", "space", "version"]);
  });

  it("tells a viewer without EDIT what they may do: carol in TEAM, bob in PLAT", async () => {
    const team = await createPageAs("alice", "team", { title: "Team page" });
    const plat = await createPageAs("alice", "plat", { title: "Platform page" });
    expect((await loadPageScreen(carol, "TEAM", team.id)).page.permissions).toEqual({ canEdit: false, canAdmin: false });
    expect((await loadPageScreen(bob, "TEAM", team.id)).page.permissions).toEqual({ canEdit: true, canAdmin: false });
    expect((await loadPageScreen(bob, "PLAT", plat.id)).page.permissions).toEqual({ canEdit: false, canAdmin: false });
  });

  it("reports the caller's own draft only (the draft notice, RD-055)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(bob, "TEAM", page.id, { title: "Spec", content: paragraphDoc("draft"), baseVersion: 1 });
    expect((await loadPageScreen(bob, "TEAM", page.id)).page.hasDraft).toBe(true);
    expect((await loadPageScreen(alice, "TEAM", page.id)).page.hasDraft).toBe(false);
  });

  it("counts only live pages under the page (the Delete confirmation re-reads this when it opens)", async () => {
    const ids = await buildTree("alice", "team", [{ title: "Keep", children: [{ title: "Child" }, { title: "Gone", children: [{ title: "Gone child" }] }] }]);
    await deletePage(alice, "TEAM", ids["Gone"] ?? "");
    const screen = await loadPageScreen(alice, "TEAM", ids["Keep"] ?? "");
    expect(screen.page.descendantCount).toBe(1);
  });
});

describe("loadPageScreen — a past version (RD-060)", () => {
  it("loads that version's title and content, read-only, with the page as it is now", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 3 });
    const screen = await loadPageScreen(alice, "TEAM", page.id, 1);
    expect(screen.version).toMatchObject({ number: 1, current: false, title: "Spec" });
    expect(screen.version.content).toEqual(paragraphDoc("Spec v1"));
    expect(screen.page.currentVersion).toBe(3);
  });

  it("naming the current version by number is the current version", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    expect((await loadPageScreen(alice, "TEAM", page.id, 2)).version.current).toBe(true);
  });

  it("a version the page does not have is not found", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    await notFound(loadPageScreen(alice, "TEAM", page.id, 3));
    await notFound(loadPageScreen(alice, "TEAM", page.id, 2_147_483_647));
  });
});

describe("loadPageScreen — not found, never forbidden (RD-051)", () => {
  it("a space the viewer cannot see is not found, even for a real page in it", async () => {
    const page = await createPageAs("alice", "plat", { title: "Secret" });
    await notFound(loadPageScreen(carol, "PLAT", page.id));
  });

  it("an unknown space is not found", async () => {
    await notFound(loadPageScreen(alice, "NOPE", "p1"));
  });

  it("a page of another space, addressed through this one, is not found (the IDOR check)", async () => {
    const page = await createPageAs("alice", "team", { title: "Team only" });
    await notFound(loadPageScreen(alice, "PLAT", page.id));
  });

  it("an unknown, malformed or deleted page is not found", async () => {
    const page = await createPageAs("alice", "team", { title: "Doomed" });
    await notFound(loadPageScreen(alice, "TEAM", "c0000000000000000000000000"));
    await notFound(loadPageScreen(alice, "TEAM", "../etc/passwd"));
    await deletePage(alice, "TEAM", page.id);
    await notFound(loadPageScreen(alice, "TEAM", page.id));
  });
});
