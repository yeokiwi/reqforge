// Who can be @mentioned on a page (spec 08 §3 `GET /people`, 10 §5.5). Matches on NAME only and
// returns {id, name} only: matching an email prefix would let a caller reconstruct an address one
// character at a time from which names appear, defeating "never returns email addresses".
import { Prisma } from "@prisma/client";
import { mapDbError } from "./db-errors";
import { clientOf } from "./internal";
import { spaceViewableSql } from "./page-visibility";
import type { Db } from "./transaction";
import type { UserRef } from "./types";

export const PEOPLE_LIMIT = 10;
export const PEOPLE_QUERY_MAX = 100;

/** A LIKE pattern body for "starts with `q`": `\`, `%` and `_` escaped so they match themselves. */
function likePrefix(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Users who hold VIEW in the space (directly or through a group) and whose name starts with `query`,
 * case-insensitively, ordered by name; at most PEOPLE_LIMIT. Null when the VIEWER cannot view the
 * space: a space they cannot see does not exist for them (rule X2), so nothing about its members
 * is revealed.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /people); RD-051 (who holds VIEW); rule X2
export async function listSpacePeople(db: Db, viewerId: string, spaceId: string, query: string): Promise<readonly UserRef[] | null> {
  const q = query.trim().slice(0, PEOPLE_QUERY_MAX);
  const space = Prisma.sql`${spaceId}`;
  try {
    const rows = await clientOf(db).$queryRaw<{ id: string; name: string }[]>`
      SELECT u."id", u."name"
      FROM "User" u
      WHERE ${spaceViewableSql(viewerId, space)}
        AND ${spaceViewableSql(Prisma.sql`u."id"`, space)}
        AND lower(u."name" COLLATE "und-x-icu") LIKE lower(${likePrefix(q)} COLLATE "und-x-icu") || '%' ESCAPE '\\'
      ORDER BY u."name", u."id"
      LIMIT ${PEOPLE_LIMIT}`;
    // The viewer check is part of the WHERE, so "no rows" is ambiguous: ask once whether they may see the space.
    if (rows.length > 0) return rows.map((r) => ({ id: r.id, name: r.name }));
    const [{ ok } = { ok: false }] = await clientOf(db).$queryRaw<{ ok: boolean }[]>`
      SELECT ${spaceViewableSql(viewerId, space)} AS ok`;
    return ok ? [] : null;
  } catch (e) {
    throw mapDbError(e);
  }
}
