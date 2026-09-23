import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors';
import { cleanLabelName, highest, type ClassificationLabel } from '@/domain/classification';
import { prisma } from './client';

/**
 * Classification levels and label resolution.
 * spec: 07-permissions-and-limits.md §2.3; RD-060.
 */

const LEVEL = { id: true, name: true, rank: true } as const;

export async function listLevels(): Promise<ClassificationLabel[]> {
  return prisma.classificationLevel.findMany({ orderBy: { rank: 'asc' }, select: LEVEL });
}

export async function createLevel(rawName: unknown): Promise<ClassificationLabel> {
  const name = cleanLabelName(rawName);
  if (!name) throw new ValidationError('A label is 1–60 printable characters, without “&”.');
  const top = await prisma.classificationLevel.aggregate({ _max: { rank: true } });
  try {
    return await prisma.classificationLevel.create({
      data: { name, rank: (top._max.rank ?? 0) + 10 },
      select: LEVEL,
    });
  } catch {
    throw new ConflictError(`There is already a label called “${name}”.`);
  }
}

export async function renameLevel(id: string, rawName: unknown): Promise<ClassificationLabel> {
  const name = cleanLabelName(rawName);
  if (!name) throw new ValidationError('A label is 1–60 printable characters, without “&”.');
  try {
    return await prisma.classificationLevel.update({ where: { id }, data: { name }, select: LEVEL });
  } catch {
    throw new ConflictError(`There is already a label called “${name}”.`);
  }
}

/**
 * Sets the order, least restrictive first. `rank` is unique, so the ranks move in two
 * phases — the same reason a rename moves keys in two phases (RD-054).
 */
export async function reorderLevels(orderedIds: readonly string[]): Promise<void> {
  const existing = await prisma.classificationLevel.findMany({ select: { id: true } });
  const known = new Set(existing.map((level) => level.id));
  if (orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
    throw new ValidationError('The new order must list every label exactly once.');
  }
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.classificationLevel.update({ where: { id }, data: { rank: -(index + 1) } });
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx.classificationLevel.update({ where: { id }, data: { rank: (index + 1) * 10 } });
    }
  });
}

export async function deleteLevel(id: string): Promise<void> {
  // X3-exempt: counts rows that use a label, for an instance admin; no content.
  const [spaces, documents, baselines] = await Promise.all([
    prisma.space.count({ where: { classificationId: id } }),
    prisma.document.count({ where: { classificationId: id } }),
    prisma.baseline.count({ where: { classificationId: id } }),
  ]);
  if (spaces + documents + baselines > 0) {
    // A baseline's label was captured at freeze and must not silently disappear.
    throw new ConflictError('That label is still in use; relabel what uses it first.');
  }
  const removed = await prisma.classificationLevel.deleteMany({ where: { id } });
  if (removed.count === 0) throw new NotFoundError('That label no longer exists.');
}

export async function setSpaceLabel(spaceId: string, levelId: string | null): Promise<void> {
  await prisma.space.update({ where: { id: spaceId }, data: { classificationId: levelId } });
}

export async function setDocumentLabel(documentId: string, levelId: string | null): Promise<void> {
  await prisma.document.update({ where: { id: documentId }, data: { classificationId: levelId } });
}

export async function spaceLabel(spaceId: string): Promise<ClassificationLabel | null> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { classification: { select: LEVEL } },
  });
  return space?.classification ?? null;
}

/**
 * A document's own label against its space's: the floor of its effective label. The
 * upward half — what its reports and matrices render — is added by the caller, which is
 * the one that knows what was rendered for this reader (RD-060).
 */
export async function documentLabel(documentId: string): Promise<ClassificationLabel | null> {
  // X3-exempt: labels only; the caller has already established the document is visible.
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { classification: { select: LEVEL }, space: { select: { classification: { select: LEVEL } } } },
  });
  if (!document) return null;
  return highest([document.classification, document.space.classification]);
}

/**
 * The highest label over a set of requirements: each carries the higher of its space's
 * and its origin document's (spec 07 §2.3, "inherited by requirements"). Used by exports
 * and by a freeze, over rows the caller has already filtered by visibility.
 */
export async function labelForRequirements(ids: readonly string[]): Promise<ClassificationLabel | null> {
  if (ids.length === 0) return null;
  // X3-exempt: returns the label only, over ids the caller already filtered (rule X3).
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; rank: number }>>`
    SELECT l."id", l."name", l."rank"
      FROM "ClassificationLevel" l
     WHERE l."id" IN (
             SELECT s."classificationId" FROM "Requirement" r JOIN "Space" s ON s."id" = r."spaceId"
              WHERE r."id" = ANY(${[...new Set(ids)]}) AND s."classificationId" IS NOT NULL
             UNION
             SELECT d."classificationId" FROM "Requirement" r
               JOIN "DocumentVersion" v ON v."id" = r."originVersionId"
               JOIN "Document" d ON d."id" = v."documentId"
              WHERE r."id" = ANY(${[...new Set(ids)]}) AND d."classificationId" IS NOT NULL
           )
     ORDER BY l."rank" DESC
     LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function levelById(id: string | null): Promise<ClassificationLabel | null> {
  if (!id) return null;
  return prisma.classificationLevel.findUnique({ where: { id }, select: LEVEL });
}

/** RD-060 — a baseline's label is the highest among its members, captured at freeze. */
export async function captureBaselineLabel(baselineId: string): Promise<void> {
  // X3-exempt: computes a label over the baseline's own rows; shows nothing.
  const members = await prisma.requirement.findMany({ where: { baselineId }, select: { id: true } });
  const label = await labelForRequirements(members.map((member) => member.id));
  await prisma.baseline.update({ where: { id: baselineId }, data: { classificationId: label?.id ?? null } });
}
