// loadEditorScreen against a real database: who gets the editor, who is sent to the page view,
// and who gets the 404 page (07 §2.4: editing needs space EDIT; RD-051: never reveal a page).
//
//            TEAM                        PLAT
//  alice   VIEW EDIT EXPORT ADMIN      VIEW EDIT EXPORT ADMIN
//  bob     VIEW EDIT EXPORT            VIEW
//  carol   VIEW                        — (cannot see the space at all)
// spec: docs/specs/10-ui-reference.md sections 5.1 and 11; docs/specs/09-decision-log.md sections RD-051, RD-055
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/actor";
import { deletePage, saveDraft } from "@/server/usecases/pages";
import { createPageAs, paragraphDoc } from "@/test-support/documents-fixtures";
import { actorFor, resetDemoInstance } from "@/test-support/fixtures";
import { loadEditorScreen } from "../load-editor";

let alice: Actor;
let bob: Actor;
let carol: Actor;

beforeEach(async () => {
  await resetDemoInstance();
  [alice, bob, carol] = await Promise.all([actorFor("alice"), actorFor("bob"), actorFor("carol")]);
});

describe("loadEditorScreen — the editor opens for EDIT", () => {
  it("opens the current version when the viewer has no draft", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec", versions: 2 });
    const screen = await loadEditorScreen(alice, "team", page.id);
    if (screen.kind !== "editor") throw new Error(`expected the editor, got ${screen.kind}`);
    expect(screen.windowTitle).toBe("Editing Spec");
    expect(screen.props).toMatchObject({
      space: { key: "TEAM", name: "Team" },
      page: { id: page.id, title: "Spec", ancestors: [], restricted: false },
      initial: { title: "Spec", baseVersion: 2, fromDraft: false },
      me: { id: alice.id, name: alice.name },
      viewHref: `/spaces/TEAM/pages/${page.id}`,
      historyHref: `/spaces/TEAM/pages/${page.id}/history`,
    });
    expect(screen.props.initial.content).toEqual(paragraphDoc("Spec v2"));
  });

  it("resumes the viewer's own draft (RD-055: Close keeps the draft)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await saveDraft(bob, "TEAM", page.id, { title: "Spec, reworded", content: paragraphDoc("draft"), baseVersion: 1 });
    const screen = await loadEditorScreen(bob, "TEAM", page.id);
    if (screen.kind !== "editor") throw new Error(`expected the editor, got ${screen.kind}`);
    expect(screen.props.initial).toMatchObject({ title: "Spec, reworded", baseVersion: 1, fromDraft: true });
    // Stored canonicalised (RD-063), so compare the text, not the input's exact shape.
    expect(JSON.stringify(screen.props.initial.content)).toContain('"text":"draft"');
    // The breadcrumb and window title keep the stored title (RD-078).
    expect(screen.props.page.title).toBe("Spec");
    expect(screen.windowTitle).toBe("Editing Spec");

    const other = await loadEditorScreen(alice, "TEAM", page.id);
    if (other.kind !== "editor") throw new Error(`expected the editor, got ${other.kind}`);
    expect(other.props.initial.fromDraft).toBe(false);
  });
});

describe("loadEditorScreen — no EDIT: the page view instead", () => {
  it("sends a viewer who can see the space but not edit it to the page view", async () => {
    const team = await createPageAs("alice", "team", { title: "Team page" });
    const plat = await createPageAs("alice", "plat", { title: "Platform page" });
    expect(await loadEditorScreen(carol, "TEAM", team.id)).toEqual({ kind: "view", href: `/spaces/TEAM/pages/${team.id}` });
    expect(await loadEditorScreen(bob, "PLAT", plat.id)).toEqual({ kind: "view", href: `/spaces/PLAT/pages/${plat.id}` });
  });

  it("gives that viewer the same answer for a page id that does not exist, so it reveals nothing", async () => {
    expect(await loadEditorScreen(carol, "TEAM", "nope")).toEqual({ kind: "view", href: "/spaces/TEAM/pages/nope" });
  });
});

describe("loadEditorScreen — not found (RD-051)", () => {
  it("a space the viewer cannot see, or that does not exist", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Secret" });
    expect(await loadEditorScreen(carol, "PLAT", plat.id)).toEqual({ kind: "missing" });
    expect(await loadEditorScreen(alice, "NOPE", plat.id)).toEqual({ kind: "missing" });
  });

  it("an unknown, deleted, or other-space page, for a viewer who can edit", async () => {
    const team = await createPageAs("alice", "team", { title: "Team page" });
    const doomed = await createPageAs("alice", "team", { title: "Doomed" });
    await deletePage(alice, "TEAM", doomed.id);
    expect(await loadEditorScreen(alice, "TEAM", "nope")).toEqual({ kind: "missing" });
    expect(await loadEditorScreen(alice, "TEAM", doomed.id)).toEqual({ kind: "missing" });
    expect(await loadEditorScreen(alice, "PLAT", team.id)).toEqual({ kind: "missing" });
  });
});
