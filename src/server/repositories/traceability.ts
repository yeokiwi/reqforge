import { param, raw, render, sql, substituteAlias, type SqlFragment } from '@/domain/ryql/sql';
import { columnId, type MatrixCell, type MatrixColumn } from '@/domain/traceability/matrix';
import { prisma } from './client';
import { visibleDocumentIds, type Viewer } from './visibility';
import type { SearchRow } from './search';

export type CellsByRow = Map<string, Record<string, MatrixCell>>;

export type PopulationEdge = { fromKey: string; toKey: string; relationship: string };

/**
 * Dependencies from one set of requirements to another, in one query.
 * The export pages over rows but keeps the full axis as columns, so the two sets differ:
 * an edge from this page to a requirement on another page still belongs in the grid.
 * spec: 04-traceability-and-coverage.md §3
 */
export async function fetchEdgesBetween(
  fromIds: readonly string[],
  toIds: readonly string[],
): Promise<PopulationEdge[]> {
  // X3-exempt: both id sets come from the caller's visible populations.
  if (fromIds.length === 0 || toIds.length === 0) return [];

  const statement = sql`
    SELECT child.key AS "fromKey", parent.key AS "toKey", d.relationship AS relationship
    FROM "Dependency" d
    JOIN "Requirement" child ON child.id = d."childId"
    JOIN "Requirement" parent ON parent.id = d."parentId"
    WHERE d."childId" = ANY(${param(fromIds)}) AND d."parentId" = ANY(${param(toIds)})
    ORDER BY child."upperKey" ASC, parent."upperKey" ASC
  `;

  const { text, params } = render(statement);
  return prisma.$queryRawUnsafe<PopulationEdge[]>(text, ...params);
}

/** Every dependency **within** a population, which is what the on-screen grid shows. */
export async function fetchEdgesWithin(ids: readonly string[]): Promise<PopulationEdge[]> {
  return fetchEdgesBetween(ids, ids);
}

export type CoverageCountRow = { relationship: string; direction: 'to' | 'from'; covered: number };

/**
 * Coverage counts, computed in SQL rather than by pulling every edge into memory — the
 * spec 07 §5 budget is 5,000 requirements in under two seconds.
 *
 * An edge whose far end the reader cannot see still counts as coverage: rule X2 says the
 * existence of a link is not secret, only its target's content (RD-033). The population,
 * which is the denominator, is already filtered by the visibility predicate.
 * spec: 04-traceability-and-coverage.md §4.1
 */
export async function fetchCoverageCounts(ids: readonly string[]): Promise<{
  perRelationship: CoverageCountRow[];
  anyTo: number;
  anyFrom: number;
}> {
  if (ids.length === 0) return { perRelationship: [], anyTo: 0, anyFrom: 0 };

  const statement = sql`
    SELECT d.relationship AS relationship, 'to' AS direction,
           COUNT(DISTINCT d."childId")::int AS covered
    FROM "Dependency" d
    WHERE d."childId" = ANY(${param(ids)})
    GROUP BY d.relationship
    UNION ALL
    SELECT d.relationship AS relationship, 'from' AS direction,
           COUNT(DISTINCT d."parentId")::int AS covered
    FROM "Dependency" d
    WHERE d."parentId" = ANY(${param(ids)})
    GROUP BY d.relationship
  `;

  const totals = sql`
    SELECT
      (SELECT COUNT(DISTINCT d."childId")::int FROM "Dependency" d WHERE d."childId" = ANY(${param(ids)})) AS "anyTo",
      (SELECT COUNT(DISTINCT d."parentId")::int FROM "Dependency" d WHERE d."parentId" = ANY(${param(ids)})) AS "anyFrom"
  `;

  const perQuery = render(statement);
  const totalQuery = render(totals);

  const [perRelationship, [totalRow]] = await Promise.all([
    prisma.$queryRawUnsafe<CoverageCountRow[]>(perQuery.text, ...perQuery.params),
    prisma.$queryRawUnsafe<Array<{ anyTo: number; anyFrom: number }>>(totalQuery.text, ...totalQuery.params),
  ]);

  return { perRelationship, anyTo: totalRow?.anyTo ?? 0, anyFrom: totalRow?.anyFrom ?? 0 };
}

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

export type ReportData = {
  properties: Array<{ name: string; value: string }>;
  documents: Array<{ id: string; title: string }>;
  dependencies: Array<{ direction: 'to' | 'from'; relationship: string; key: string; title: string }>;
};

/**
 * Everything a report row needs, in one query per field kind — the same two-phase shape
 * the matrix uses (spec 04 §2.5), because a report is a matrix with a different syntax.
 * spec: 04-traceability-and-coverage.md §5
 */
export async function fetchReportData(
  ids: readonly string[],
  visibility: SqlFragment,
  viewer: Viewer,
): Promise<Map<string, ReportData>> {
  const data = new Map<string, ReportData>(
    ids.map((id) => [id, { properties: [], documents: [], dependencies: [] }]),
  );
  if (ids.length === 0) return data;

  const [properties, links, edges] = await Promise.all([
    prisma.property.findMany({
      where: { requirementId: { in: [...ids] }, kind: 'INLINE' },
      select: { requirementId: true, name: true, value: true },
      orderBy: [{ valueOrdinal: 'asc' }, { valueIndex: 'asc' }],
    }),
    // `links` is every document where the requirement is defined *or* cited (spec 02 §4).
    prisma.documentLink.findMany({
      where: { requirementId: { in: [...ids] } },
      select: { requirementId: true, version: { select: { document: { select: { id: true, title: true } } } } },
    }),
    fetchReportEdges(ids, visibility),
  ]);
  // Rule X2 — a document the reader cannot open is not named as a place a requirement is
  // defined or cited, even when the requirement itself is visible.
  const openable = await visibleDocumentIds(viewer, links.map((link) => link.version.document.id));

  for (const property of properties) {
    data.get(property.requirementId)?.properties.push({ name: property.name, value: property.value });
  }

  for (const link of links) {
    const entry = data.get(link.requirementId);
    if (!entry || !openable.has(link.version.document.id)) continue;
    if (!entry.documents.some((document) => document.id === link.version.document.id)) {
      entry.documents.push(link.version.document);
    }
  }

  for (const edge of edges) {
    data.get(edge.src)?.dependencies.push({
      direction: edge.direction,
      relationship: edge.relationship,
      key: edge.key,
      // Rule X2: the link's existence is not secret, its target's content is.
      title: edge.visible ? edge.title : 'restricted',
    });
  }

  return data;
}

type ReportEdge = {
  src: string;
  direction: 'to' | 'from';
  relationship: string;
  key: string;
  title: string;
  visible: boolean;
};

async function fetchReportEdges(ids: readonly string[], visibility: SqlFragment): Promise<ReportEdge[]> {
  const visibleThere = substituteAlias(visibility, 'other');

  const statement = sql`
    SELECT d."childId" AS src, 'to' AS direction, d.relationship AS relationship,
           other.key AS key, other.title AS title, (${visibleThere}) AS visible
    FROM "Dependency" d
    JOIN "Requirement" other ON other.id = d."parentId"
    WHERE d."childId" = ANY(${param(ids)})
    UNION ALL
    SELECT d."parentId" AS src, 'from' AS direction, d.relationship AS relationship,
           other.key AS key, other.title AS title, (${visibleThere}) AS visible
    FROM "Dependency" d
    JOIN "Requirement" other ON other.id = d."childId"
    WHERE d."parentId" = ANY(${param(ids)})
    ORDER BY relationship ASC, key ASC
  `;

  const { text, params } = render(statement);
  return prisma.$queryRawUnsafe<ReportEdge[]>(text, ...params);
}

/** The defining document of each row — the tree view and the `document` column. */
export async function fetchDefiningDocuments(ids: readonly string[]): Promise<Map<string, DocumentOfRow>> {
  // X3-exempt: ids come from a visible set, and a visible live requirement's origin document is visible by construction (RD-056).
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
