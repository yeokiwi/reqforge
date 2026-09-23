import type { SavedSearch } from '@prisma/client';
import { compile, compilePredicate, type CompileContext } from '@/domain/ryql/compiler';
import type { Expr } from '@/domain/ryql/ast';
import { param, render, sql, substituteAlias, type SqlFragment } from '@/domain/ryql/sql';
import { prisma } from './client';
import { requirementVisibility } from './visibility';

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
  // One definition, in `visibility.ts`: inheritance down the tree (RD-056) and the frozen
  // gates of rule X4 (RD-059) arrive for every existing caller, the compiler included.
  return requirementVisibility({ userId, groupIds });
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
export async function runSearch(
  expr: Expr,
  context: CompileContext,
  options: { count?: boolean } = {},
): Promise<SearchOutcome> {
  const compiled = compile(expr, context);

  // RD-068 — the API pages by cursor and reports `hasMore`; a count can cost as much as the
  // search, so it is only run when a screen shows it.
  if (options.count === false) {
    const [rows] = await withCustomPlans([compiled.text, compiled.params]);
    return { rows: rows as SearchRow[], total: -1, sql: compiled.text };
  }
  const [rows, counted] = await withCustomPlans([compiled.text, compiled.params], [compiled.countText, compiled.countParams]);
  return { rows: rows as SearchRow[], total: (counted as Array<{ count: number }>)[0]?.count ?? 0, sql: compiled.text };
}

/**
 * Every requirement id matching a query, not just a page of them. Coverage needs the
 * whole population as its denominator (spec 04 §4.1), and the per-space requirement limit
 * is 12,000 (spec 07 §4), so the bound here is generous rather than a page size.
 */
export const POPULATION_MAX = 20_000;

export async function runSearchIds(expr: Expr, context: CompileContext, max: number = POPULATION_MAX): Promise<string[]> {
  const where = compilePredicate(expr, 'r', context);
  const visibility = substituteAlias(context.visibility, 'r');

  const statement = sql`
    SELECT r.id AS id
    FROM "Requirement" r
    WHERE (${where}) AND (${visibility})
    ORDER BY r."upperKey" ASC
    LIMIT ${param(max)}
  `;

  const { text, params } = render(statement);
  const [rows] = await withCustomPlans([text, params]);
  return (rows as Array<{ id: string }>).map((row) => row.id);
}

/**
 * Runs compiled RQL with a plan made for *these* values. After five executions of a
 * prepared statement Postgres may switch to a generic plan, built without the parameter
 * values; for RQL, whose selectivity is all in the values (a space id, a property value),
 * that plan was measured 2.3× slower on the 50,000-requirement fixture (spec 07 §5,
 * RD-073). `SET LOCAL` confines the setting to this transaction.
 */
async function withCustomPlans(...statements: Array<readonly [string, readonly unknown[]]>): Promise<unknown[][]> {
  const results = await prisma.$transaction([
    prisma.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_custom_plan'),
    ...statements.map(([text, params]) => prisma.$queryRawUnsafe<unknown[]>(text, ...params)),
  ]);
  return results.slice(1) as unknown[][];
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

/**
 * The subset of `ids` the reader may actually see, under the same mandatory predicate
 * every read uses (rule X3). Write paths filter through this before touching a row, so a
 * requirement id guessed from outside cannot be written to any more than it can be read.
 */
export async function visibleRequirementIds(
  ids: readonly string[],
  userId: string,
  groupIds: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];

  const statement = sql`
    SELECT r.id AS id
    FROM "Requirement" r
    WHERE r.id = ANY(${param([...ids])}) AND (${substituteAlias(visibilityPredicate(userId, groupIds), 'r')})
  `;
  const { text, params } = render(statement);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(text, ...params);
  return rows.map((row) => row.id);
}

