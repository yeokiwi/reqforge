import { Prisma } from '@prisma/client';
import type { Diagnostic, IndexResult } from '@/domain/indexer';
import { validateRequirement, type Rule, type Subject } from '@/domain/validation';
import {
  changesBetween,
  recordHistory,
  type HistoryEntry,
  type RequirementSnapshot,
} from './history';
import { advanceSequencesForKeys } from './requirement-types';
import { writeValidations, type ValidationRow } from './validations';
import { prisma } from './client';
import { param, render, sql, substituteAlias } from '@/domain/ryql/sql';
import { requirementVisibility, visibleDocumentIds, visibleRequirementIdsFor, type Viewer } from './visibility';

export type ApplyIndexInput = {
  spaceId: string;
  spaceKey: string;
  /** spec 07 §3 — an isolated space refuses cross-space requirement links. */
  isolated?: boolean;
  documentId: string;
  versionId: string;
  actorId: string;
  result: IndexResult;
  /**
   * The space's types with their rules, so validation runs on every save (spec 06 §2.2
   * trigger 1) from data already in hand.
   */
  types?: readonly { id: string; rules: readonly Rule[] }[];
  /** spec 05 §6 — history is off by default per space (research §2.7). */
  historyEnabled?: boolean;
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
  // X3-exempt: the indexer writes what a save projects; it shows nothing (contract I2).
  const { result } = input;
  const diagnostics: Diagnostic[] = [...result.diagnostics];

  const previouslyDefinedHere = await tx.requirement.findMany({
    where: { spaceId: input.spaceId, baselineId: null, originVersion: { documentId: input.documentId } },
    select: { id: true, upperKey: true, key: true, status: true },
  });

  // Read before anything is written: history compares what the requirement was against
  // what this save makes it.
  const before = input.historyEnabled
    ? await snapshotRequirements(tx, previouslyDefinedHere.map((row) => row.id))
    : new Map<string, RequirementSnapshot>();

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
  // Validation runs after the edges are written, so a `from` rule sees this save's work,
  // and before the diagnostics are persisted, so its findings are part of them.
  diagnostics.push(...(await validateDocumentRequirements(tx, input, definedHere)));
  // spec 05 §6 / RD-014 — written in the same transaction as the change it describes, so
  // it cannot outlive a rollback and cannot misattribute an author.
  if (input.historyEnabled) {
    await recordIndexHistory(tx, input, definedHere, before, removed.map((row) => row.id));
  }
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
  // X3-exempt: the indexer rewrites derived rows; it shows nothing.
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
  // X3-exempt: the indexer writes edges; it shows nothing.
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
  // X3-exempt: the indexer resolves edges; it shows nothing.
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
    // RD-042 — the fix is data, so it survives a reload with its diagnostic.
    fix: diagnostic.fix ? (diagnostic.fix as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
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

/** A requirement as one reader may see it: hidden edge ends and citing documents masked. */
export type VisibleRequirementDetail = RequirementDetail & {
  /** Ids at the other end of an edge that this reader may not see (rule X2). */
  restrictedIds: ReadonlySet<string>;
};

/**
 * One requirement, as `viewer` may see it — or `null`, exactly as if the key did not
 * exist, when they may not (rule X1; RD-064: a hidden requirement answers 404, never 403).
 *
 * The edge ends and the citing documents go through the same predicate: a dependency on a
 * hidden requirement keeps its key but loses its title and body, and a document the reader
 * cannot open is not named as a place the requirement is cited (rule X2).
 * spec: 07-permissions-and-limits.md §2.2
 */
export async function findRequirementDetail(
  viewer: Viewer,
  spaceId: string,
  key: string,
  baselineId: string | null = null,
): Promise<VisibleRequirementDetail | null> {
  const found = await prisma.requirement.findFirst({
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
  if (!found) return null;

  const others = [...found.parentEdges.map((edge) => edge.parentId), ...found.childEdges.map((edge) => edge.childId)];
  const [visible, visibleDocuments] = await Promise.all([
    visibleRequirementIdsFor(viewer, [found.id, ...others]),
    visibleDocumentIds(viewer, found.links.map((link) => link.version.documentId)),
  ]);
  if (!visible.has(found.id)) return null;

  const restrictedIds = new Set(others.filter((id) => !visible.has(id)));
  // Defence in depth: the masked content is not in the object at all, so a caller that
  // forgets `restrictedIds` still cannot render it.
  const mask = <T extends { id: string; title: string; bodyHtml: string; bodySearch: string }>(row: T): T =>
    restrictedIds.has(row.id) ? { ...row, title: '', bodyHtml: '', bodySearch: '' } : row;

  return {
    ...found,
    links: found.links.filter((link) => visibleDocuments.has(link.version.documentId)),
    parentEdges: found.parentEdges.map((edge) => ({ ...edge, parent: mask(edge.parent) })),
    childEdges: found.childEdges.map((edge) => ({ ...edge, child: mask(edge.child) })),
    restrictedIds,
  };
}

/**
 * Everything the Broken links screen shows for a space (invariant P2, rule S3), as this
 * reader may see it (rule X2):
 *   - a pending link is listed only if the requirement declaring it is visible;
 *   - a key conflict is listed only if its own document is visible, and the other
 *     document is named only if that one is visible too;
 *   - a link to a deleted target is listed only if its declaring requirement is visible,
 *     and a hidden target keeps its key but not its status (RD-064).
 */
export async function listBrokenLinks(viewer: Viewer, spaceId: string) {
  const unresolvedAll = await prisma.unresolvedDependency.findMany({
    where: { child: { spaceId, baselineId: null } },
    include: {
      child: {
        select: {
          id: true,
          key: true,
          upperKey: true,
          status: true,
          originVersion: { select: { document: { select: { id: true, title: true } } } },
        },
      },
    },
    orderBy: [{ targetKey: 'asc' }],
  });

  const conflictsAll = await prisma.indexDiagnostic.findMany({
    where: { code: 'KEY_CONFLICT', document: { spaceId, deletedAt: null } },
    include: {
      document: { select: { id: true, title: true } },
      relatedDocument: { select: { id: true, title: true } },
    },
    orderBy: [{ key: 'asc' }],
  });

  // Dependencies whose target exists but is no longer ACTIVE: the edge is intact
  // (invariant P2) and the target is gone, which is exactly what a reviewer must see.
  const toDeletedAll = await prisma.dependency.findMany({
    where: { child: { spaceId, baselineId: null }, parent: { status: { not: 'ACTIVE' } } },
    include: {
      parent: { select: { id: true, key: true, status: true } },
      child: { select: { id: true, key: true } },
    },
    orderBy: [{ relationship: 'asc' }],
  });

  const [requirements, documents] = await Promise.all([
    visibleRequirementIdsFor(viewer, [
      ...unresolvedAll.map((row) => row.child.id),
      ...toDeletedAll.flatMap((row) => [row.child.id, row.parent.id]),
    ]),
    visibleDocumentIds(viewer, [
      ...conflictsAll.map((row) => row.document.id),
      ...conflictsAll.flatMap((row) => (row.relatedDocument ? [row.relatedDocument.id] : [])),
    ]),
  ]);

  const unresolved = unresolvedAll.filter((row) => requirements.has(row.child.id));
  const conflicts = conflictsAll
    .filter((row) => documents.has(row.document.id))
    .map((row) => ({
      ...row,
      relatedDocument:
        row.relatedDocument && documents.has(row.relatedDocument.id)
          ? row.relatedDocument
          : row.relatedDocument
            ? { id: '', title: 'a document you cannot see' }
            : null,
    }));
  const toDeleted = toDeletedAll
    .filter((row) => requirements.has(row.child.id))
    .map((row) =>
      requirements.has(row.parent.id) ? row : { ...row, parent: { ...row.parent, status: 'RESTRICTED' as const } },
    );

  return { unresolved, conflicts, toDeleted };
}

/**
 * A document's diagnostics, scoped to its space, as this reader may see them. A key
 * conflict is written against both documents involved; the half that lives on a document
 * this reader cannot open is dropped rather than shown (rule X2), and the message on this
 * document's own half names no other document.
 */
export async function listDocumentDiagnostics(viewer: Viewer, spaceId: string, documentId: string) {
  const rows = await prisma.indexDiagnostic.findMany({
    where: {
      document: { spaceId },
      OR: [{ documentId }, { relatedDocumentId: documentId }],
    },
    orderBy: [{ severity: 'asc' }, { path: 'asc' }],
  });
  const visible = await visibleDocumentIds(viewer, rows.map((row) => row.documentId));
  return rows.filter((row) => visible.has(row.documentId));
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
  // X3-exempt: a write (contract I3); the caller established edit rights.
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

/**
 * Validation on index — spec 06 §2.2's first trigger.
 *
 * Spec 06 §2.3: "Validation of one requirement must issue zero additional queries." It
 * issues **one** for the whole document, loading the inbound edges a `from` rule needs
 * (`RD-040`): those edges are declared in other documents, so they cannot come from the
 * `IndexResult`, and the per-requirement cost is what the rule is about. Everything else
 * — properties, outbound edges, placement — is already in memory.
 */
export async function validateDocumentRequirements(
  tx: Prisma.TransactionClient,
  input: ApplyIndexInput,
  definedHere: Map<string, string>,
): Promise<Diagnostic[]> {
  // X3-exempt: validation on save computes statuses; it shows nothing beyond the saver's own document.
  const ids = [...definedHere.values()];
  if (ids.length === 0) return [];

  const rulesByType = new Map((input.types ?? []).map((type) => [type.id, type.rules]));

  // The one query (RD-040): who depends on the requirements this document defines.
  const inboundEdges =
    rulesByType.size > 0
      ? await tx.dependency.findMany({
          where: { parentId: { in: ids } },
          select: { parentId: true, relationship: true },
        })
      : [];

  const inboundByRequirement = new Map<string, string[]>();
  for (const edge of inboundEdges) {
    inboundByRequirement.set(edge.parentId, [...(inboundByRequirement.get(edge.parentId) ?? []), edge.relationship]);
  }

  // Properties and outbound edges, grouped from the IndexResult — no query.
  const propertiesByKey = new Map<string, Subject['properties'][number][]>();
  for (const property of input.result.properties) {
    propertiesByKey.set(property.key, [
      ...(propertiesByKey.get(property.key) ?? []),
      { name: property.name, searchName: property.searchName, value: property.value },
    ]);
  }

  const outboundByKey = new Map<string, string[]>();
  for (const dependency of input.result.dependencies) {
    outboundByKey.set(dependency.childKey, [
      ...(outboundByKey.get(dependency.childKey) ?? []),
      dependency.relationship,
    ]);
  }

  const diagnostics: Diagnostic[] = [];
  const rows: ValidationRow[] = [];

  for (const requirement of input.result.requirements) {
    const requirementId = definedHere.get(requirement.upperKey);
    // A requirement lost to a rule S3 conflict has no row, so there is nothing to validate.
    if (!requirementId) continue;
    if (!requirement.typeId) continue;

    const rules = rulesByType.get(requirement.typeId);
    if (!rules || rules.length === 0) continue;

    const outcome = validateRequirement(
      {
        key: requirement.key,
        anchorPath: requirement.anchorPath,
        properties: propertiesByKey.get(requirement.key) ?? [],
        outbound: outboundByKey.get(requirement.key) ?? [],
        inbound: inboundByRequirement.get(requirementId) ?? [],
        // The headerless warning is already raised by the indexer (rule S4); validation
        // must not raise it twice.
        headerlessTable: false,
        placement: requirement.placement,
      },
      rules,
    );

    diagnostics.push(...outcome.diagnostics);
    rows.push({ requirementId, typeId: requirement.typeId, status: outcome.status, diagnostics: outcome.diagnostics });
  }

  // Written over every requirement of this document, so a row left by a type that no
  // longer applies goes with it.
  await writeValidations(tx, ids, rows);
  return diagnostics;
}

// ------------------------------------------------------------------ slice 14: history

/** What a set of requirements looked like, in the canonical form history compares. */
async function snapshotRequirements(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<Map<string, RequirementSnapshot>> {
  // X3-exempt: the indexer's before-image for history; it shows nothing.
  if (ids.length === 0) return new Map();

  const rows = await tx.requirement.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      title: true,
      bodySearch: true,
      typeId: true,
      status: true,
      properties: { where: { kind: 'INLINE' }, select: { searchName: true, value: true, valueIndex: true } },
      parentEdges: { select: { relationship: true, parent: { select: { upperKey: true } } } },
    },
  });

  return new Map(
    rows.map((row) => [
      row.id,
      {
        title: row.title,
        bodySearch: row.bodySearch,
        typeId: row.typeId,
        status: row.status,
        properties: row.properties
          .map((property) => `${property.searchName}=${property.value}`)
          .sort(),
        dependencies: row.parentEdges
          .map((edge) => `${edge.relationship} → ${edge.parent.upperKey}`)
          .sort(),
      },
    ]),
  );
}

/**
 * One history row per field this save changed, for every requirement the document
 * defines — plus a `STATUS` row for each one the save removed (contract I3).
 * spec: 05-baselines-and-diff.md §6
 */
async function recordIndexHistory(
  tx: Prisma.TransactionClient,
  input: ApplyIndexInput,
  definedHere: Map<string, string>,
  before: Map<string, RequirementSnapshot>,
  removedIds: readonly string[],
): Promise<void> {
  const ids = [...definedHere.values(), ...removedIds];
  const after = await snapshotRequirements(tx, ids);

  const entries: HistoryEntry[] = [];
  for (const id of ids) {
    const now = after.get(id);
    if (!now) continue;

    for (const change of changesBetween(before.get(id) ?? null, now)) {
      entries.push({
        requirementId: id,
        spaceId: input.spaceId,
        actorId: input.actorId,
        changeKind: change.changeKind,
        ...(change.before !== undefined ? { before: change.before } : {}),
        ...(change.after !== undefined ? { after: change.after } : {}),
      });
    }
  }

  await recordHistory(tx, entries);
}

/**
 * The key patterns a rename must respect, or none when the space does not lock keys.
 * Mirrors the indexer's rule exactly (spec 03 §4.3): locking is on when *any* type locks
 * it, and then every configured pattern is acceptable.
 */
export async function lockedPatternsOf(spaceId: string): Promise<string[]> {
  const types = await prisma.requirementType.findMany({
    where: { spaceId },
    select: { keyPattern: true, locked: true },
  });
  return types.some((type) => type.locked) ? types.map((type) => type.keyPattern) : [];
}

/**
 * Which of these keys are already taken in the space: by a live requirement, or still
 * claimed by a former key (`RD-051`). Both are collisions a rename preview should show
 * rather than let the job discover.
 */
export async function listLiveKeys(
  spaceId: string,
  keys: readonly string[],
): Promise<{ live: Set<string>; aliased: Set<string> }> {
  // X3-exempt: keys only, for uniqueness, which is space-wide; RD-063 words the refusal generically.
  const uppers = keys.map((key) => key.toUpperCase());
  if (uppers.length === 0) return { live: new Set(), aliased: new Set() };

  const [live, aliased] = await Promise.all([
    prisma.requirement.findMany({
      where: { spaceId, baselineId: null, upperKey: { in: uppers } },
      select: { upperKey: true },
    }),
    prisma.requirementKeyAlias.findMany({
      where: { spaceId, upperKey: { in: uppers } },
      select: { upperKey: true },
    }),
  ]);

  return {
    live: new Set(live.map((row) => row.upperKey)),
    aliased: new Set(aliased.map((row) => row.upperKey)),
  };
}

/**
 * Which of these keys are live requirements of the space **that this reader may see**,
 * as upper-cased keys. A rename selects only among these (RD-063).
 */
export async function visibleLiveKeys(viewer: Viewer, spaceId: string, keys: readonly string[]): Promise<Set<string>> {
  const uppers = [...new Set(keys.map((key) => key.toUpperCase()))];
  if (uppers.length === 0) return new Set();
  const { text, params } = render(sql`
    SELECT r."upperKey" AS "upperKey" FROM "Requirement" r
     WHERE r."spaceId" = ${param(spaceId)} AND r."baselineId" IS NULL
       AND r."upperKey" = ANY(${param(uppers)})
       AND (${substituteAlias(requirementVisibility(viewer), 'r')})
  `);
  const rows = await prisma.$queryRawUnsafe<Array<{ upperKey: string }>>(text, ...params);
  return new Set(rows.map((row) => row.upperKey));
}
