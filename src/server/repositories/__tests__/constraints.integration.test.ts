// Invariants that Prisma's schema language cannot express and that therefore live in the
// migration SQL (spec 01). If one of these tests fails, a constraint was dropped or never applied.
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO, prisma, resetDemoInstance } from "@/test-support/fixtures";

beforeEach(resetDemoInstance);

const requirement = (spaceId: string, key: string, extra: Record<string, unknown> = {}) => ({
  spaceId,
  key,
  upperKey: key.toLowerCase(),
  title: key,
  bodyHtml: "",
  bodySearch: "",
  anchorPath: "0",
  uid: `uid-${key}-${Math.random()}`,
  ...extra,
});

describe("Space.key — spec 01: [A-Z][A-Z0-9]{1,15}", () => {
  it.each(["team", "A", "1ABC", "AB-CD", "A".repeat(17), ""])("rejects %j", async (key) => {
    await expect(prisma.space.create({ data: { key, name: "x" } })).rejects.toThrow(/Space_key_format/);
  });

  it("accepts the boundary lengths", async () => {
    await prisma.space.create({ data: { key: "AB", name: "two" } });
    await prisma.space.create({ data: { key: "A" + "B".repeat(15), name: "sixteen" } });
  });
});

describe("User.email is lower-case", () => {
  it("rejects a mixed-case address", async () => {
    await expect(
      prisma.user.create({ data: { email: "Mixed@Reqforge.test", name: "M", passwordHash: "x" } }),
    ).rejects.toThrow(/User_email_lowercase/);
  });
});

describe("Membership", () => {
  const team = () => prisma.space.findUniqueOrThrow({ where: { key: DEMO.spaces.team.key } });
  const plat = () => prisma.space.findUniqueOrThrow({ where: { key: DEMO.spaces.plat.key } });
  const carol = () => prisma.user.findUniqueOrThrow({ where: { email: DEMO.users.carol.email } });
  const group = () => prisma.group.findUniqueOrThrow({ where: { name: DEMO.group } });

  it("must name exactly one subject: neither is refused", async () => {
    await expect(prisma.membership.create({ data: { spaceId: (await team()).id, permissions: ["VIEW"] } })).rejects.toThrow(
      /Membership_exactly_one_subject/,
    );
  });

  it("must name exactly one subject: both is refused", async () => {
    await expect(
      prisma.membership.create({
        data: { spaceId: (await plat()).id, userId: (await carol()).id, groupId: (await group()).id, permissions: ["VIEW"] },
      }),
    ).rejects.toThrow(/Membership_exactly_one_subject/);
  });

  it("allows one row per user per space — a second is refused", async () => {
    await expect(
      prisma.membership.create({ data: { spaceId: (await team()).id, userId: (await carol()).id, permissions: ["EDIT"] } }),
    ).rejects.toThrow(/Membership_spaceId_userId_key|Unique constraint/);
  });

  it("allows one row per group per space — a second is refused", async () => {
    await expect(
      prisma.membership.create({ data: { spaceId: (await plat()).id, groupId: (await group()).id, permissions: ["EDIT"] } }),
    ).rejects.toThrow(/Membership_spaceId_groupId_key|Unique constraint/);
  });

  it("the same user can hold memberships in different spaces", async () => {
    await prisma.membership.create({ data: { spaceId: (await plat()).id, userId: (await carol()).id, permissions: ["VIEW"] } });
  });

  it("deleting a space removes its memberships and per-user state", async () => {
    const t = await team();
    await prisma.userSpaceState.create({ data: { userId: (await carol()).id, spaceId: t.id, favourite: true } });
    await prisma.space.delete({ where: { id: t.id } });
    expect(await prisma.membership.count({ where: { spaceId: t.id } })).toBe(0);
    expect(await prisma.userSpaceState.count({ where: { spaceId: t.id } })).toBe(0);
  });
});

describe("Requirement identity — invariant R1, spec 01", () => {
  const spaceId = async () => (await prisma.space.findUniqueOrThrow({ where: { key: DEMO.spaces.team.key } })).id;

  it("two live requirements cannot share (space, upperKey) — NULL baselines still collide", async () => {
    const id = await spaceId();
    await prisma.requirement.create({ data: requirement(id, "REQ-001") });
    // Prisma reports the violated index by its columns. Two columns — no baselineId — is the
    // partial index; the full three-column index could never fire here, NULLs being distinct.
    await expect(prisma.requirement.create({ data: requirement(id, "REQ-001", { upperKey: "req-001" }) })).rejects.toThrow(
      /fields: \(`spaceId`,`upperKey`\)/,
    );
  });

  it("the same key may exist live in two different spaces", async () => {
    await prisma.requirement.create({ data: requirement(await spaceId(), "REQ-001") });
    const other = (await prisma.space.findUniqueOrThrow({ where: { key: DEMO.spaces.plat.key } })).id;
    await prisma.requirement.create({ data: requirement(other, "REQ-001") });
  });

  it("a baselined copy of a live key is allowed; two copies in one baseline are not", async () => {
    const id = await spaceId();
    await prisma.requirement.create({ data: requirement(id, "REQ-001") });
    const baseline = await prisma.baseline.create({ data: { spaceId: id, number: 1, name: "B1", sourceQuery: "" } });
    await prisma.requirement.create({ data: requirement(id, "REQ-001", { baselineId: baseline.id }) });
    await expect(
      prisma.requirement.create({ data: requirement(id, "REQ-001", { baselineId: baseline.id }) }),
    ).rejects.toThrow(/fields: \(`spaceId`,`upperKey`,`baselineId`\)/);
  });
});
