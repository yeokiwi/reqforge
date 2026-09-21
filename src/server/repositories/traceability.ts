import { param, raw, render, sql, substituteAlias, type SqlFragment } from '@/domain/ryql/sql';
import { columnId, type MatrixCell, type MatrixColumn } from '@/domain/traceability/matrix';
import { prisma } from './client';
import type { SearchRow } from './search';

export type CellsByRow = Map<string, Record<string, MatrixCell>>;

export type DocumentOfRow = { documentId: string | null; documentTitle: string | null };

type DependencyHit = { src: string; key: string; title: string; visible: boolean };

/**
 * Phase two of the matrix fetch: one batched query per column kind, for exactly the ids
 * on this page. Never one query per row.
 * spec: 04-traceability-and-coverage.md §2.5
 */
export async function fetchMatrixCells(input: {
  rows: readonly SearchRow[];
  columns: readonly MatrixColumn[];
  /** The same mandatory predicate the row query used (rule X3), for the far side of edges. */
  visibility: SqlFragment;
}): Promise<CellsByRow> {
  const cells: CellsByRow = new Map(input.rows.map((row) => [row.id, {}]));
  const ids = input.rows.map((row) => row.id);
  if (ids.length === 0) return cells;

  const put = (rowId: string, id: string, cell: MatrixCell) => {
    const row = cells.get(rowId);
    if (row) row[id] = cell;
  };

  // --- the columns that are already on the row -----------------------------------------
  for (const row of input.rows) {
    for (const column of input.columns) {
      if (column.kind === 'key') put(row.id, 'key', { text: row.key });
      if (column.kind === 'title') put(row.id, 'title', { text: row.title });
      if (column.kind === 'status') put(row.id, 'status', { text: row.status });
    }
  }

  // --- inline and external properties: one query per kind ------------------------------
  for (const kind of ['INLINE', 'EXTERNAL'] as const) {
    const wanted = input.columns.filter(
      (column): column is Extract<MatrixColumn, { kind: 'property' | 'external' }> =>
        (kind === 'INLINE' && column.kind === 'property') || (kind === 'EXTERNAL' && column.kind === 'external'),
    );
    if (wanted.length === 0) continue;

    const searchNames = [...new Set(wanted.map((column) => column.name.trim().toLowerCase()))];
    const values = await prisma.property.findMany({
      where: { requirementId: { in: ids }, kind, searchName: { in: searchNames } },
      select: { requirementId: true, searchName: true, value: true, valueIndex: true },
      orderBy: [{ valueOrdinal: 'asc' }, { valueIndex: 'asc' }],
    });

    const byRowAndName = new Map<string, string[]>();
    for (const value of values) {
      const mapKey = `${value.requirementId}:${value.searchName}`;
      byRowAndName.set(mapKey, [...(byRowAndName.get(mapKey) ?? []), value.value]);
    }

    for (const column of wanted) {
      const id = columnId(column);
      const searchName = column.name.trim().toLowerCase();
      for (const row of input.rows) {
        // A list-valued property is several rows (RD-027); the cell shows every member.
        const members = byRowAndName.get(`${row.id}:${searchName}`) ?? [];
        put(row.id, id, { text: members.join(', ') });
      }
    }
  }

  // --- rule status: one query ----------------------------------------------------------
  const ruleColumns = input.columns.filter(
    (column): column is Extract<MatrixColumn, { kind: 'ruleStatus' }> => column.kind === 'ruleStatus',
  );
  if (ruleColumns.length > 0) {
    const validations = await prisma.requirementValidation.findMany({
      where: { requirementId: { in: ids } },
      select: { requirementId: true, typeId: true, status: true },
    });

    for (const column of ruleColumns) {
      const id = columnId(column);
      for (const row of input.rows) {
        const match = validations.find(
          (validation) =>
            validation.requirementId === row.id &&
            (column.typeId === undefined || validation.typeId === column.typeId),
        );
        put(row.id, id, { text: match ? match.status.toLowerCase() : '' });
      }
    }
  }

  // --- dependency columns: one query each ----------------------------------------------
  for (const column of input.columns) {
    if (column.kind !== 'dependency') continue;
    const id = columnId(column);
    const hits = await fetchDependencyColumn(ids, column, input.visibility);

    for (const row of input.rows) {
      const reached = hits.filter((hit) => hit.src === row.id);
      put(row.id, id, renderDependencyCell(column, reached));
    }
  }

  return cells;
}

function renderDependencyCell(
  column: Extract<MatrixColumn, { kind: 'dependency' }>,
  hits: readonly DependencyHit[],
): MatrixCell {
  const keys = hits.map((hit) => hit.key);

  if (column.render === 'count') return { text: String(hits.length), keys, count: hits.length };

  if (column.render === 'key+title') {
    return {
      text: hits
        // Rule X2: the existence of a link is not secret, its target's content is.
        .map((hit) => `${hit.key} — ${hit.visible ? hit.title : 'restricted'}`)
        .join('; '),
      keys,
      count: hits.length,
    };
  }

  return { text: keys.join(', '), keys, count: hits.length };
}

/**
 * Depth 1 is a join; depth 2–4 is one recursive CTE with a visited-set guard, so a cyclic
 * dependency graph terminates by construction.
 * spec: 04 §2.5; 02 §5.2; RD-021
 */
async function fetchDependencyColumn(
  ids: readonly string[],
  column: Extract<MatrixColumn, { kind: 'dependency' }>,
  visibility: SqlFragment,
): Promise<DependencyHit[]> {
  // Invariant P1: `to` walks child → parent, `from` walks parent → child.
  const [selfColumn, otherColumn] =
    column.direction === 'to' ? ['"childId"', '"parentId"'] : ['"parentId"', '"childId"'];

  const relationship = column.relationship ? sql`AND d.relationship = ${param(column.relationship)}` : raw('');
  const visibleHere = substituteAlias(visibility, 'other');

  const statement =
    column.depth === 1
      ? sql`
          SELECT d.${raw(selfColumn)} AS src, other.key AS key, other.title AS title,
                 (${visibleHere}) AS visible
          FROM "Dependency" d
          JOIN "Requirement" other ON other.id = d.${raw(otherColumn)}
          WHERE d.${raw(selfColumn)} = ANY(${param(ids)}) ${relationship}
          ORDER BY other."upperKey" ASC
        `
      : sql`
          WITH RECURSIVE walk(src, id, depth, path) AS (
            SELECT r.id, r.id, 0, ARRAY[r.id]
            FROM "Requirement" r
            WHERE r.id = ANY(${param(ids)})
            UNION ALL
            SELECT w.src, other.id, w.depth + 1, w.path || other.id
            FROM walk w
            JOIN "Dependency" d ON d.${raw(selfColumn)} = w.id
            JOIN "Requirement" other ON other.id = d.${raw(otherColumn)}
            WHERE w.depth < ${param(column.depth)}
              AND NOT (other.id = ANY(w.path)) ${relationship}
          )
          SELECT DISTINCT w.src AS src, other.key AS key, other.title AS title,
                 (${visibleHere}) AS visible
          FROM walk w
          JOIN "Requirement" other ON other.id = w.id
          WHERE w.depth > 0
          ORDER BY other.key ASC
        `;

  const { text, params } = render(statement);
  return prisma.$queryRawUnsafe<DependencyHit[]>(text, ...params);
}

/** The defining document of each row — the tree view and the `document` column. */
export async function fetchDefiningDocuments(ids: readonly string[]): Promise<Map<string, DocumentOfRow>> {
  if (ids.length === 0) return new Map();

  const links = await prisma.documentLink.findMany({
    where: { requirementId: { in: [...ids] }, origin: true },
    select: { requirementId: true, version: { select: { document: { select: { id: true, title: true } } } } },
  });

  return new Map(
    links.map((link) => [
      link.requirementId,
      { documentId: link.version.document.id, documentTitle: link.version.document.title },
    ]),
  );
}
