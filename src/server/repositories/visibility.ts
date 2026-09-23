import { param, raw, render, sql, substituteAlias, type SqlFragment } from '@/domain/ryql/sql';
import { prisma } from './client';

/**
 * Rule X3's one home. spec: 07-permissions-and-limits.md §2.2 (rules X1–X4); RD-017.
 *
 * "Restrictions are enforced in the repository layer, by a mandatory visibility predicate
 * injected into every requirement query including the RQL compiler's output. There is no
 * code path that reads requirements without it." Every read in `src/server/repositories`
 * either applies one of the fragments below or carries an `X3-exempt:` comment saying why
 * it is a system read, and `tests/architecture.test.ts` holds that line.
 *
 * Semantics (RD-056, RD-059):
 *   - a document's **view list** is its `canView` grants, and it restricts only when the
 *     document is `EXPLICIT` and the list is non-empty;
 *   - view restrictions **inherit**: a document is visible only if every restricted
 *     ancestor-or-self admits the reader. `DocumentViewGate` materialises that ancestry;
 *   - a document's **edit list** is its `canEdit` grants, restricts only that document, and
 *     never widens the view list — you cannot edit what you cannot see;
 *   - a **frozen** requirement must pass the gates as they stood at freeze *and* as they
 *     stand now (rule X4): loosening never exposes baselined text, tightening applies.
 */

/** Who is reading. Group membership is resolved once per request, not once per row. */
export type Viewer = { userId: string; groupIds: readonly string[] };

/**
 * A read made by the system itself — a job writing rows, a uniqueness check — rather than
 * on someone's behalf. Passing it is the explicit, greppable way to skip rule X3; a
 * function that shows its result to a person never accepts it.
 */
export const SYSTEM = 'system' as const;
export type ReaderScope = Viewer | typeof SYSTEM;

export async function viewerFor(userId: string): Promise<Viewer> {
  // X3-exempt: resolving the reader's own groups is what the predicate is built from.
  const rows = await prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  return { userId, groupIds: rows.map((row) => row.groupId) };
}

/** Postgres rejects `= ANY('{}')` on an untyped empty array; a sentinel matches nothing. */
function groupsOf(viewer: Viewer): string[] {
  return viewer.groupIds.length > 0 ? [...viewer.groupIds] : [''];
}

/** `table` is always a literal alias written in this file, never input. */
function granted(viewer: Viewer, table: 'm' | 'dr' | 'gg' | 'de'): SqlFragment {
  const t = raw(table);
  return sql`(${t}."userId" = ${param(viewer.userId)} OR ${t}."groupId" = ANY(${param(groupsOf(viewer))}))`;
}

/**
 * The document behind `$doc` passes every current gate for this reader (RD-056).
 * Written against `$alias`, like the requirement predicate, so it can be rebound.
 */
export function documentGatePredicate(viewer: Viewer): SqlFragment {
  return sql`
    NOT EXISTS (
      SELECT 1 FROM "DocumentViewGate" g
      WHERE g."documentId" = $alias
        AND NOT EXISTS (
          SELECT 1 FROM "DocumentRestriction" dr
          WHERE dr."documentId" = g."gateDocumentId"
            AND dr."canView"
            AND ${granted(viewer, 'dr')}
        )
    )
  `;
}

/**
 * The mandatory requirement predicate, with `$alias` standing for the requirement row.
 * spec 07 rules X1–X4.
 */
export function requirementVisibility(viewer: Viewer): SqlFragment {
  return sql`
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."spaceId" = $alias."spaceId"
        AND 'VIEW' = ANY(m.permissions)
        AND ${granted(viewer, 'm')}
    )
    AND NOT EXISTS (
      SELECT 1 FROM "DocumentVersion" dv
      JOIN "DocumentViewGate" g ON g."documentId" = dv."documentId"
      WHERE dv.id = $alias."originVersionId"
        AND NOT EXISTS (
          SELECT 1 FROM "DocumentRestriction" dr
          WHERE dr."documentId" = g."gateDocumentId"
            AND dr."canView"
            AND ${granted(viewer, 'dr')}
        )
    )
    AND (
      $alias."baselineId" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "DocumentVersion" fv
        JOIN "BaselineViewGate" bg
          ON bg."baselineId" = $alias."baselineId" AND bg."documentId" = fv."documentId"
        WHERE fv.id = $alias."originVersionId"
          AND NOT EXISTS (
            SELECT 1 FROM "BaselineGateGrant" gg
            WHERE gg."baselineId" = bg."baselineId"
              AND gg."gateDocumentId" = bg."gateDocumentId"
              AND ${granted(viewer, 'gg')}
          )
      )
    )
  `;
}

/** The predicate for a document row: space VIEW and every gate (RD-056). */
export function documentVisibility(viewer: Viewer): SqlFragment {
  return sql`
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."spaceId" = $alias."spaceId"
        AND 'VIEW' = ANY(m.permissions)
        AND ${granted(viewer, 'm')}
    )
    AND ${substituteAlias(documentGatePredicate(viewer), '$alias.id')}
  `;
}

/**
 * The document's own edit list, where it has one. Space EDIT is checked by the caller
 * (`requireSpace`); visibility is part of this, because an edit list never widens a view
 * list. spec 07 §2.2; RD-056.
 */
export function documentEditability(viewer: Viewer): SqlFragment {
  return sql`
    ${documentVisibility(viewer)}
    AND (
      $alias."restrictionMode" <> 'EXPLICIT'
      OR NOT EXISTS (SELECT 1 FROM "DocumentRestriction" de WHERE de."documentId" = $alias.id AND de."canEdit")
      OR EXISTS (
        SELECT 1 FROM "DocumentRestriction" de
        WHERE de."documentId" = $alias.id AND de."canEdit" AND ${granted(viewer, 'de')}
      )
    )
  `;
}

/** The ids among `ids` this reader may see. */
export async function visibleRequirementIdsFor(viewer: Viewer, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const statement = sql`
    SELECT r.id AS id FROM "Requirement" r
    WHERE r.id = ANY(${param([...new Set(ids)])})
      AND (${substituteAlias(requirementVisibility(viewer), 'r')})
  `;
  const { text, params } = render(statement);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(text, ...params);
  return new Set(rows.map((row) => row.id));
}

/** The document ids among `ids` this reader may see. */
export async function visibleDocumentIds(viewer: Viewer, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const statement = sql`
    SELECT d.id AS id FROM "Document" d
    WHERE d.id = ANY(${param([...new Set(ids)])})
      AND (${substituteAlias(documentVisibility(viewer), 'd')})
  `;
  const { text, params } = render(statement);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(text, ...params);
  return new Set(rows.map((row) => row.id));
}

export async function isDocumentVisible(viewer: Viewer, documentId: string): Promise<boolean> {
  return (await visibleDocumentIds(viewer, [documentId])).has(documentId);
}

export async function isDocumentEditable(viewer: Viewer, documentId: string): Promise<boolean> {
  const statement = sql`
    SELECT d.id AS id FROM "Document" d
    WHERE d.id = ${param(documentId)} AND (${substituteAlias(documentEditability(viewer), 'd')})
  `;
  const { text, params } = render(statement);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(text, ...params);
  return rows.length > 0;
}
