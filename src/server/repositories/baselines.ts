import type { Baseline, BaselineRevision, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '@/domain/errors';
import type { Edge } from '@/domain/baselines';
import { prisma } from './client';
import { recordAuditEvent } from './audit';
import { param, render, sql, substituteAlias } from '@/domain/ryql/sql';
import { requirementVisibility, SYSTEM, visibleRequirementIdsFor, type ReaderScope, type Viewer } from './visibility';

/**
 * Baselines: draft, freeze, refreeze.
 * spec: 05-baselines-and-diff.md §2–4; invariants B1 (a draft owns no rows) and B2
 * (numbers are sequential, immutable and never reused).
 *
 * Every write of a frozen row is an INSERT or a DELETE, never an UPDATE, because the
 * invariant-R2 trigger rejects updating a row with a baseline (spec 01). That is not a
 * workaround: it is what makes "frozen" mean something an auditor can check.
 */

export type BaselineWithCounts = Baseline & { memberCount: number };

/**
 * The baselines of a space. That a baseline exists, and its name, are not restricted —
 * its **member count** is, because rule X2 says hidden requirements are not counted, and
 * rule X4 means a snapshot can hide rows its live counterpart would show.
 */
export async function listBaselines(viewer: Viewer, spaceId: string): Promise<BaselineWithCounts[]> {
  const { text, params } = render(sql`
    SELECT r."baselineId" AS "baselineId", count(*)::int AS n
      FROM "Requirement" r
     WHERE r."spaceId" = ${param(spaceId)} AND r."baselineId" IS NOT NULL
       AND (${substituteAlias(requirementVisibility(viewer), 'r')})
     GROUP BY r."baselineId"
  `);
  const [baselines, counts] = await Promise.all([
    prisma.baseline.findMany({ where: { spaceId }, orderBy: { number: 'desc' } }),
    prisma.$queryRawUnsafe<Array<{ baselineId: string; n: number }>>(text, ...params),
  ]);

  const byBaseline = new Map(counts.map((row) => [row.baselineId, row.n]));
  return baselines.map((baseline) => ({ ...baseline, memberCount: byBaseline.get(baseline.id) ?? 0 }));
}

export async function findBaselineByNumber(spaceId: string, number: number): Promise<Baseline | null> {
  return prisma.baseline.findFirst({ where: { spaceId, number } });
}

export async function findBaselineById(spaceId: string, id: string): Promise<Baseline | null> {
  return prisma.baseline.findFirst({ where: { spaceId, id } });
}

/** Unscoped, for the job runner, which has already re-checked ADMIN on the space. */
export async function findBaseline(id: string): Promise<Baseline | null> {
  return prisma.baseline.findUnique({ where: { id } });
}

/**
 * Creates a DRAFT.
 *
 * **Invariant B2** — spec 05 §4: the number is "sequential per space, assigned at
 * creation, immutable, never reused, including after deletion". It therefore comes from
 * `Space.nextBaselineNumber`, a counter that only moves forward, read and incremented in
 * the same transaction. Deriving it from `max(number)` over the surviving rows would
 * reissue the number of a deleted baseline, and two different snapshots could then both
 * be cited as "baseline 5" in two different audits.
 */
export async function createDraft(input: {
  spaceId: string;
  name: string;
  sourceQuery: string;
  includedDependencies: boolean;
  includedExternal: boolean;
  createdById: string;
}): Promise<Baseline> {
  return prisma.$transaction(async (tx) => {
    // Incremented first, so the number is taken even if the create below fails: a gap in
    // the sequence is harmless, a reused number is not.
    const space = await tx.space.update({
      where: { id: input.spaceId },
      data: { nextBaselineNumber: { increment: 1 } },
      select: { nextBaselineNumber: true },
    });
    const next = space.nextBaselineNumber - 1;

    return tx.baseline.create({
      data: {
        spaceId: input.spaceId,
        number: next,
        name: input.name,
        state: 'DRAFT',
        sourceQuery: input.sourceQuery,
        includedDependencies: input.includedDependencies,
        includedExternal: input.includedExternal,
        createdById: input.createdById,
      },
    });
  });
}

export async function attachReportDocument(baselineId: string, documentId: string): Promise<void> {
  await prisma.baseline.update({ where: { id: baselineId }, data: { reportDocumentId: documentId } });
}

export async function renameBaseline(spaceId: string, id: string, name: string): Promise<Baseline> {
  const baseline = await findBaselineById(spaceId, id);
  if (!baseline) throw new NotFoundError('That baseline no longer exists.');
  // spec 05 §4 — the name is free text and renameable; the number never moves.
  return prisma.baseline.update({ where: { id }, data: { name } });
}

/** Deleting takes the frozen rows with it (ON DELETE CASCADE) and nothing else. */
export async function deleteBaseline(spaceId: string, id: string): Promise<void> {
  const baseline = await findBaselineById(spaceId, id);
  if (!baseline) throw new NotFoundError('That baseline no longer exists.');
  await prisma.baseline.deleteMany({ where: { id, spaceId } });
}

// ------------------------------------------------------------------ the freeze itself

/** One member, read from its live row, ready to be copied. */
export type MemberSource = {
  id: string;
  key: string;
  upperKey: string;
  uid: string;
  title: string;
  bodyHtml: string;
  bodySearch: string;
  anchorPath: string;
  typeId: string | null;
  originVersionId: string | null;
};

/** The live rows behind a page of member keys, in key order. */
/**
 * The upper-cased keys of `ids`, in key order.
 * X3-exempt: `ids` come only from `runSearchIds`, which applied the visibility predicate.
 */
export async function upperKeysOf(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.requirement.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { upperKey: 'asc' },
    select: { upperKey: true },
  });
  return rows.map((row) => row.upperKey);
}

/**
 * X3-exempt: the freeze job copies these rows into the baseline; it shows none of them.
 * Parents added by the closure may be hidden from the person freezing — RD-059 keeps them
 * in the snapshot and protects them with their frozen gates.
 */
export async function loadMembers(spaceId: string, keys: readonly string[]): Promise<MemberSource[]> {
  if (keys.length === 0) return [];
  return prisma.requirement.findMany({
    where: { spaceId, baselineId: null, upperKey: { in: keys.map((key) => key.toUpperCase()) } },
    orderBy: { upperKey: 'asc' },
    select: {
      id: true,
      key: true,
      upperKey: true,
      uid: true,
      title: true,
      bodyHtml: true,
      bodySearch: true,
      anchorPath: true,
      typeId: true,
      originVersionId: true,
    },
  });
}

/** Every dependency edge among a set of live requirements, by key (invariant P1). */
/** X3-exempt: edges by key, for the closure and the dangling partition; no content. */
export async function loadEdges(spaceId: string, keys: readonly string[]): Promise<Edge[]> {
  if (keys.length === 0) return [];
  const upper = keys.map((key) => key.toUpperCase());

  const rows = await prisma.dependency.findMany({
    where: { child: { spaceId, baselineId: null, upperKey: { in: upper } } },
    select: {
      relationship: true,
      child: { select: { upperKey: true } },
      parent: { select: { upperKey: true } },
    },
  });

  return rows.map((row) => ({
    childKey: row.child.upperKey,
    parentKey: row.parent.upperKey,
    relationship: row.relationship,
  }));
}

export type FrozenRow = MemberSource & { frozenBodyHtml: string };

/**
 * Writes one batch of members into the baseline, in one transaction.
 * spec 05 §3.2 steps 3, 4 and 6 — rows, inline properties, external properties under
 * `RD-010`, and the pinned versions. Dependencies (step 5) are written once after the
 * last batch: an edge whose two ends landed in different batches is still internal.
 *
 * Batched at 500 because RY's own docs name baseline creation as the operation that
 * exhausts the heap (research §6.7).
 */
export async function writeFrozenBatch(input: {
  // X3-exempt: the freeze job copies rows into a baseline; it shows none of them (RD-059 protects them).
  spaceId: string;
  baselineId: string;
  rows: readonly FrozenRow[];
  includedExternal: boolean;
  actorId: string;
  historyEnabled: boolean;
}): Promise<number> {
  if (input.rows.length === 0) return 0;

  return prisma.$transaction(async (tx) => {
    const created = await Promise.all(
      input.rows.map((row) =>
        tx.requirement.create({
          data: {
            spaceId: input.spaceId,
            baselineId: input.baselineId,
            key: row.key,
            upperKey: row.upperKey,
            uid: row.uid,
            // spec 05 §3.2 step 3 — a frozen row is ARCHIVED, and `baseline = N` finds
            // it because the analyser drops the ACTIVE default (spec 02 §8 rule 4).
            status: 'ARCHIVED',
            title: row.title,
            bodyHtml: row.frozenBodyHtml,
            bodySearch: row.bodySearch,
            anchorPath: row.anchorPath,
            typeId: row.typeId,
            originVersionId: row.originVersionId,
          },
          select: { id: true, upperKey: true },
        }),
      ),
    );

    const frozenIdByKey = new Map(created.map((row) => [row.upperKey, row.id]));
    const liveIds = input.rows.map((row) => row.id);

    // Properties: inline always, external only under RD-010.
    const properties = await tx.property.findMany({
      where: {
        requirementId: { in: liveIds },
        ...(input.includedExternal ? {} : { kind: 'INLINE' }),
      },
    });

    const liveKeyById = new Map(input.rows.map((row) => [row.id, row.upperKey]));
    if (properties.length > 0) {
      await tx.property.createMany({
        data: properties.flatMap((property) => {
          const frozenId = frozenIdByKey.get(liveKeyById.get(property.requirementId) ?? '');
          if (!frozenId) return [];
          return [
            {
              requirementId: frozenId,
              kind: property.kind,
              name: property.name,
              searchName: property.searchName,
              value: property.value,
              valueOrdinal: property.valueOrdinal,
              valueIndex: property.valueIndex,
              definitionId: property.definitionId,
            },
          ];
        }),
      });
    }

    // spec 05 §6 — the live requirement records that it was captured (RD-048).
    const historyRows = input.rows.map((row) => ({
      requirementId: row.id,
      spaceId: input.spaceId,
      actorId: input.actorId,
      changeKind: 'BASELINED',
      after: { baselineId: input.baselineId, key: row.key } as Prisma.InputJsonValue,
    }));
    if (input.historyEnabled && historyRows.length > 0) {
      await tx.requirementHistory.createMany({ data: historyRows });
    }

    // spec 05 §3.2 step 6 — pin the versions these rows were extracted from. A pinned
    // version is undeletable, enforced by a trigger (research §5.3 leak 3).
    const versionIds = [...new Set(input.rows.flatMap((row) => (row.originVersionId ? [row.originVersionId] : [])))];
    if (versionIds.length > 0) {
      await tx.documentVersion.updateMany({ where: { id: { in: versionIds } }, data: { pinned: true } });
    }

    return created.length;
  });
}

/**
 * spec 05 §3.2 step 5 — the dependencies wholly inside the baseline, copied between the
 * frozen rows. Run once after the last batch, so an edge whose two ends landed in
 * different batches is not lost.
 */
export async function writeInternalEdges(baselineId: string, edges: readonly Edge[]): Promise<number> {
  // X3-exempt: the freeze job writes edges between frozen rows; it shows nothing.
  if (edges.length === 0) return 0;

  const rows = await prisma.requirement.findMany({
    where: { baselineId },
    select: { id: true, upperKey: true },
  });
  const idByKey = new Map(rows.map((row) => [row.upperKey, row.id]));

  const data = edges.flatMap((edge) => {
    const childId = idByKey.get(edge.childKey);
    const parentId = idByKey.get(edge.parentKey);
    if (!childId || !parentId) return [];
    return [{ childId, parentId, relationship: edge.relationship }];
  });

  const written = await prisma.dependency.createMany({ data, skipDuplicates: true });
  return written.count;
}

/** spec 05 §3.2 step 5 — recorded so the diff can explain them, never dropped. */
export async function writeDangling(baselineId: string, edges: readonly Edge[]): Promise<void> {
  await prisma.baselineDanglingDependency.deleteMany({ where: { baselineId } });
  if (edges.length === 0) return;

  await prisma.baselineDanglingDependency.createMany({
    data: edges.map((edge) => ({
      baselineId,
      childKey: edge.childKey,
      relationship: edge.relationship,
      targetKey: edge.parentKey,
    })),
  });
}

/**
 * A baseline's dangling edges, for the rows of it this reader may see: a dangling edge is
 * declared by a frozen member, and a member the reader cannot see declares nothing they
 * may read (rule X2). The target is a key only, which is never secret.
 */
export async function listDangling(viewer: Viewer, baselineId: string) {
  const [dangling, members] = await Promise.all([
    prisma.baselineDanglingDependency.findMany({ where: { baselineId }, orderBy: { childKey: 'asc' } }),
    prisma.requirement.findMany({ where: { baselineId }, select: { id: true, upperKey: true } }),
  ]);
  const visible = await visibleRequirementIdsFor(viewer, members.map((member) => member.id));
  const visibleKeys = new Set(members.filter((member) => visible.has(member.id)).map((member) => member.upperKey));
  return dangling.filter((row) => visibleKeys.has(row.childKey.toUpperCase()));
}

/** The members table of a baseline page, as this reader may see it (rules X2, X4). */
export async function listMembers(viewer: Viewer, baselineId: string, limit = 600) {
  const { text, params } = render(sql`
    SELECT r.id, r.key, r.title, r.status::text AS status
      FROM "Requirement" r
     WHERE r."baselineId" = ${param(baselineId)}
       AND (${substituteAlias(requirementVisibility(viewer), 'r')})
     ORDER BY r."upperKey" ASC
     LIMIT ${param(limit)}
  `);
  return prisma.$queryRawUnsafe<Array<{ id: string; key: string; title: string; status: string }>>(text, ...params);
}

export async function markFrozen(baselineId: string, frozenById: string): Promise<Baseline> {
  return prisma.baseline.update({
    where: { id: baselineId },
    data: { state: 'FROZEN', frozenAt: new Date(), frozenById },
  });
}

/** Empties a baseline's rows — the first half of a refreeze, and of a cancelled freeze. */
export async function clearBaselineRows(baselineId: string): Promise<number> {
  const removed = await prisma.requirement.deleteMany({ where: { baselineId } });
  return removed.count;
}

export async function countMembers(baselineId: string, reader: ReaderScope): Promise<number> {
  if (reader === SYSTEM) return prisma.requirement.count({ where: { baselineId } });
  const { text, params } = render(sql`
    SELECT count(*)::int AS n FROM "Requirement" r
     WHERE r."baselineId" = ${param(baselineId)}
       AND (${substituteAlias(requirementVisibility(reader), 'r')})
  `);
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(text, ...params);
  return rows[0]?.n ?? 0;
}

export async function frozenMemberKeys(baselineId: string): Promise<string[]> {
  // X3-exempt: the refreeze stores the key lists in its revision record; the screen shows counts only.
  const rows = await prisma.requirement.findMany({
    where: { baselineId },
    orderBy: { upperKey: 'asc' },
    select: { upperKey: true },
  });
  return rows.map((row) => row.upperKey);
}

// ------------------------------------------------------------------ refreeze, §3.4

/**
 * spec 05 §3.4 — "a `BaselineRevision` audit row recording who, when, why and the
 * before/after member counts. A refrozen baseline is visibly marked as revised; the
 * revision history is not erasable."
 */
export async function recordRevision(input: {
  baselineId: string;
  actorId: string;
  reason: string;
  countBefore: number;
  countAfter: number;
  detail: Prisma.InputJsonValue;
}): Promise<BaselineRevision> {
  return prisma.baselineRevision.create({ data: input });
}

export async function listRevisions(baselineId: string): Promise<BaselineRevision[]> {
  return prisma.baselineRevision.findMany({ where: { baselineId }, orderBy: { at: 'desc' } });
}

export async function requireFrozen(spaceId: string, id: string): Promise<Baseline> {
  const baseline = await findBaselineById(spaceId, id);
  if (!baseline) throw new NotFoundError('That baseline no longer exists.');
  if (baseline.state !== 'FROZEN') {
    throw new ConflictError(`Baseline ${baseline.number} is still a draft. Freeze it before revising it.`);
  }
  return baseline;
}

// ------------------------------------------------------------------ audit, spec 07 §6

/**
 * Append-only, never pruned. Freeze, refreeze and delete are what an auditor asks about.
 * The general form lives in `repositories/audit.ts`; this saves the baseline callers
 * repeating `objectType` at every site.
 */
export async function recordAudit(input: {
  actorId: string;
  spaceId: string;
  objectId: string;
  operation: string;
  parameters: Prisma.InputJsonValue;
}): Promise<void> {
  await recordAuditEvent({ ...input, objectType: 'Baseline' });
}

/**
 * The baselines whose snapshot holds this key.
 * spec 05 §4 — addressing is `<SPACE>/<KEY>/<number|current>`, so a requirement should
 * say which numbered snapshots it appears in and let you read each one.
 */
export async function baselinesContaining(viewer: Viewer, spaceId: string, upperKey: string) {
  const rows = await prisma.requirement.findMany({
    where: { spaceId, upperKey, baselineId: { not: null } },
    select: { id: true, baseline: { select: { id: true, number: true, name: true, frozenAt: true } } },
  });
  // Rule X4 — a snapshot frozen while the document was restricted stays hidden from a
  // reader the freeze-time restriction excluded, even if the document is open now.
  const visible = await visibleRequirementIdsFor(viewer, rows.map((row) => row.id));

  return rows
    .filter((row) => visible.has(row.id))
    .flatMap((row) => (row.baseline ? [row.baseline] : []))
    .sort((a, b) => b.number - a.number);
}
