import type { Prisma, Requirement } from '@prisma/client';
import type { Diagnostic, IndexResult } from '@/domain/indexer';
import { prisma } from './client';

export type ApplyIndexInput = {
  spaceId: string;
  spaceKey: string;
  documentId: string;
  versionId: string;
  actorId: string;
  result: IndexResult;
};

export type ApplyIndexOutcome = {
  created: string[];
  updated: string[];
  deleted: string[];
  diagnostics: Diagnostic[];
};

/**
 * Writes an `IndexResult` into the database.
 *
 * Contract I2 — a reindex is a full replace, **scoped**: inline properties, dependencies
 * and non-origin links are rewritten for requirements defined in *this* document, and
 * nothing else is touched. Every write filters `baselineId: null`, so baselined rows
 * (invariant R2) are unreachable from here.
 * Contract I3 — a requirement that disappears from the document becomes `DELETED`; the
 * row, its external properties and its inbound dependencies survive.
 * Rule S3 — a key already defined by another document is a conflict: the first definition
 * keeps the row, and a `KEY_CONFLICT` diagnostic is written against **both** documents.
 * spec: 03-authoring-and-indexing.md §2–3
 */
export async function applyIndexResult(
  tx: Prisma.TransactionClient,
  input: ApplyIndexInput,
): Promise<ApplyIndexOutcome> {
  const { result } = input;
  const diagnostics: Diagnostic[] = [...result.diagnostics];

  const previouslyDefinedHere = await tx.requirement.findMany({
    where: { spaceId: input.spaceId, baselineId: null, originVersion: { documentId: input.documentId } },
    select: { id: true, upperKey: true, key: true, status: true },
  });

  const indexedKeys = result.requirements.map((requirement) => requirement.upperKey);
  const liveWithSameKey = indexedKeys.length
    ? await tx.requirement.findMany({
        where: { spaceId: input.spaceId, baselineId: null, upperKey: { in: indexedKeys } },
        select: { id: true, upperKey: true, originVersion: { select: { documentId: true } } },
      })
    : [];

  const ownerByKey = new Map(liveWithSameKey.map((row) => [row.upperKey, row]));
  const conflicts: Array<{ key: string; otherDocumentId: string; path: string }> = [];

  const created: string[] = [];
  const updated: string[] = [];
  const definedHere = new Map<string, string>(); // upperKey -> requirement id

  for (const requirement of result.requirements) {
    const owner = ownerByKey.get(requirement.upperKey);
    const ownerDocumentId = owner?.originVersion?.documentId ?? null;

    if (owner && ownerDocumentId !== null && ownerDocumentId !== input.documentId) {
      // Rule S3 under invariant R1 (RD-025): the first definition keeps the row.
      conflicts.push({ key: requirement.key, otherDocumentId: ownerDocumentId, path: requirement.anchorPath });
      diagnostics.push({
        code: 'KEY_CONFLICT',
        severity: 'error',
        message: `${requirement.key} is already defined in another document of this space. Both definitions are shown; resolve the conflict by renaming one.`,
        path: requirement.anchorPath,
        key: requirement.key,
      });
      continue;
    }

    const data = {
      key: requirement.key,
      upperKey: requirement.upperKey,
      uid: requirement.uid,
      title: requirement.title,
      bodyHtml: requirement.bodyHtml,
      bodySearch: requirement.bodySearch,
      anchorPath: requirement.anchorPath,
      typeId: requirement.typeId,
      originVersionId: input.versionId,
      status: 'ACTIVE' as const,
      updatedById: input.actorId,
    };

    if (owner) {
      const row = await tx.requirement.update({ where: { id: owner.id }, data });
      updated.push(row.id);
      definedHere.set(requirement.upperKey, row.id);
    } else {
      const row = await tx.requirement.create({
        data: { ...data, spaceId: input.spaceId, createdById: input.actorId },
      });
      created.push(row.id);
      definedHere.set(requirement.upperKey, row.id);
    }
  }

  // Contract I3 — removal marks, never deletes.
  const stillPresent = new Set(indexedKeys);
  const removed = previouslyDefinedHere.filter(
    (row) => !stillPresent.has(row.upperKey) && row.status !== 'DELETED',
  );
  if (removed.length > 0) {
    await tx.requirement.updateMany({
      where: { id: { in: removed.map((row) => row.id) }, baselineId: null },
      data: { status: 'DELETED', updatedById: input.actorId },
    });
  }

  await rewriteDerivedRows(tx, input, definedHere, diagnostics);
  await rewriteDiagnostics(tx, input, diagnostics, conflicts);

  return { created, updated, deleted: removed.map((row) => row.id), diagnostics };
}

/**
 * The "full replace, scoped" half of contract I2. Inline properties, dependencies and
 * document links belonging to this document are deleted and rewritten; `EXTERNAL`
 * properties are never in the delete filter.
 */
async function rewriteDerivedRows(
  tx: Prisma.TransactionClient,
  input: ApplyIndexInput,
  definedHere: Map<string, string>,
  diagnostics: Diagnostic[],
): Promise<void> {
  const ids = [...definedHere.values()];

  if (ids.length > 0) {
    await tx.property.deleteMany({ where: { requirementId: { in: ids }, kind: 'INLINE' } });
    await tx.dependency.deleteMany({ where: { childId: { in: ids } } });
    await tx.unresolvedDependency.deleteMany({ where: { childId: { in: ids } } });
  }

  const versionIds = (
    await tx.documentVersion.findMany({ where: { documentId: input.documentId }, select: { id: true } })
  ).map((version) => version.id);
  if (versionIds.length > 0) {
    await tx.documentLink.deleteMany({ where: { versionId: { in: versionIds } } });
  }

  if (input.result.properties.length > 0) {
    await tx.property.createMany({
      data: input.result.properties
        .filter((property) => definedHere.has(property.key.toUpperCase()))
        .map((property) => ({
          requirementId: definedHere.get(property.key.toUpperCase())!,
          kind: 'INLINE' as const,
          name: property.name,
          searchName: property.searchName,
          value: property.value,
          valueOrdinal: property.valueOrdinal,
          valueIndex: property.valueIndex,
        })),
    });
  }

  // The defining occurrence of each requirement — mirrors RY's DBLINK.ORIGIN.
  const originLinks = [...definedHere.entries()].map(([upper, requirementId]) => ({
    requirementId,
    versionId: input.versionId,
    origin: true,
    anchorPath: input.result.requirements.find((r) => r.upperKey === upper)?.anchorPath ?? null,
  }));

  // Citations: every other mention, resolved within the space.
  const citations = input.result.links.filter((cite) => cite.targetSpaceKey === input.spaceKey);
  const citedKeys = [...new Set(citations.map((cite) => cite.targetKey.toUpperCase()))];
  const citedRows = citedKeys.length
    ? await tx.requirement.findMany({
        where: { spaceId: input.spaceId, baselineId: null, upperKey: { in: citedKeys } },
        select: { id: true, upperKey: true },
      })
    : [];
  const citedById = new Map(citedRows.map((row) => [row.upperKey, row.id]));

  const citationLinks = citations
    .map((cite) => {
      const requirementId = citedById.get(cite.targetKey.toUpperCase());
      if (!requirementId) {
        diagnostics.push({
          code: 'UNRESOLVED_LINK',
          severity: 'warning',
          message: `${cite.targetKey} does not exist in this space yet.`,
          path: cite.path,
          key: cite.targetKey,
        });
        return null;
      }
      return { requirementId, versionId: input.versionId, origin: false, anchorPath: cite.path };
    })
    .filter((link): link is NonNullable<typeof link> => link !== null);

  const links = [...originLinks, ...citationLinks];
  if (links.length > 0) await tx.documentLink.createMany({ data: links });
}

async function rewriteDiagnostics(
  tx: Prisma.TransactionClient,
  input: ApplyIndexInput,
  diagnostics: Diagnostic[],
  conflicts: Array<{ key: string; otherDocumentId: string; path: string }>,
): Promise<void> {
  await tx.indexDiagnostic.deleteMany({
    where: { OR: [{ documentId: input.documentId }, { relatedDocumentId: input.documentId }] },
  });

  const rows = diagnostics.map((diagnostic) => ({
    documentId: input.documentId,
    versionId: input.versionId,
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    path: diagnostic.path,
    key: diagnostic.key ?? null,
    relatedDocumentId:
      diagnostic.code === 'KEY_CONFLICT'
        ? (conflicts.find((conflict) => conflict.key === diagnostic.key)?.otherDocumentId ?? null)
        : null,
  }));

  // The mirror rows: the document that already owns the key must show the conflict too,
  // so neither definition is hidden (rule S3).
  const mirrors = conflicts.map((conflict) => ({
    documentId: conflict.otherDocumentId,
    versionId: null,
    code: 'KEY_CONFLICT',
    severity: 'error',
    message: `${conflict.key} is also defined in another document of this space.`,
    path: '',
    key: conflict.key,
    relatedDocumentId: input.documentId,
  }));

  if (rows.length + mirrors.length > 0) {
    await tx.indexDiagnostic.createMany({ data: [...rows, ...mirrors] });
  }
}

export async function findRequirementByKey(
  spaceId: string,
  key: string,
  baselineId: string | null = null,
): Promise<Requirement | null> {
  return prisma.requirement.findFirst({
    where: { spaceId, upperKey: key.toUpperCase(), baselineId },
  });
}

export type RequirementDetail = Prisma.RequirementGetPayload<{
  include: {
    properties: true;
    links: { include: { version: { include: { document: true } } } };
    type: true;
  };
}>;

export async function findRequirementDetail(
  spaceId: string,
  key: string,
  baselineId: string | null = null,
): Promise<RequirementDetail | null> {
  return prisma.requirement.findFirst({
    where: { spaceId, upperKey: key.toUpperCase(), baselineId },
    include: {
      properties: { orderBy: [{ valueOrdinal: 'asc' }, { valueIndex: 'asc' }] },
      links: { include: { version: { include: { document: true } } } },
      type: true,
    },
  });
}

export async function listRequirements(
  spaceId: string,
  options: { status?: 'ACTIVE' | 'DELETED'; take?: number } = {},
): Promise<Requirement[]> {
  return prisma.requirement.findMany({
    where: { spaceId, baselineId: null, ...(options.status ? { status: options.status } : {}) },
    orderBy: { upperKey: 'asc' },
    take: options.take ?? 200,
  });
}

export async function listDocumentDiagnostics(documentId: string) {
  return prisma.indexDiagnostic.findMany({
    where: { OR: [{ documentId }, { relatedDocumentId: documentId }] },
    orderBy: [{ severity: 'asc' }, { path: 'asc' }],
  });
}
