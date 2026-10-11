// setWatching, setFavourite, heartbeatPresence, listPeople.
// spec: 08 §3 (watch, favourite, presence, GET /people); 07 §6 (audit); RD-061 (watching, save for later), RD-062 (presence), RD-070
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@/domain/documents";
import { NotFoundError, ValidationError } from "@/domain/errors";
import { deletePage, getPageView, heartbeatPresence, listPeople, setFavourite, setWatching } from "@/server/usecases/pages";
import { createPageAs, demoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";
import { PLAT, TEAM, actors, auditRows, expectError, type Actors } from "./support";

let who: Actors;
beforeEach(async () => {
  await resetDemoInstance();
  who = await actors();
});

describe("setWatching and setFavourite (RD-061)", () => {
  it("are idempotent per-user toggles, shown in the caller's PageDetail only", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await setWatching(who.carol, TEAM, page.id, true);
    await setWatching(who.carol, TEAM, page.id, true);
    await setFavourite(who.carol, TEAM, page.id, true);
    await setFavourite(who.carol, TEAM, page.id, true);
    expect((await getPageView(who.carol, TEAM, page.id)).page).toMatchObject({ watching: true, favourite: true });
    expect((await getPageView(who.bob, TEAM, page.id)).page).toMatchObject({ watching: false, favourite: false });
    expect(await prisma.documentWatch.count({ where: { documentId: page.id } })).toBe(1);

    await setWatching(who.carol, TEAM, page.id, false);
    await setWatching(who.carol, TEAM, page.id, false);
    await setFavourite(who.carol, TEAM, page.id, false);
    expect((await getPageView(who.carol, TEAM, page.id)).page).toMatchObject({ watching: false, favourite: false });
  });

  it("write an audit row for each change, and none for a toggle that changes nothing (07 §6)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    const teamId = (await demoIds()).spaces.team;
    for (const on of [true, false]) {
      await setWatching(who.carol, TEAM, page.id, on);
      await setWatching(who.carol, TEAM, page.id, on);
      await setFavourite(who.carol, TEAM, page.id, on);
      await setFavourite(who.carol, TEAM, page.id, on);
    }
    // Turning off what was never on changes nothing either.
    await setWatching(who.bob, TEAM, page.id, false);
    await setFavourite(who.bob, TEAM, page.id, false);
    const rows = await auditRows();
    expect(rows.map((r) => [r.operation, r.objectType, r.objectId, r.actorId, r.spaceId])).toEqual([
      ["page.watch", "page", page.id, who.carol.id, teamId],
      ["page.favourite", "page", page.id, who.carol.id, teamId],
      ["page.unwatch", "page", page.id, who.carol.id, teamId],
      ["page.unfavourite", "page", page.id, who.carol.id, teamId],
    ]);
  });

  it("audit a change made by a read-only member too, and nothing for a refused one", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await setWatching(who.bob, PLAT, plat.id, true);
    await expectError(setFavourite(who.carol, PLAT, plat.id, true), NotFoundError);
    expect((await auditRows()).map((r) => [r.operation, r.actorId])).toEqual([["page.watch", who.bob.id]]);
  });

  it("need only VIEW: a read-only member may watch and save", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await setWatching(who.bob, PLAT, plat.id, true);
    await setFavourite(who.bob, PLAT, plat.id, true);
    expect((await getPageView(who.bob, PLAT, plat.id)).page).toMatchObject({ watching: true, favourite: true });
  });

  it("are NotFound for a hidden space, a deleted page, and a page of another space (IDOR)", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(setWatching(who.carol, PLAT, plat.id, true), NotFoundError);
    await expectError(setFavourite(who.carol, TEAM, plat.id, true), NotFoundError);
    await expectError(setWatching(who.alice, TEAM, plat.id, true), NotFoundError);
    const gone = await createPageAs("alice", "team", { title: "Gone" });
    await deletePage(who.alice, TEAM, gone.id);
    await expectError(setWatching(who.alice, TEAM, gone.id, true), NotFoundError);
    expect(await prisma.documentWatch.count()).toBe(0);
    expect(await prisma.documentFavourite.count()).toBe(0);
  });
});

describe("heartbeatPresence (RD-062)", () => {
  const t0 = new Date();
  const at = (ms: number) => () => new Date(t0.getTime() + ms);

  it("records the caller and returns the OTHER users present, never the caller", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    expect(await heartbeatPresence(who.alice, TEAM, page.id, at(0))).toEqual({ others: [] });
    expect(await heartbeatPresence(who.bob, TEAM, page.id, at(1_000))).toEqual({ others: [{ id: who.alice.id, name: who.alice.name }] });
    const forAlice = await heartbeatPresence(who.alice, TEAM, page.id, at(2_000));
    expect(forAlice.others).toEqual([{ id: who.bob.id, name: who.bob.name }]);
    expect(Object.keys(forAlice.others[0] ?? {}).sort()).toEqual(["id", "name"]);
  });

  it("counts a heartbeat as present for 45 s, boundary included, and prunes older rows", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await heartbeatPresence(who.bob, TEAM, page.id, at(0));
    expect((await heartbeatPresence(who.carol, TEAM, page.id, at(LIMITS.presenceWindowMs))).others.map((u) => u.id)).toEqual([who.bob.id]);
    expect((await heartbeatPresence(who.carol, TEAM, page.id, at(LIMITS.presenceWindowMs + 1))).others).toEqual([]);
    expect(await prisma.documentPresence.count({ where: { documentId: page.id, userId: who.bob.id } })).toBe(0);
  });

  it("leaves out a user who can no longer view the page", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await heartbeatPresence(who.bob, PLAT, plat.id, at(0));
    expect((await heartbeatPresence(who.alice, PLAT, plat.id, at(1_000))).others.map((u) => u.id)).toEqual([who.bob.id]);
    await prisma.groupMember.deleteMany({ where: { userId: who.bob.id } });
    expect((await heartbeatPresence(who.alice, PLAT, plat.id, at(2_000))).others).toEqual([]);
  });

  it("is NotFound for a hidden space and across spaces, and records nothing", async () => {
    const plat = await createPageAs("alice", "plat", { title: "Plat" });
    await expectError(heartbeatPresence(who.carol, PLAT, plat.id), NotFoundError);
    await expectError(heartbeatPresence(who.carol, TEAM, plat.id), NotFoundError);
    expect(await prisma.documentPresence.count()).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  it("writes no audit row: a heartbeat every 15 s would flood a log that is never pruned (decision pending, see the phase report)", async () => {
    const page = await createPageAs("alice", "team", { title: "Spec" });
    await heartbeatPresence(who.bob, TEAM, page.id, at(0));
    await heartbeatPresence(who.bob, TEAM, page.id, at(15_000));
    expect(await auditRows()).toEqual([]);
  });
});

describe("listPeople (08 §3 GET /people)", () => {
  it("lists users who can view the space, by name, as { id, name } only — never an email", async () => {
    const team = await listPeople(who.carol, TEAM, "");
    expect(team.map((u) => u.name)).toEqual(["Alice Admin", "Bob Editor", "Carol Viewer"]);
    for (const u of team) expect(Object.keys(u).sort()).toEqual(["id", "name"]);
    expect(JSON.stringify(team)).not.toContain("@");
    // PLAT: alice directly, bob through the group; carol has no access.
    expect((await listPeople(who.bob, PLAT, "")).map((u) => u.name)).toEqual(["Alice Admin", "Bob Editor"]);
  });

  it("matches a case-insensitive prefix of the name, and never the email", async () => {
    expect((await listPeople(who.carol, TEAM, "bo")).map((u) => u.name)).toEqual(["Bob Editor"]);
    expect((await listPeople(who.carol, TEAM, "  CAROL ")).map((u) => u.name)).toEqual(["Carol Viewer"]);
    expect(await listPeople(who.carol, TEAM, "alice@")).toEqual([]);
    expect(await listPeople(who.carol, TEAM, "reqforge")).toEqual([]);
    expect(await listPeople(who.carol, TEAM, "Admin")).toEqual([]);
  });

  it("matches LIKE wildcards literally", async () => {
    expect(await listPeople(who.carol, TEAM, "%")).toEqual([]);
    expect(await listPeople(who.carol, TEAM, "_")).toEqual([]);
  });

  it("returns at most 10", async () => {
    const ids = await demoIds();
    for (let i = 0; i < 12; i++) {
      const u = await prisma.user.create({ data: { email: `extra${i}@reqforge.test`, name: `Extra ${String(i).padStart(2, "0")}`, passwordHash: "x" } });
      await prisma.membership.create({ data: { spaceId: ids.spaces.team, userId: u.id, permissions: ["VIEW"] } });
    }
    const people = await listPeople(who.carol, TEAM, "");
    expect(people).toHaveLength(10);
    expect((await listPeople(who.carol, TEAM, "extra")).map((u) => u.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Extra ${String(i).padStart(2, "0")}`),
    );
  });

  it("is NotFound for a space the caller cannot see", async () => {
    await expectError(listPeople(who.carol, PLAT, ""), NotFoundError);
    await expectError(listPeople(who.carol, "NOSUCH", ""), NotFoundError);
  });

  it("refuses a query the database cannot hold with VALIDATION at q", async () => {
    const error = await expectError(listPeople(who.carol, TEAM, "a\u0000"), ValidationError);
    expect(error.errors.map((e) => e.path)).toEqual(["q"]);
  });
});
