// Demo data: two spaces, three users with different permissions (PLAN.md, slice 0).
// Shared by `pnpm db:seed`, the integration tests and the Playwright run, so there is one
// definition of "the demo instance".
import type { PrismaClient, SpacePermission } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";

export const DEMO = {
  users: {
    alice: { email: "alice@reqforge.test", name: "Alice Admin", isInstanceAdmin: true },
    bob: { email: "bob@reqforge.test", name: "Bob Editor", isInstanceAdmin: false },
    carol: { email: "carol@reqforge.test", name: "Carol Viewer", isInstanceAdmin: false },
  },
  spaces: {
    team: { key: "TEAM", name: "Team" },
    plat: { key: "PLAT", name: "Platform" },
  },
  group: "platform-viewers",
} as const;

const ALL: SpacePermission[] = ["VIEW", "EDIT", "EXPORT", "ADMIN"];

/**
 *            TEAM                        PLAT
 *  alice   VIEW EDIT EXPORT ADMIN      VIEW EDIT EXPORT ADMIN
 *  bob     VIEW EDIT EXPORT            VIEW  (through the platform-viewers group)
 *  carol   VIEW                        — (cannot see the space at all)
 *
 * Alice is also the instance administrator. Idempotent: running it twice changes nothing.
 */
export async function seedDemo(prisma: PrismaClient, options: { password: string }): Promise<void> {
  const passwordHash = await hashPassword(options.password);

  await prisma.instanceSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

  const users = {} as Record<keyof typeof DEMO.users, { id: string }>;
  for (const [handle, u] of Object.entries(DEMO.users) as [keyof typeof DEMO.users, (typeof DEMO.users)[keyof typeof DEMO.users]][]) {
    users[handle] = await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash },
      update: { name: u.name, isInstanceAdmin: u.isInstanceAdmin, passwordHash },
      select: { id: true },
    });
  }

  const group = await prisma.group.upsert({
    where: { name: DEMO.group },
    create: { name: DEMO.group },
    update: {},
    select: { id: true },
  });
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: users.bob.id } },
    create: { groupId: group.id, userId: users.bob.id },
    update: {},
  });

  const spaces = {} as Record<keyof typeof DEMO.spaces, { id: string }>;
  for (const [handle, s] of Object.entries(DEMO.spaces) as [keyof typeof DEMO.spaces, (typeof DEMO.spaces)[keyof typeof DEMO.spaces]][]) {
    spaces[handle] = await prisma.space.upsert({
      where: { key: s.key },
      create: { ...s },
      update: { name: s.name },
      select: { id: true },
    });
  }

  type Grant = { spaceId: string; permissions: SpacePermission[] } & ({ userId: string } | { groupId: string });
  const grants: Grant[] = [
    { spaceId: spaces.team.id, userId: users.alice.id, permissions: ALL },
    { spaceId: spaces.team.id, userId: users.bob.id, permissions: ["VIEW", "EDIT", "EXPORT"] },
    { spaceId: spaces.team.id, userId: users.carol.id, permissions: ["VIEW"] },
    { spaceId: spaces.plat.id, userId: users.alice.id, permissions: ALL },
    { spaceId: spaces.plat.id, groupId: group.id, permissions: ["VIEW"] },
  ];
  for (const grant of grants) {
    const subject = "userId" in grant ? { userId: grant.userId } : { groupId: grant.groupId };
    const existing = await prisma.membership.findFirst({ where: { spaceId: grant.spaceId, ...subject } });
    if (existing) {
      await prisma.membership.update({ where: { id: existing.id }, data: { permissions: grant.permissions } });
    } else {
      await prisma.membership.create({ data: { spaceId: grant.spaceId, ...subject, permissions: grant.permissions } });
    }
  }
}
