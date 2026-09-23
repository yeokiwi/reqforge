import { formatRecordId } from '@/domain/record-id';
import { prisma } from './client';
import { visibleDocumentIds, visibleRequirementIdsFor, type Viewer } from './visibility';

/**
 * Requirements as the REST API returns them. spec: 08-api-surface.md §2 —
 * `expand ∈ {properties, dependencies, links, validation}`.
 *
 * Every expansion is one batched read over the page, never one per row (spec 04 §2.5's
 * rule applies here too). The ids come from `runSearch` or `findRequirementDetail`, which
 * applied the predicate; the far ends of edges and the citing documents are checked again
 * here, because a visible requirement can point at a hidden one (rule X2).
 */

export const EXPANSIONS = ['properties', 'dependencies', 'links', 'validation'] as const;
export type Expansion = (typeof EXPANSIONS)[number];

type Row = {
  id: string;
  spaceId: string;
  key: string;
  upperKey: string;
  title: string;
  bodyHtml: string;
  status: string;
  baselineId: string | null;
};

export type ApiRequirement = {
  recordId: string;
  key: string;
  space: string;
  baseline: number | null;
  title: string;
  status: string;
  bodyHtml: string;
  properties?: Array<{ name: string; value: string; external: boolean }>;
  dependencies?: Array<{
    direction: 'to' | 'from';
    relationship: string;
    key: string;
    space: string;
    /** Rule X2: the link is not secret, the target's content is. */
    restricted: boolean;
    title: string | null;
  }>;
  links?: Array<{ documentId: string; documentTitle: string; version: number; origin: boolean }>;
  validation?: Array<{ type: string | null; status: string; messages: unknown }>;
};

export async function toApiRequirements(
  viewer: Viewer,
  rows: readonly Row[],
  expand: ReadonlySet<Expansion>,
): Promise<ApiRequirement[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [spaces, baselines] = await Promise.all([
    prisma.space.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.spaceId))] } }, select: { id: true, key: true } }),
    prisma.baseline.findMany({
      where: { id: { in: [...new Set(rows.flatMap((row) => (row.baselineId ? [row.baselineId] : [])))] } },
      select: { id: true, number: true },
    }),
  ]);
  const spaceKey = new Map(spaces.map((space) => [space.id, space.key]));
  const baselineNumber = new Map(baselines.map((baseline) => [baseline.id, baseline.number]));

  const [properties, edges, links, validations] = await Promise.all([
    expand.has('properties')
      ? prisma.property.findMany({
          where: { requirementId: { in: ids } },
          orderBy: [{ valueOrdinal: 'asc' }, { valueIndex: 'asc' }],
          select: { requirementId: true, name: true, value: true, kind: true },
        })
      : [],
    expand.has('dependencies')
      ? prisma.dependency.findMany({
          where: { OR: [{ childId: { in: ids } }, { parentId: { in: ids } }] },
          select: {
            relationship: true,
            childId: true,
            parentId: true,
            child: { select: { key: true, title: true, space: { select: { key: true } } } },
            parent: { select: { key: true, title: true, space: { select: { key: true } } } },
          },
        })
      : [],
    expand.has('links')
      ? prisma.documentLink.findMany({
          where: { requirementId: { in: ids } },
          select: { requirementId: true, origin: true, version: { select: { number: true, documentId: true, document: { select: { title: true } } } } },
        })
      : [],
    expand.has('validation')
      ? prisma.requirementValidation.findMany({
          where: { requirementId: { in: ids } },
          select: { requirementId: true, status: true, messages: true, type: { select: { name: true } } },
        })
      : [],
  ]);

  const idSet = new Set(ids);
  const [visibleEnds, visibleDocuments] = await Promise.all([
    visibleRequirementIdsFor(viewer, edges.flatMap((edge) => [edge.childId, edge.parentId])),
    visibleDocumentIds(viewer, links.map((link) => link.version.documentId)),
  ]);

  return rows.map((row) => {
    const space = spaceKey.get(row.spaceId) ?? '';
    const baseline = row.baselineId ? (baselineNumber.get(row.baselineId) ?? null) : null;
    const view: ApiRequirement = {
      recordId: formatRecordId(space, row.key, baseline),
      key: row.key,
      space,
      baseline,
      title: row.title,
      status: row.status,
      bodyHtml: row.bodyHtml,
    };

    if (expand.has('properties')) {
      view.properties = properties
        .filter((property) => property.requirementId === row.id)
        .map((property) => ({ name: property.name, value: property.value, external: property.kind === 'EXTERNAL' }));
    }

    if (expand.has('dependencies')) {
      view.dependencies = edges.flatMap((edge) => {
        // Invariant P1: the edge's child declared it, so from the child it points "to".
        const outbound = edge.childId === row.id;
        const inbound = edge.parentId === row.id;
        if (!outbound && !inbound) return [];
        const otherId = outbound ? edge.parentId : edge.childId;
        const other = outbound ? edge.parent : edge.child;
        const visible = visibleEnds.has(otherId) || idSet.has(otherId);
        return [
          {
            direction: outbound ? ('to' as const) : ('from' as const),
            relationship: edge.relationship,
            key: other.key,
            space: other.space.key,
            restricted: !visible,
            title: visible ? other.title : null,
          },
        ];
      });
    }

    if (expand.has('links')) {
      view.links = links
        .filter((link) => link.requirementId === row.id && visibleDocuments.has(link.version.documentId))
        .map((link) => ({
          documentId: link.version.documentId,
          documentTitle: link.version.document.title,
          version: link.version.number,
          origin: link.origin,
        }));
    }

    if (expand.has('validation')) {
      view.validation = validations
        .filter((validation) => validation.requirementId === row.id)
        .map((validation) => ({ type: validation.type.name, status: validation.status, messages: validation.messages }));
    }

    return view;
  });
}
