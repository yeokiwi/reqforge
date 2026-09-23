import type { Prisma } from '@prisma/client';
import { join, param, render, sql, substituteAlias } from '@/domain/ryql/sql';
import { prisma } from './client';
import { requirementVisibility, type Viewer } from './visibility';

/**
 * The per-requirement change log.
 * spec: 05-baselines-and-diff.md §6 — off by default per space (research §2.7), because
 * it is the largest table in the system.
 *
 * `RD-014`: authorship is exact. Requirement Yogi warns that concurrent editing records
 * only one author and that a failed job can misattribute a change; because we own the
 * editor, every row carries the editing session's actor and is written in the **same
 * transaction** as the change it describes.
 */

/** spec 05 §6 — `KEY_RENAMED` is emitted by slice 15, which owns renaming (`RD-048`). */
export type ChangeKind =
  | 'CREATED'
  | 'TITLE'
  | 'BODY'
  | 'PROPERTY'
  | 'DEPENDENCY'
  | 'KEY_RENAMED'
  | 'TYPE'
  | 'STATUS'
  | 'EXTERNAL_PROPERTY'
  | 'BASELINED';

/** What a requirement looked like, reduced to the fields history records. */
export type RequirementSnapshot = {
  title: string;
  bodySearch: string;
  typeId: string | null;
  status: string;
  /** `searchName=value`, sorted — the same canonical form the diff compares. */
  properties: string[];
  /** `relationship → targetKey`, sorted. */
  dependencies: string[];
};

export type HistoryEntry = {
  requirementId: string;
  spaceId: string;
  actorId: string;
  changeKind: ChangeKind;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

/**
 * One row per differing field, rather than one row per save: "what changed about this
 * requirement" is the question history answers, and a save that moved only the title
 * should not look like a save that moved everything.
 */
export function changesBetween(
  before: RequirementSnapshot | null,
  after: RequirementSnapshot,
): Array<{ changeKind: ChangeKind; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue }> {
  if (!before) {
    return [{ changeKind: 'CREATED', after: { title: after.title, status: after.status } }];
  }

  const rows: Array<{ changeKind: ChangeKind; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue }> = [];

  if (before.title !== after.title) {
    rows.push({ changeKind: 'TITLE', before: { title: before.title }, after: { title: after.title } });
  }
  if (before.bodySearch !== after.bodySearch) {
    rows.push({ changeKind: 'BODY', before: { text: before.bodySearch }, after: { text: after.bodySearch } });
  }
  if (before.typeId !== after.typeId) {
    rows.push({ changeKind: 'TYPE', before: { typeId: before.typeId }, after: { typeId: after.typeId } });
  }
  if (before.status !== after.status) {
    rows.push({ changeKind: 'STATUS', before: { status: before.status }, after: { status: after.status } });
  }
  if (!sameSet(before.properties, after.properties)) {
    rows.push({ changeKind: 'PROPERTY', before: { properties: before.properties }, after: { properties: after.properties } });
  }
  if (!sameSet(before.dependencies, after.dependencies)) {
    rows.push({
      changeKind: 'DEPENDENCY',
      before: { dependencies: before.dependencies },
      after: { dependencies: after.dependencies },
    });
  }

  return rows;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}

/** Writes history inside the caller's transaction, so it cannot outlive a rollback. */
export async function recordHistory(
  tx: Prisma.TransactionClient,
  entries: readonly HistoryEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const written = await tx.requirementHistory.createMany({ data: [...entries] });
  return written.count;
}

/** The same, outside a transaction, for the paths that have none (a freeze, a bulk set). */
export async function recordHistoryDirect(entries: readonly HistoryEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const written = await prisma.requirementHistory.createMany({ data: [...entries] });
  return written.count;
}

export type HistoryFilter = {
  /** Rule X3 — the change log is requirement content; it shows only what this reader may see. */
  viewer: Viewer;
  spaceId: string;
  requirementId?: string;
  actorId?: string;
  changeKind?: ChangeKind;
  since?: Date;
  until?: Date;
  limit?: number;
};

/** spec 05 §6 — searchable by actor, by requirement, by record id and by date. */
export async function listHistory(filter: HistoryFilter) {
  const limit = Math.min(filter.limit ?? 200, 1_000);
  // The predicate is applied in SQL before the limit, so a page is a full page of rows the
  // reader may see rather than a page with holes in it (rule X2: omitted, not counted).
  const conditions = [
    sql`h."spaceId" = ${param(filter.spaceId)}`,
    substituteAlias(requirementVisibility(filter.viewer), 'r'),
  ];
  if (filter.requirementId) conditions.push(sql`h."requirementId" = ${param(filter.requirementId)}`);
  if (filter.actorId) conditions.push(sql`h."actorId" = ${param(filter.actorId)}`);
  if (filter.changeKind) conditions.push(sql`h."changeKind" = ${param(filter.changeKind)}`);
  if (filter.since) conditions.push(sql`h."at" >= ${param(filter.since)}`);
  if (filter.until) conditions.push(sql`h."at" <= ${param(filter.until)}`);

  const { text, params } = render(sql`
    SELECT h.id AS id
      FROM "RequirementHistory" h
      JOIN "Requirement" r ON r.id = h."requirementId"
     WHERE ${join(conditions, ' AND ')}
     ORDER BY h."at" DESC
     LIMIT ${param(limit)}
  `);
  const ids = (await prisma.$queryRawUnsafe<Array<{ id: string }>>(text, ...params)).map((row) => row.id);
  if (ids.length === 0) return [];

  return prisma.requirementHistory.findMany({
    where: { id: { in: ids } },
    orderBy: { at: 'desc' },
    include: { requirement: { select: { key: true } } },
  });
}

export type PruneOutcome = { removed: number; protectedByBaseline: number };

/**
 * spec 05 §6 — "retention is configurable per space; pruning never removes rows that a
 * frozen baseline depends on".
 *
 * `RD-049` states what that protects: a row dated **at or before** the `frozenAt` of a
 * frozen baseline containing that requirement is never pruned, because it is the story of
 * how the frozen text came to be — which is what an auditor reads beside the snapshot.
 * Churn after the freeze ages out normally.
 */
export async function pruneHistory(spaceId: string, retentionDays: number): Promise<PruneOutcome> {
  // X3-exempt: retention maintenance for space ADMIN; deletes, shows nothing.
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // The latest freeze that covers each requirement: everything up to it is protected.
  const frozen = await prisma.requirement.findMany({
    where: { spaceId, baselineId: { not: null }, baseline: { state: 'FROZEN', frozenAt: { not: null } } },
    select: { upperKey: true, baseline: { select: { frozenAt: true } } },
  });

  const protectedUntil = new Map<string, Date>();
  for (const row of frozen) {
    const at = row.baseline?.frozenAt;
    if (!at) continue;
    const current = protectedUntil.get(row.upperKey);
    if (!current || at > current) protectedUntil.set(row.upperKey, at);
  }

  const candidates = await prisma.requirementHistory.findMany({
    where: { spaceId, at: { lt: cutoff } },
    select: { id: true, at: true, requirement: { select: { upperKey: true, baselineId: true } } },
  });

  const removable: string[] = [];
  let protectedCount = 0;

  for (const row of candidates) {
    const key = row.requirement.upperKey;
    const shield = protectedUntil.get(key);
    if (shield && row.at <= shield) {
      protectedCount += 1;
      continue;
    }
    removable.push(row.id);
  }

  const removed = removable.length > 0
    ? (await prisma.requirementHistory.deleteMany({ where: { id: { in: removable } } })).count
    : 0;

  return { removed, protectedByBaseline: protectedCount };
}
