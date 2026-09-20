import type { Prisma, RequirementType } from '@prisma/client';
import { numberOf, parsePattern } from '@/domain/keys/pattern';
import { prisma } from './client';

export async function listRequirementTypes(spaceId: string): Promise<RequirementType[]> {
  return prisma.requirementType.findMany({ where: { spaceId }, orderBy: { keyPattern: 'asc' } });
}

export async function findRequirementType(spaceId: string, typeId: string): Promise<RequirementType | null> {
  return prisma.requirementType.findFirst({ where: { id: typeId, spaceId } });
}

/**
 * Every key the space has ever used, including `DELETED` rows and every baseline.
 * spec: 03-authoring-and-indexing.md §4.2 — the sequence must not rewind when a key is
 * deleted, so deleted and baselined keys still count towards "highest existing number".
 */
export async function listAllKeys(spaceId: string): Promise<string[]> {
  const rows = await prisma.requirement.findMany({
    where: { spaceId },
    select: { upperKey: true },
    distinct: ['upperKey'],
  });
  return rows.map((row) => row.upperKey);
}

/**
 * Keys that block reuse even when `preventReusingDeletedKeys` is off: every live row that
 * is not `DELETED`, plus every key captured in a baseline. A baselined key names a frozen
 * requirement forever (invariant R2), so it is never handed out again.
 * spec: 03-authoring-and-indexing.md §4.2; RD-026
 */
export async function listKeysExcludingDeleted(spaceId: string): Promise<string[]> {
  const rows = await prisma.requirement.findMany({
    where: { spaceId, OR: [{ baselineId: { not: null } }, { status: { not: 'DELETED' } }] },
    select: { upperKey: true },
    distinct: ['upperKey'],
  });
  return rows.map((row) => row.upperKey);
}

/**
 * Advance-and-never-rewind: using a key moves its type's sequence past it.
 * spec: 03-authoring-and-indexing.md §4.2 step 3 (research §2.3)
 */
export async function advanceSequencesForKeys(
  tx: Prisma.TransactionClient,
  spaceId: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const types = await tx.requirementType.findMany({ where: { spaceId } });

  for (const type of types) {
    const parsed = parsePattern(type.keyPattern);
    if (!parsed.ok) continue;

    const highest = keys.reduce((max, key) => Math.max(max, numberOf(parsed.pattern, key) ?? 0), 0);
    if (highest + 1 > type.nextSequence) {
      await tx.requirementType.update({ where: { id: type.id }, data: { nextSequence: highest + 1 } });
    }
  }
}

export async function setNextSequence(typeId: string, nextSequence: number): Promise<RequirementType> {
  return prisma.requirementType.update({ where: { id: typeId }, data: { nextSequence } });
}

/** The keys used most recently in a document, newest occurrence first. */
export async function keysUsedInDocument(spaceId: string, documentId: string): Promise<string[]> {
  const rows = await prisma.requirement.findMany({
    where: { spaceId, baselineId: null, originVersion: { documentId } },
    orderBy: { updatedAt: 'desc' },
    select: { upperKey: true },
    take: 20,
  });
  return rows.map((row) => row.upperKey);
}
