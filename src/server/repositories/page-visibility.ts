// THE visibility predicate for pages. Every repository read of a page, a version, a draft, an
// attachment or presence composes this fragment into its WHERE clause; nothing else in the
// codebase decides who may see a page. Slice 16 adds page restrictions (spec 07 §2.2) HERE,
// and every reader picks them up. Requirement visibility (rule X1/X3) will build on it too.
//
// It is SQL rather than a Prisma where-input so that it can be applied per row — "the
// watchers who can still view this page", "the people present who can still view it" — and
// composed into hand-written queries (recursive CTEs now, the RYQL compiler's output later).
import { Prisma } from "@prisma/client";

/** Who is looking: a user id, or a SQL expression yielding one per row (e.g. `w."userId"`). */
export type Viewer = string | Prisma.Sql;

const ALIAS = /^[a-z][a-z0-9_]*$/;

function viewerSql(viewer: Viewer): Prisma.Sql {
  return typeof viewer === "string" ? Prisma.sql`${viewer}` : viewer;
}

/**
 * True when the viewer holds VIEW in the space through a membership that applies to them —
 * their own, or one of a group they belong to (spec 07 §2.1, RD-051: permissions are the union
 * of applicable memberships; nothing implies VIEW; EDIT without VIEW sees nothing). The same
 * rule as `visibleTo` in spaces.ts, which reads spaces through the ORM.
 */
export function spaceViewableSql(viewer: Viewer, spaceId: Prisma.Sql): Prisma.Sql {
  const v = viewerSql(viewer);
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Membership" vis_m
    WHERE vis_m."spaceId" = ${spaceId}
      AND 'VIEW' = ANY (vis_m."permissions")
      AND (vis_m."userId" = ${v}
           OR EXISTS (SELECT 1 FROM "GroupMember" vis_g
                      WHERE vis_g."groupId" = vis_m."groupId" AND vis_g."userId" = ${v})))`;
}

/**
 * A boolean SQL expression: may `viewer` see the page in the row aliased `documentAlias`?
 * Today that is "has VIEW on the page's space". Liveness (`deletedAt IS NULL`) is NOT part of
 * it: whether a deleted page exists for the caller is each reader's decision.
 *
 * An invisible page behaves as if it does not exist (rule X2: omitted, not redacted) —
 * readers return null or leave the row out, never a "forbidden".
 */
// spec: docs/specs/07-permissions-and-limits.md section 2.1 (RD-051) and section 2.2 (rule X2); RD-058 (attachment reads check VIEW)
export function pageVisibleSql(viewer: Viewer, documentAlias = "d"): Prisma.Sql {
  if (!ALIAS.test(documentAlias)) throw new Error(`pageVisibleSql: bad alias ${JSON.stringify(documentAlias)}`);
  return spaceViewableSql(viewer, Prisma.raw(`"${documentAlias}"."spaceId"`));
}
