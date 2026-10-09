import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/domain/errors";
import { getShellContext } from "@/server/usecases/shell";
import {
  chooseLandingSpace,
  getSpace,
  listMySpaces,
  openSpace,
  setFavourite,
  setSidebarCollapsedFor,
} from "@/server/usecases/spaces";
import { DEMO, actorFor, prisma, resetDemoInstance } from "@/test-support/fixtures";

const TEAM = DEMO.spaces.team.key;
const PLAT = DEMO.spaces.plat.key;

beforeEach(resetDemoInstance);

describe("which spaces a user can see (spec 07 §2, rule X2)", () => {
  it("shows each demo user exactly their spaces", async () => {
    const keys = async (h: "alice" | "bob" | "carol") => (await listMySpaces(await actorFor(h))).map((s) => s.key).sort();
    expect(await keys("alice")).toEqual([PLAT, TEAM]);
    expect(await keys("bob")).toEqual([PLAT, TEAM]); // PLAT through the group
    expect(await keys("carol")).toEqual([TEAM]);
  });

  it("answers 'not found' — not 'forbidden' — for a space the user cannot see", async () => {
    await expect(getSpace(await actorFor("carol"), PLAT)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers the same for a space that does not exist", async () => {
    const carol = await actorFor("carol");
    const rejection = (p: Promise<unknown>) =>
      p.then(
        () => {
          throw new Error("expected the promise to reject");
        },
        (e: unknown) => e as Error,
      );
    const hidden = await rejection(getSpace(carol, PLAT));
    const missing = await rejection(getSpace(carol, "NOSUCH"));
    expect(missing.constructor).toBe(hidden.constructor);
    expect(missing.message.replace("NOSUCH", "")).toBe(hidden.message.replace(PLAT, ""));
  });

  it("looks keys up case-insensitively", async () => {
    expect((await getSpace(await actorFor("alice"), "team")).key).toBe(TEAM);
  });

  it.each(["", "a", "../../etc", "TEAM;DROP", "x".repeat(40), "TEAM\n"])("rejects the malformed key %j without a query", async (key) => {
    await expect(getSpace(await actorFor("alice"), key)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("derives permissions from direct and group grants", async () => {
    const bob = await actorFor("bob");
    expect((await getSpace(bob, TEAM)).access).toMatchObject({ canView: true, canEdit: true, canExport: true, canAdmin: false });
    expect((await getSpace(bob, PLAT)).access).toMatchObject({ canView: true, canEdit: false, canExport: false, canAdmin: false });
    expect((await getSpace(await actorFor("carol"), TEAM)).access).toMatchObject({ canView: true, canEdit: false });
    expect((await getSpace(await actorFor("alice"), PLAT)).access.canAdmin).toBe(true);
  });

  it("a membership without VIEW does not make the space visible", async () => {
    const carol = await actorFor("carol");
    const plat = await prisma.space.findUniqueOrThrow({ where: { key: PLAT } });
    await prisma.membership.create({ data: { spaceId: plat.id, userId: carol.id, permissions: ["EDIT", "ADMIN"] } });
    await expect(getSpace(carol, PLAT)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listMySpaces(carol)).map((s) => s.key)).toEqual([TEAM]);
  });

  it("EDIT in one membership plus VIEW in another combine", async () => {
    const carol = await actorFor("carol");
    const team = await prisma.space.findUniqueOrThrow({ where: { key: TEAM } });
    const group = await prisma.group.create({ data: { name: "extra" } });
    await prisma.groupMember.create({ data: { groupId: group.id, userId: carol.id } });
    await prisma.membership.create({ data: { spaceId: team.id, groupId: group.id, permissions: ["EDIT"] } });
    expect((await getSpace(carol, TEAM)).access).toMatchObject({ canView: true, canEdit: true });
  });

  it("removing a user from a group removes the access the group gave", async () => {
    const bob = await actorFor("bob");
    await prisma.groupMember.deleteMany({ where: { userId: bob.id } });
    expect((await listMySpaces(bob)).map((s) => s.key)).toEqual([TEAM]);
  });
});

describe("the shell context (spec 10 §2–3)", () => {
  it("offers Create only the spaces the user can edit", async () => {
    const creatable = async (h: "alice" | "bob" | "carol") =>
      (await getShellContext(await actorFor(h))).creatableSpaces.map((s) => s.key).sort();
    expect(await creatable("alice")).toEqual([PLAT, TEAM]);
    expect(await creatable("bob")).toEqual([TEAM]);
    expect(await creatable("carol")).toEqual([]);
  });

  it("lists recently viewed spaces, newest first, and only those", async () => {
    const alice = await actorFor("alice");
    expect((await getShellContext(alice)).recentSpaces).toEqual([]);
    await openSpace(alice, TEAM, () => new Date("2026-10-09T09:00:00Z"));
    await openSpace(alice, PLAT, () => new Date("2026-10-09T10:00:00Z"));
    expect((await getShellContext(alice)).recentSpaces.map((s) => s.key)).toEqual([PLAT, TEAM]);
    await openSpace(alice, TEAM, () => new Date("2026-10-09T11:00:00Z"));
    expect((await getShellContext(alice)).recentSpaces.map((s) => s.key)).toEqual([TEAM, PLAT]);
  });

  it("puts the space being viewed first, even before its visit has been recorded", async () => {
    const alice = await actorFor("alice");
    await openSpace(alice, PLAT, () => new Date("2026-10-09T09:00:00Z"));
    // TEAM has never been opened: the layout asks for the shell before the page records the visit.
    expect((await getShellContext(alice, TEAM)).recentSpaces.map((s) => s.key)).toEqual([TEAM, PLAT]);
    // Already-recorded or not, the space appears exactly once.
    await openSpace(alice, TEAM, () => new Date("2026-10-09T08:00:00Z"));
    expect((await getShellContext(alice, TEAM)).recentSpaces.map((s) => s.key)).toEqual([TEAM, PLAT]);
  });

  it("one user's recents and stars are invisible to another", async () => {
    const alice = await actorFor("alice");
    const bob = await actorFor("bob");
    await openSpace(alice, TEAM);
    await setFavourite(alice, TEAM, true);
    expect((await getShellContext(bob)).recentSpaces).toEqual([]);
    expect((await getSpace(bob, TEAM)).favourite).toBe(false);
  });

  it("includes the current space with its permissions, or null off a space", async () => {
    const bob = await actorFor("bob");
    expect((await getShellContext(bob)).space).toBeNull();
    const ctx = await getShellContext(bob, "plat");
    expect(ctx.space).toMatchObject({ key: PLAT, name: "Platform", access: { canEdit: false } });
  });

  it("refuses a shell for a space the user cannot see", async () => {
    await expect(getShellContext(await actorFor("carol"), PLAT)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("per-user sidebar state (spec 10 §3.2)", () => {
  it("remembers collapsed/expanded per user", async () => {
    const alice = await actorFor("alice");
    expect(alice.sidebarCollapsed).toBe(false);
    await setSidebarCollapsedFor(alice, true);
    expect((await actorFor("alice")).sidebarCollapsed).toBe(true);
    expect((await actorFor("bob")).sidebarCollapsed).toBe(false);
    await setSidebarCollapsedFor(alice, false);
    expect((await actorFor("alice")).sidebarCollapsed).toBe(false);
  });

  it("stars and un-stars a space, and starred spaces list first", async () => {
    const alice = await actorFor("alice");
    expect((await listMySpaces(alice)).map((s) => s.key)).toEqual([PLAT, TEAM]); // by name: Platform, Team
    await setFavourite(alice, TEAM, true);
    expect((await listMySpaces(alice)).map((s) => s.key)).toEqual([TEAM, PLAT]);
    await setFavourite(alice, TEAM, false);
    expect((await listMySpaces(alice)).map((s) => s.key)).toEqual([PLAT, TEAM]);
  });

  it("cannot star a space the user cannot see", async () => {
    await expect(setFavourite(await actorFor("carol"), PLAT, true)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.userSpaceState.count()).toBe(0);
  });
});

describe("landing space for /", () => {
  it("is the last visited space", async () => {
    const alice = await actorFor("alice");
    await openSpace(alice, TEAM, () => new Date("2026-10-09T09:00:00Z"));
    await openSpace(alice, PLAT, () => new Date("2026-10-09T10:00:00Z"));
    expect((await chooseLandingSpace(alice))?.key).toBe(PLAT);
  });

  it("falls back to a starred space, then to the first by name", async () => {
    const alice = await actorFor("alice");
    expect((await chooseLandingSpace(alice))?.key).toBe(PLAT); // Platform < Team
    await setFavourite(alice, TEAM, true);
    expect((await chooseLandingSpace(alice))?.key).toBe(TEAM);
  });

  it("is null for a user who can see no spaces", async () => {
    const carol = await actorFor("carol");
    await prisma.membership.deleteMany({ where: { userId: carol.id } });
    expect(await chooseLandingSpace(carol)).toBeNull();
  });
});
