import type { ComparableRow } from '@/domain/diff';
import { prisma } from './client';

/**
 * Everything a comparison needs, in three batched queries — never one per row
 * (spec 04 §2.5's rule applies here too).
 */
export async function loadComparable(ids: readonly string[]): Promise<ComparableRow[]> {
  if (ids.length === 0) return [];
  // X3-exempt: `ids` come only from `runSearchIds`, which applied the visibility predicate.

  const rows = await prisma.requirement.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { upperKey: 'asc' },
    select: {
      id: true,
      key: true,
      title: true,
      bodyHtml: true,
      bodySearch: true,
      properties: { select: { kind: true, searchName: true, value: true, valueIndex: true } },
      parentEdges: { select: { relationship: true, parent: { select: { upperKey: true } } } },
    },
  });

  return rows.map((row) => ({
    key: row.key,
    title: row.title,
    bodyHtml: row.bodyHtml,
    bodySearch: row.bodySearch,
    inlineProperties: row.properties
      .filter((property) => property.kind === 'INLINE')
      .map(({ searchName, value, valueIndex }) => ({ searchName, value, valueIndex })),
    externalProperties: row.properties
      .filter((property) => property.kind === 'EXTERNAL')
      .map(({ searchName, value, valueIndex }) => ({ searchName, value, valueIndex })),
    dependencies: row.parentEdges.map((edge) => ({
      relationship: edge.relationship,
      targetKey: edge.parent.upperKey,
    })),
  }));
}
