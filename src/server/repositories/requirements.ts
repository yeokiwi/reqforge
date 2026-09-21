import type { Prisma, Requirement } from '@prisma/client';
import type { Diagnostic, IndexResult } from '@/domain/indexer';
import { advanceSequencesForKeys } from './requirement-types';
import { prisma } from './client';

export type ApplyIndexInput = {
  spaceId: string;
  spaceKey: string;
  /** spec 07 §3 — an isolated space refuses cross-space requirement links. */
  isolated?: boolean;
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

  // spec 03 §4.2 step 3 — using a key advances its type's sequence and never rewinds it.
  await advanceSequencesForKeys(tx, input.spaceId, indexedKeys);

  await rewriteDerivedRows(tx, input, definedHere, diagnostics);
  await writeDependencies(tx, input, definedHere, diagnostics);
  await promoteResolvedDependencies(tx, input, definedHere);
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
    // Contract I2: the edges this document declares are rewritten. Edges *into* these
    // requirements belong to other documents and are untouched.
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

/**
 * Turns `IndexedDependency` records into rows.
 * Invariant P1 — the requirement containing the link is the child, the linked requirement
 * is the parent.
 * Invariant P2 — a target that does not resolve is kept as an `UnresolvedDependency`,
 * never dropped and never cascade-deleted.
 */
async function writeDependencies(
  tx: Prisma.TransactionClient,
  input: ApplyIndexInput,
  definedHere: Map<string, string>,
  diagnostics: Diagnostic[],
): Promise<void> {
  const declared = input.result.dependencies.filter((dependency) =>
    definedHere.has(dependency.childKey.toUpperCase()),
  );
  if (declared.length === 0) return;

  const targetSpaceKeys = [...new Set(declared.map((dependency) => dependency.targetSpaceKey))];
  const spaces = await tx.space.findMany({
    where: { key: { in: targetSpaceKeys } },
    select: { id: true, key: true, isolated: true },
  });
  const spaceByKey = new Map(spaces.map((space) => [space.key, space]));

  const wantedKeys = [...new Set(declared.map((dependency) => dependency.targetKey.toUpperCase()))];
  const targets = await tx.requirement.findMany({
    where: {
      baselineId: null,
      upperKey: { in: wantedKeys },
      spaceId: { in: [...new Set(spaces.map((space) => space.id))] },
    },
    select: { id: true, upperKey: true, spaceId: true },
  });
  const targetById = new Map(targets.map((row) => [`${row.spaceId}:${row.upperKey}`, row.id]));

  const pinnedNumbers = [
    ...new Set(
      declared
        .map((dependency) => dependency.targetBaselineNumber)
        .filter((number): number is number => number !== null),
    ),
  ];
  const baselines = pinnedNumbers.length
    ? await tx.baseline.findMany({
        where: { number: { in: pinnedNumbers }, spaceId: { in: spaces.map((space) => space.id) } },
        select: { id: true, number: true, spaceId: true },
      })
    : [];
  const baselineById = new Map(baselines.map((row) => [`${row.spaceId}:${row.number}`, row.id]));

  const edges: Prisma.DependencyCreateManyInput[] = [];
  const unresolved: Prisma.UnresolvedDependencyCreateManyInput[] = [];

  for (const dependency of declared) {
    const childId = definedHere.get(dependency.childKey.toUpperCase())!;
    const targetSpace = spaceByKey.get(dependency.targetSpaceKey);
    const crossSpace = dependency.targetSpaceKey !== input.spaceKey;

    const keep = (message: string, severity: Diagnostic['severity'] = 'warning') => {
      diagnostics.push({
        code: 'UNRESOLVED_LINK',
        severity,
        message,
        path: dependency.path,
        key: dependency.targetKey,
      });
      unresolved.push({
        childId,
        relationship: dependency.relationship,
        targetSpaceKey: dependency.targetSpaceKey,
        targetKey: dependency.targetKey,
        targetBaselineId: null,
      });
    };

    // spec 07 §3 — isolation refuses cross-space links in either direction. The edge is
    // still retained, so turning isolation off later makes it resolve.
    if (crossSpace && (input.isolated || targetSpace?.isolated)) {
      keep(
        `${dependency.targetSpaceKey}/${dependency.targetKey} cannot be linked: one of the two spaces is isolated.`,
        'error',
      );
      continue;
    }

    if (!targetSpace) {
      keep(`There is no space with key ${dependency.targetSpaceKey}.`);
      continue;
    }

    const parentId = targetById.get(`${targetSpace.id}:${dependency.targetKey.toUpperCase()}`);
    if (!parentId) {
      keep(`${dependency.targetKey} does not exist in ${dependency.targetSpaceKey} yet.`);
      continue;
    }

    const targetBaselineId =
      dependency.targetBaselineNumber === null
        ? null
        : (baselineById.get(`${targetSpace.id}:${dependency.targetBaselineNumber}`) ?? null);

    if (dependency.targetBaselineNumber !== null && targetBaselineId === null) {
      diagnostics.push({
        code: 'UNRESOLVED_LINK',
        severity: 'warning',
        message: `Baseline ${dependency.targetBaselineNumber} does not exist in ${dependency.targetSpaceKey}; the link points at the live requirement.`,
        path: dependency.path,
        key: dependency.targetKey,
      });
    }

    edges.push({ relationship: dependency.relationship, parentId, childId, targetBaselineId });
  }

  if (edges.length > 0) await tx.dependency.createMany({ data: edges, skipDuplicates: true });
  if (unresolved.length > 0) await tx.unresolvedDependency.createMany({ data: unresolved });
}

/**
 * RD-029: resolution is retried. A key that was missing when another document cited it
 * resolves as soon as it exists, without re-saving that document.
 */
async function promoteResolvedDependencies(
  tx: Prisma.TransactionClient,
  input: ApplyIndexInput,
  definedHere: Map<string, string>,
): Promise<void> {
  if (definedHere.size === 0) return;

  const waiting = await tx.unresolvedDependency.findMany({
    where: { targetSpaceKey: input.spaceKey },
    select: { id: true, childId: true, relationship: true, targetKey: true },
  });

  const promotable = waiting
    .map((row) => ({ row, parentId: definedHere.get(row.targetKey.toUpperCase()) }))
    .filter((entry): entry is { row: (typeof waiting)[number]; parentId: string } => entry.parentId !== undefined);

  if (promotable.length === 0) return;

  await tx.dependency.createMany({
    data: promotable.map(({ row, parentId }) => ({
      relationship: row.relationship,
      parentId,
      childId: row.childId,
    })),
    skipDuplicates: true,
  });
  await tx.unresolvedDependency.deleteMany({ where: { id: { in: promotable.map(({ row }) => row.id) } } });
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
    parentEdges: { include: { parent: { include: { space: true } } } };
    childEdges: { include: { child: { include: { space: true } } } };
    unresolved: true;
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
      // `parentEdges` are the edges where this requirement is the child, i.e. the ones it
      // declared; `childEdges` are the edges pointing at it (invariant P1).
      parentEdges: { include: { parent: { include: { space: true } } } },
      childEdges: { include: { child: { include: { space: true } } } },
      unresolved: true,
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

/** Everything the Broken links screen shows for a space (invariant P2, rule S3). */
export async function listBrokenLinks(spaceId: string) {
  const unresolved = await prisma.unresolvedDependency.findMany({
    where: { child: { spaceId, baselineId: null } },
    include: {
      child: {
        select: {
          key: true,
          upperKey: true,
          status: true,
          originVersion: { select: { document: { select: { id: true, title: true } } } },
        },
      },
    },
    orderBy: [{ targetKey: 'asc' }],
  });

  const conflicts = await prisma.indexDiagnostic.findMany({
    where: { code: 'KEY_CONFLICT', document: { spaceId, deletedAt: null } },
    include: {
      document: { select: { id: true, title: true } },
      relatedDocument: { select: { id: true, title: true } },
    },
    orderBy: [{ key: 'asc' }],
  });

  // Dependencies whose target exists but is no longer ACTIVE: the edge is intact
  // (invariant P2) and the target is gone, which is exactly what a reviewer must see.
  const toDeleted = await prisma.dependency.findMany({
    where: { child: { spaceId, baselineId: null }, parent: { status: { not: 'ACTIVE' } } },
    include: {
      parent: { select: { key: true, status: true } },
      child: { select: { key: true } },
    },
    orderBy: [{ relationship: 'asc' }],
  });

  return { unresolved, conflicts, toDeleted };
}

export async function listDocumentDiagnostics(documentId: string) {
  return prisma.indexDiagnostic.findMany({
    where: { OR: [{ documentId }, { relatedDocumentId: documentId }] },
    orderBy: [{ severity: 'asc' }, { path: 'asc' }],
  });
}

/**
 * Deleting a document is the same event as its markers disappearing, so it takes the same
 * path: contract I3 — the requirements it defined become `DELETED` and keep their rows,
 * their **external** properties and their inbound dependencies. Without this a deleted
 * document left its requirements ACTIVE and searchable with no defining document, which
 * contradicts `03-authoring-and-indexing.md` §3.
 *
 * Baselined rows are untouched (invariant R2): a frozen snapshot does not follow the
 * live document.
 */
export async function markRequirementsOfDocumentsDeleted(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; documentIds: readonly string[]; actorId: string | null },
): Promise<string[]> {
  if (input.documentIds.length === 0) return [];

  const affected = await tx.requirement.findMany({
    where: {
      spaceId: input.spaceId,
      baselineId: null,
      status: { not: 'DELETED' },
      originVersion: { documentId: { in: [...input.documentIds] } },
    },
    select: { id: true },
  });
  if (affected.length === 0) return [];

  const ids = affected.map((row) => row.id);
  await tx.requirement.updateMany({
    where: { id: { in: ids }, baselineId: null },
    data: { status: 'DELETED', updatedById: input.actorId },
  });
  return ids;
}
