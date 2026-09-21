import type { Prisma, SavedMatrix } from '@prisma/client';
import { prisma } from './client';

export async function listSavedMatrices(
  spaceId: string,
  userId: string,
  kind: 'TRACEABILITY' | 'DEPENDENCY' = 'TRACEABILITY',
): Promise<SavedMatrix[]> {
  return prisma.savedMatrix.findMany({
    where: { spaceId, kind, OR: [{ visibility: 'space' }, { ownerId: userId }] },
    orderBy: { name: 'asc' },
  });
}

export async function findSavedMatrix(id: string): Promise<SavedMatrix | null> {
  return prisma.savedMatrix.findUnique({ where: { id } });
}

export async function saveMatrix(input: {
  spaceId: string;
  name: string;
  kind: 'TRACEABILITY' | 'DEPENDENCY';
  query: string;
  columns: Prisma.InputJsonValue;
  visibility: string;
  ownerId: string;
}): Promise<SavedMatrix> {
  return prisma.savedMatrix.upsert({
    where: { spaceId_name: { spaceId: input.spaceId, name: input.name } },
    update: { query: input.query, columns: input.columns, visibility: input.visibility },
    create: input,
  });
}

export async function deleteSavedMatrix(spaceId: string, id: string): Promise<void> {
  await prisma.savedMatrix.deleteMany({ where: { id, spaceId } });
}

/**
 * The baseline a document reports on, if any.
 * spec: 04-traceability-and-coverage.md §2.3 — `$currentBaseline` in a saved matrix
 * resolves to the baseline of the document the matrix is embedded in (research §3.6).
 */
export async function baselineOfReportDocument(documentId: string): Promise<{ id: string; number: number } | null> {
  const baseline = await prisma.baseline.findFirst({
    where: { reportDocumentId: documentId },
    select: { id: true, number: true },
  });
  return baseline;
}
