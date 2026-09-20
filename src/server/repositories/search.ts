import type { SavedSearch } from '@prisma/client';
import { compile, type CompileContext } from '@/domain/ryql/compiler';
import type { Expr } from '@/domain/ryql/ast';
import { param, sql, type SqlFragment } from '@/domain/ryql/sql';
import { prisma } from './client';

export type SearchRow = {
  id: string;
  spaceId: string;
  key: string;
  upperKey: string;
  title: string;
  bodyHtml: string;
  status: string;
  baselineId: string | null;
  typeId: string | null;
  originVersionId: string | null;
  anchorPath: string;
};

/**
 * The mandatory visibility predicate, injected into every requirement query including the
 * RQL compiler's output. There is no code path that reads requirements without it.
 * spec: 07-permissions-and-limits.md rules X1–X3; RD-017
 *
 * `$alias` is replaced by the compiler with the requirement alias in scope, so it applies
 * to traversal hops as well as to the outer query.
 */
export function visibilityPredicate(userId: string, groupIds: readonly string[]): SqlFragment {
  const groups = groupIds.length > 0 ? groupIds : [''];

  return sql`
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."spaceId" = $alias."spaceId"
        AND 'VIEW' = ANY(m.permissions)
        AND (m."userId" = ${param(userId)} OR m."groupId" = ANY(${param(groups)}))
    )
    AND NOT EXISTS (
      SELECT 1 FROM "DocumentVersion" dv
      JOIN "Document" d ON d.id = dv."documentId"
      WHERE dv.id = $alias."originVersionId"
        AND d."restrictionMode" = 'EXPLICIT'
        AND NOT EXISTS (
          SELECT 1 FROM "DocumentRestriction" dr
          WHERE dr."documentId" = d.id
            AND dr."canView"
            AND (dr."userId" = ${param(userId)} OR dr."groupId" = ANY(${param(groups)}))
        )
    )
  `;
}

export async function groupIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  return rows.map((row) => row.groupId);
}

export type SearchOutcome = { rows: SearchRow[]; total: number; sql: string };

/**
 * Runs a compiled RQL query. This is the only place the compiler's SQL is executed, and
 * it is executed with bound parameters — the compiler never interpolates a value.
 */
export async function runSearch(expr: Expr, context: CompileContext): Promise<SearchOutcome> {
  const compiled = compile(expr, context);

  const rows = await prisma.$queryRawUnsafe<SearchRow[]>(compiled.text, ...compiled.params);
  const counted = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    compiled.countText,
    ...compiled.countParams,
  );

  return { rows, total: counted[0]?.count ?? 0, sql: compiled.text };
}

export async function listSavedSearches(spaceId: string, userId: string): Promise<SavedSearch[]> {
  return prisma.savedSearch.findMany({
    where: { spaceId, OR: [{ visibility: 'space' }, { ownerId: userId }] },
    orderBy: { name: 'asc' },
  });
}

export async function saveSearch(input: {
  spaceId: string;
  name: string;
  query: string;
  ownerId: string;
  visibility: string;
}): Promise<SavedSearch> {
  return prisma.savedSearch.upsert({
    where: { spaceId_name: { spaceId: input.spaceId, name: input.name } },
    update: { query: input.query, visibility: input.visibility },
    create: input,
  });
}

export async function deleteSavedSearch(spaceId: string, id: string): Promise<void> {
  await prisma.savedSearch.deleteMany({ where: { id, spaceId } });
}
