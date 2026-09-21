import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * A lean fixture at the size spec 07 §5 names: 5,000 requirements and ~3,000 dependencies,
 * with no properties or documents, because the coverage budget is about counting edges.
 *
 * Coverage by construction, so the expected numbers are a rule rather than a list:
 *   - indexes 0…2999 have a `Refines` edge to index+1000  → 3,000 covered as child
 *   - every fifth of those also has a `Verifies` edge      → 600 covered as child
 */
export const COVERAGE_TOTAL = 5_000;
export const REFINES_COVERED = 3_000;
export const VERIFIES_COVERED = 600;

export type CoverageFixture = { spaceId: string; spaceKey: string; userId: string };

export function coverageKeyOf(index: number): string {
  return `CV-${String(index + 1).padStart(5, '0')}`;
}

export async function createCoverageSpace(prisma: PrismaClient): Promise<CoverageFixture> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-12);

  const user = await prisma.user.create({
    data: { email: `cov-${suffix}@test`, name: 'Coverage', passwordHash: 'scrypt$x$y' },
  });
  const space = await prisma.space.create({ data: { key: `CV${suffix}`, name: 'Coverage' } });
  await prisma.membership.create({
    data: { spaceId: space.id, userId: user.id, permissions: ['VIEW', 'EXPORT'] },
  });

  const requirements: Prisma.RequirementCreateManyInput[] = [];
  for (let index = 0; index < COVERAGE_TOTAL; index += 1) {
    const key = coverageKeyOf(index);
    requirements.push({
      spaceId: space.id,
      key,
      upperKey: key,
      uid: `uid-${key}`,
      title: `Requirement ${key}`,
      bodyHtml: `<p>${key}</p>`,
      bodySearch: `Requirement ${key}`,
      anchorPath: `0.${index}`,
      status: 'ACTIVE',
    });
  }
  await prisma.requirement.createMany({ data: requirements });

  const rows = await prisma.requirement.findMany({
    where: { spaceId: space.id },
    select: { id: true, upperKey: true },
  });
  const idByKey = new Map(rows.map((row) => [row.upperKey, row.id]));

  const dependencies: Prisma.DependencyCreateManyInput[] = [];
  for (let index = 0; index < REFINES_COVERED; index += 1) {
    const childId = idByKey.get(coverageKeyOf(index))!;
    const parentId = idByKey.get(coverageKeyOf(index + 1000))!;
    dependencies.push({ relationship: 'Refines', parentId, childId });
    if (index % 5 === 0) dependencies.push({ relationship: 'Verifies', parentId, childId });
  }
  await prisma.dependency.createMany({ data: dependencies });

  return { spaceId: space.id, spaceKey: space.key, userId: user.id };
}

export async function dropCoverageSpace(prisma: PrismaClient, fixture: CoverageFixture): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DELETE FROM "Dependency" WHERE "childId" IN (SELECT id FROM "Requirement" WHERE "spaceId" = $1)',
    fixture.spaceId,
  );
  await prisma.requirement.deleteMany({ where: { spaceId: fixture.spaceId } });
  await prisma.coverageTarget.deleteMany({ where: { spaceId: fixture.spaceId } });
  await prisma.membership.deleteMany({ where: { spaceId: fixture.spaceId } });
  await prisma.space.deleteMany({ where: { id: fixture.spaceId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}
