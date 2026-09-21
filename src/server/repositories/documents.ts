import type { Document, DocumentVersion, Prisma } from '@prisma/client';
import { emptyDocument, type PMNode } from '@/domain/doc';
import { ConflictError, NotFoundError } from '@/domain/errors';
import { prisma } from './client';
import { markRequirementsOfDocumentsDeleted } from './requirements';

export type DocumentWithVersion = Document & { currentVersion: DocumentVersion | null };

export type DocumentTreeNode = {
  id: string;
  title: string;
  parentId: string | null;
  ordinal: number;
  children: DocumentTreeNode[];
};

export async function listDocumentTree(spaceId: string): Promise<DocumentTreeNode[]> {
  const rows = await prisma.document.findMany({
    where: { spaceId, deletedAt: null },
    orderBy: [{ parentId: 'asc' }, { ordinal: 'asc' }, { title: 'asc' }],
    select: { id: true, title: true, parentId: true, ordinal: true },
  });

  const byId = new Map<string, DocumentTreeNode>(
    rows.map((row) => [row.id, { ...row, children: [] as DocumentTreeNode[] }]),
  );
  const roots: DocumentTreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function findDocument(spaceId: string, documentId: string): Promise<DocumentWithVersion | null> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, spaceId, deletedAt: null },
  });
  if (!document) return null;
  const currentVersion = document.currentVersionId
    ? await prisma.documentVersion.findUnique({ where: { id: document.currentVersionId } })
    : null;
  return { ...document, currentVersion };
}

export async function listVersions(documentId: string): Promise<DocumentVersion[]> {
  return prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { number: 'desc' },
  });
}

export async function findVersion(documentId: string, number: number): Promise<DocumentVersion | null> {
  return prisma.documentVersion.findUnique({ where: { documentId_number: { documentId, number } } });
}

export async function createDocument(input: {
  spaceId: string;
  title: string;
  parentId: string | null;
  authorId: string;
}): Promise<DocumentWithVersion> {
  return prisma.$transaction(async (tx) => {
    const siblings = await tx.document.aggregate({
      where: { spaceId: input.spaceId, parentId: input.parentId, deletedAt: null },
      _max: { ordinal: true },
    });

    const document = await tx.document.create({
      data: {
        spaceId: input.spaceId,
        title: input.title,
        parentId: input.parentId,
        ordinal: (siblings._max.ordinal ?? -1) + 1,
      },
    });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        number: 1,
        content: emptyDocument() as unknown as Prisma.InputJsonValue,
        authorId: input.authorId,
        message: 'Created',
      },
    });

    const withVersion = await tx.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });

    return { ...withVersion, currentVersion: version };
  });
}

/**
 * Every save writes a new immutable version and repoints `currentVersionId`, in one
 * transaction. spec: 01-domain-model.md (Document) — "Documents are versioned on every
 * save. Versions are immutable."
 *
 * `onVersion` runs inside the same transaction; slice 2 uses it to index the new version
 * so a requirement row can never disagree with the version it was extracted from.
 */
export async function saveDocumentVersion(input: {
  documentId: string;
  content: PMNode;
  authorId: string;
  message?: string | null;
  onVersion?: (tx: Prisma.TransactionClient, version: DocumentVersion) => Promise<void>;
}): Promise<DocumentVersion> {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.findUnique({ where: { id: input.documentId } });
    if (!document || document.deletedAt) throw new NotFoundError('That document no longer exists.');

    const last = await tx.documentVersion.aggregate({
      where: { documentId: input.documentId },
      _max: { number: true },
    });

    const version = await tx.documentVersion.create({
      data: {
        documentId: input.documentId,
        number: (last._max.number ?? 0) + 1,
        content: input.content as unknown as Prisma.InputJsonValue,
        authorId: input.authorId,
        message: input.message ?? null,
      },
    });

    await tx.document.update({ where: { id: input.documentId }, data: { currentVersionId: version.id } });
    await input.onVersion?.(tx, version);

    return version;
  });
}

export async function renameDocument(spaceId: string, documentId: string, title: string): Promise<void> {
  const updated = await prisma.document.updateMany({
    where: { id: documentId, spaceId, deletedAt: null },
    data: { title },
  });
  if (updated.count === 0) throw new NotFoundError('That document no longer exists.');
}

export async function moveDocument(spaceId: string, documentId: string, parentId: string | null): Promise<void> {
  if (parentId === documentId) throw new ConflictError('A document cannot be its own parent.');

  if (parentId) {
    // Walk up from the new parent; if we meet the document being moved, the move would
    // detach a subtree from the tree entirely.
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === documentId) throw new ConflictError('A document cannot be moved inside itself.');
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const parent: { parentId: string | null } | null = await prisma.document.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  const updated = await prisma.document.updateMany({
    where: { id: documentId, spaceId, deletedAt: null },
    data: { parentId },
  });
  if (updated.count === 0) throw new NotFoundError('That document no longer exists.');
}

/**
 * Soft delete: versions survive, because a frozen baseline may pin one
 * (invariant D1, spec 05 §3.2 step 6).
 */
/**
 * Soft-deletes a document and its descendants, and marks the requirements they defined
 * `DELETED` in the same transaction (contract I3 — `03` §3). Returns the document ids.
 */
export async function softDeleteDocument(
  spaceId: string,
  documentId: string,
  actorId: string | null = null,
): Promise<string[]> {
  const all = await prisma.document.findMany({
    where: { spaceId, deletedAt: null },
    select: { id: true, parentId: true },
  });

  const descendants = new Set<string>([documentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of all) {
      if (row.parentId && descendants.has(row.parentId) && !descendants.has(row.id)) {
        descendants.add(row.id);
        grew = true;
      }
    }
  }

  const documentIds = [...descendants];
  await prisma.$transaction(async (tx) => {
    await tx.document.updateMany({
      where: { id: { in: documentIds }, spaceId },
      data: { deletedAt: new Date() },
    });
    // The markers are gone as surely as if they had been deleted from the body, so the
    // requirements follow contract I3 rather than staying ACTIVE with no document.
    await markRequirementsOfDocumentsDeleted(tx, { spaceId, documentIds, actorId });
  });
  return documentIds;
}
