import { beforeEach, describe, expect, it } from "vitest";
import { listSpacePeople, PEOPLE_LIMIT } from "@/server/repositories/people";
import { rootDb } from "@/server/repositories/transaction";
import { demoIds, type DemoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

let ids: DemoIds;
beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
});

const names = async (viewer: keyof DemoIds["users"], space: keyof DemoIds["spaces"], q: string) =>
  (await listSpacePeople(rootDb, ids.users[viewer], ids.spaces[space], q))?.map((p) => p.name) ?? null;

describe("listSpacePeople — spec 08 §3 GET /people", () => {
  it("lists the people who can view the space, by name", async () => {
    expect(await names("alice", "team", "")).toEqual(["Alice Admin", "Bob Editor", "Carol Viewer"]);
  });

  it("includes a member who has VIEW only through a group, and excludes one with no access", async () => {
    expect(await names("alice", "plat", "")).toEqual(["Alice Admin", "Bob Editor"]); // bob via platform-viewers
  });

  it("matches the start of the name, case-insensitively", async () => {
    expect(await names("alice", "team", "bo")).toEqual(["Bob Editor"]);
    expect(await names("alice", "team", "BOB E")).toEqual(["Bob Editor"]);
    expect(await names("alice", "team", "ob")).toEqual([]); // a prefix, not a substring
  });

  it("does NOT match on email, so addresses cannot be reconstructed prefix by prefix", async () => {
    expect(await names("alice", "team", "bob@")).toEqual([]);
    expect(await names("alice", "team", "alice@reqforge")).toEqual([]);
  });

  it("returns only {id, name} — never an email", async () => {
    const rows = await listSpacePeople(rootDb, ids.users.alice, ids.spaces.team, "bob");
    expect(rows).toEqual([{ id: ids.users.bob, name: "Bob Editor" }]);
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("treats LIKE wildcards as ordinary characters", async () => {
    expect(await names("alice", "team", "%")).toEqual([]);
    expect(await names("alice", "team", "_ob")).toEqual([]);
    expect(await names("alice", "team", "\\")).toEqual([]);
  });

  it("a viewer who cannot see the space gets null, not an empty list (rule X2)", async () => {
    expect(await names("carol", "plat", "")).toBeNull();
    expect(await names("carol", "plat", "alice")).toBeNull();
  });

  it("a member without VIEW (EDIT only) is not listed", async () => {
    await prisma.membership.create({ data: { spaceId: ids.spaces.plat, userId: ids.users.carol, permissions: ["EDIT"] } });
    expect(await names("alice", "plat", "carol")).toEqual([]);
  });

  it("caps the result", async () => {
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: ids.users.alice } })).passwordHash;
    for (let i = 0; i < 14; i++) {
      const user = await prisma.user.create({ data: { email: `extra${i}@reqforge.test`, name: `Extra ${String(i).padStart(2, "0")}`, passwordHash: hash } });
      await prisma.membership.create({ data: { spaceId: ids.spaces.team, userId: user.id, permissions: ["VIEW"] } });
    }
    expect(await names("alice", "team", "Extra")).toHaveLength(PEOPLE_LIMIT);
  });

  it("folds case across scripts (ICU), whatever the cluster locale", async () => {
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: ids.users.alice } })).passwordHash;
    const user = await prisma.user.create({ data: { email: "apfel@reqforge.test", name: "Äpfel Müller", passwordHash: hash } });
    await prisma.membership.create({ data: { spaceId: ids.spaces.team, userId: user.id, permissions: ["VIEW"] } });
    expect(await names("alice", "team", "äpf")).toEqual(["Äpfel Müller"]);
    expect(await names("alice", "team", "ÄPF")).toEqual(["Äpfel Müller"]);
  });
});
