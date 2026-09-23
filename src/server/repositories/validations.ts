import type { Prisma, ValidationStatus } from '@prisma/client';
import type { Diagnostic } from '@/domain/indexer';
import { messagesOf } from '@/domain/validation';
import { prisma } from './client';
import { param, render, sql, substituteAlias } from '@/domain/ryql/sql';
import { requirementVisibility, type Viewer } from './visibility';

/**
 * Cached validation results, which RQL's `ruleStatus` field reads.
 * spec: 06-requirement-types.md §2.1 ("Results are cached in `RequirementValidation`");
 * 02 §4 (`ruleStatus`, `ruleStatus@<type>`)
 */

export type ValidationRow = {
  requirementId: string;
  typeId: string;
  status: ValidationStatus;
  diagnostics: Diagnostic[];
};

/**
 * Replaces the validation rows of a set of requirements. The delete is over the
 * requirement ids rather than over `(requirementId, typeId)`, so a requirement whose type
 * changed does not keep a stale row that `ruleStatus@<old type>` would still match.
 */
export async function writeValidations(
  tx: Prisma.TransactionClient,
  requirementIds: readonly string[],
  rows: readonly ValidationRow[],
): Promise<void> {
  if (requirementIds.length === 0) return;

  await tx.requirementValidation.deleteMany({ where: { requirementId: { in: [...requirementIds] } } });
  if (rows.length === 0) return;

  await tx.requirementValidation.createMany({
    data: rows.map((row) => ({
      requirementId: row.requirementId,
      typeId: row.typeId,
      status: row.status,
      messages: messagesOf(row.diagnostics) as unknown as Prisma.InputJsonValue,
    })),
  });
}

export async function clearValidations(requirementIds: readonly string[]): Promise<void> {
  if (requirementIds.length === 0) return;
  await prisma.requirementValidation.deleteMany({ where: { requirementId: { in: [...requirementIds] } } });
}

export type StatusCounts = { TRUE: number; FALSE: number; WARNING: number };

/** Counts for every type of a space in one query — the screen lists them all. */
/** The types screen's rule-status figures, counted over what this reader may see (rule X2). */
export async function countByStatusForSpace(viewer: Viewer, spaceId: string): Promise<Map<string, StatusCounts>> {
  const { text, params } = render(sql`
    SELECT v."typeId" AS "typeId", v.status::text AS status, count(*)::int AS n
      FROM "RequirementValidation" v
      JOIN "Requirement" r ON r.id = v."requirementId"
     WHERE r."spaceId" = ${param(spaceId)} AND r."baselineId" IS NULL AND r.status <> 'DELETED'
       AND (${substituteAlias(requirementVisibility(viewer), 'r')})
     GROUP BY v."typeId", v.status
  `);
  const rows = await prisma.$queryRawUnsafe<Array<{ typeId: string; status: keyof StatusCounts; n: number }>>(text, ...params);

  const counts = new Map<string, StatusCounts>();
  for (const row of rows) {
    const current = counts.get(row.typeId) ?? { TRUE: 0, FALSE: 0, WARNING: 0 };
    current[row.status] = row.n;
    counts.set(row.typeId, current);
  }
  return counts;
}

/**
 * The revalidation job's writer. Outside a transaction because the job runs page by page
 * and must leave each page's results durable before it starts the next — a cancel halfway
 * through keeps the work already done (spec 06 §2.2 trigger 2).
 *
 * Unlike `writeValidations`, the delete is over `(requirementId, typeId)`: the job is
 * revalidating one type, and a requirement's rows for other types are not its business.
 */
export async function writeValidationsOutsideTransaction(rows: readonly ValidationRow[]): Promise<void> {
  if (rows.length === 0) return;

  await prisma.$transaction([
    prisma.requirementValidation.deleteMany({
      where: {
        requirementId: { in: rows.map((row) => row.requirementId) },
        typeId: rows[0]!.typeId,
      },
    }),
    prisma.requirementValidation.createMany({
      data: rows.map((row) => ({
        requirementId: row.requirementId,
        typeId: row.typeId,
        status: row.status,
        messages: messagesOf(row.diagnostics) as unknown as Prisma.InputJsonValue,
      })),
    }),
  ]);
}

export type ValidationSubject = {
  id: string;
  key: string;
  anchorPath: string;
  properties: Array<{ name: string; searchName: string; value: string }>;
  outbound: string[];
  inbound: string[];
};

/**
 * Everything validating a page of requirements needs, in three batched queries — one for
 * properties, one for outbound edges, one for inbound.
 * spec: 06-requirement-types.md §2.3 — the per-requirement cost stays zero however large
 * the page is, which is what the acceptance query-counter test pins.
 */
export async function fetchValidationSubjects(
  rows: ReadonlyArray<{ id: string; key: string; anchorPath: string }>,
): Promise<ValidationSubject[]> {
  // X3-exempt: the revalidation job writes statuses; it shows nothing.
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [properties, outbound, inbound] = await Promise.all([
    prisma.property.findMany({
      where: { requirementId: { in: ids } },
      select: { requirementId: true, name: true, searchName: true, value: true },
      orderBy: [{ valueOrdinal: 'asc' }, { valueIndex: 'asc' }],
    }),
    prisma.dependency.findMany({
      where: { childId: { in: ids } },
      select: { childId: true, relationship: true },
    }),
    prisma.dependency.findMany({
      where: { parentId: { in: ids } },
      select: { parentId: true, relationship: true },
    }),
  ]);

  const group = <T>(entries: readonly T[], key: (entry: T) => string) => {
    const map = new Map<string, T[]>();
    for (const entry of entries) map.set(key(entry), [...(map.get(key(entry)) ?? []), entry]);
    return map;
  };

  const byRequirement = group(properties, (property) => property.requirementId);
  const outboundBy = group(outbound, (edge) => edge.childId);
  const inboundBy = group(inbound, (edge) => edge.parentId);

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    anchorPath: row.anchorPath,
    properties: (byRequirement.get(row.id) ?? []).map((property) => ({
      name: property.name,
      searchName: property.searchName,
      value: property.value,
    })),
    outbound: (outboundBy.get(row.id) ?? []).map((edge) => edge.relationship),
    inbound: (inboundBy.get(row.id) ?? []).map((edge) => edge.relationship),
  }));
}
