import { PrismaClient, type SpacePermission } from '@prisma/client';
import { hashPassword } from '../src/server/auth/password';

const prisma = new PrismaClient();

type SeedUser = { email: string; name: string; password: string };

const USERS: Record<'admin' | 'author' | 'reader', SeedUser> = {
  admin: { email: 'admin@reqforge.test', name: 'Ada Admin', password: 'reqforge-admin' },
  author: { email: 'author@reqforge.test', name: 'Arno Author', password: 'reqforge-author' },
  reader: { email: 'reader@reqforge.test', name: 'Rita Reader', password: 'reqforge-reader' },
};

async function main() {
  const users: Record<string, string> = {};
  for (const [role, user] of Object.entries(USERS)) {
    const passwordHash = await hashPassword(user.password);
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, passwordHash },
      create: { email: user.email, name: user.name, passwordHash, isAdmin: role === 'admin' },
    });
    users[role] = row.id;
  }

  // spec 07 §2.3 / RD-060 — the installation's ordered labels, least restrictive first.
  // Seeded only when the instance has none, so an administrator's own order survives.
  if ((await prisma.classificationLevel.count()) === 0) {
    await prisma.classificationLevel.createMany({
      data: [
        { name: 'Official', rank: 10 },
        { name: 'Official (Closed)', rank: 20 },
        { name: 'Secret', rank: 30 },
      ],
    });
  }
  const levelId = async (name: string | null): Promise<string | null> =>
    name === null ? null : (await prisma.classificationLevel.findUnique({ where: { name } }))?.id ?? null;

  const spaces = [
    { key: 'SJ', name: 'Sample Journey', isolated: false, classification: 'Official (Closed)' },
    { key: 'ISO', name: 'Isolated Programme', isolated: true, classification: null },
  ];

  for (const space of spaces) {
    const classificationId = await levelId(space.classification);
    const row = await prisma.space.upsert({
      where: { key: space.key },
      update: { name: space.name, isolated: space.isolated, classificationId },
      create: {
        key: space.key,
        name: space.name,
        isolated: space.isolated,
        classificationId,
      },
    });

    const grants: Array<[string, SpacePermission[]]> = [
      [users.admin!, ['VIEW', 'EDIT', 'EXPORT', 'ADMIN']],
      [users.author!, ['VIEW', 'EDIT', 'EXPORT']],
      [users.reader!, ['VIEW']],
    ];

    for (const [userId, permissions] of grants) {
      const existing = await prisma.membership.findFirst({ where: { spaceId: row.id, userId } });
      if (existing) {
        await prisma.membership.update({ where: { id: existing.id }, data: { permissions } });
      } else {
        await prisma.membership.create({ data: { spaceId: row.id, userId, permissions } });
      }
    }

    // Two requirement types per space: with a name, and a bare key suggestion
    // (research §2.3 — "the only difference ... is having a name").
    for (const type of [
      { name: 'Functional requirement', keyPattern: 'FN-###', colour: '#3b5bdb' },
      { name: null, keyPattern: 'BR-###', colour: '#0b7285' },
    ]) {
      await prisma.requirementType.upsert({
        where: { spaceId_keyPattern: { spaceId: row.id, keyPattern: type.keyPattern } },
        update: { name: type.name, colour: type.colour },
        create: { spaceId: row.id, name: type.name, keyPattern: type.keyPattern, colour: type.colour },
      });
    }
  }

  console.log('Seeded 2 spaces and 3 users:');
  for (const [role, user] of Object.entries(USERS)) {
    console.log(`  ${role.padEnd(6)} ${user.email}  password: ${user.password}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
