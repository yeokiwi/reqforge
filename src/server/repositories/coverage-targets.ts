import type { CoverageTarget } from '@prisma/client';
import { prisma } from './client';

export async function listCoverageTargets(spaceId: string): Promise<CoverageTarget[]> {
  return prisma.coverageTarget.findMany({ where: { spaceId }, orderBy: [{ relationship: 'asc' }] });
}

/** spec: 04-traceability-and-coverage.md §4.2 — a target per relationship, per space. */
export async function setCoverageTarget(input: {
  spaceId: string;
  relationship: string;
  direction: 'to' | 'from';
  targetPercent: number;
}): Promise<CoverageTarget> {
  const targetPercent = Math.min(Math.max(Math.round(input.targetPercent), 0), 100);

  return prisma.coverageTarget.upsert({
    where: {
      spaceId_relationship_direction: {
        spaceId: input.spaceId,
        relationship: input.relationship,
        direction: input.direction,
      },
    },
    update: { targetPercent },
    create: { ...input, targetPercent },
  });
}

export async function clearCoverageTarget(spaceId: string, id: string): Promise<void> {
  await prisma.coverageTarget.deleteMany({ where: { id, spaceId } });
}
