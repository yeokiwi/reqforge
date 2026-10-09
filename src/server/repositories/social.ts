// Per-user page state: Watching and Save for later (RD-061), and presence (RD-062). The use
// case resolves the page first (getPage, which applies visibility); these functions are keyed
// by (page, user). Reads that list OTHER users apply the visibility predicate to each of them.
import { Prisma } from "@prisma/client";
import { mapDbError } from "./db-errors";
import { clientOf } from "./internal";
import { pageVisibleSql } from "./page-visibility";
import type { Db } from "./transaction";
import type { UserRef } from "./types";

/** Turns `Watching` on or off. Idempotent both ways. NotFoundError for an unknown page or user. */
// spec: docs/specs/09-decision-log.md section RD-061 (Watching: per-user toggle, on by default for the creator); 08 §3 (PUT / DELETE /pages/{id}/watch)
export async function setWatching(db: Db, documentId: string, userId: string, watching: boolean): Promise<void> {
  const client = clientOf(db);
  try {
    if (watching) {
      await client.$executeRaw`
        INSERT INTO "DocumentWatch" ("documentId", "userId") VALUES (${documentId}, ${userId})
        ON CONFLICT ("documentId", "userId") DO NOTHING`;
    } else {
      await client.documentWatch.deleteMany({ where: { documentId, userId } });
    }
  } catch (e) {
    throw mapDbError(e);
  }
}

/** Turns `Save for later` on or off. Idempotent both ways. NotFoundError for an unknown page or user. */
// spec: docs/specs/09-decision-log.md section RD-061 (Save for later: per-user toggle); 08 §3 (PUT / DELETE /pages/{id}/favourite)
export async function setFavourite(db: Db, documentId: string, userId: string, favourite: boolean): Promise<void> {
  const client = clientOf(db);
  try {
    if (favourite) {
      await client.$executeRaw`
        INSERT INTO "DocumentFavourite" ("documentId", "userId") VALUES (${documentId}, ${userId})
        ON CONFLICT ("documentId", "userId") DO NOTHING`;
    } else {
      await client.documentFavourite.deleteMany({ where: { documentId, userId } });
    }
  } catch (e) {
    throw mapDbError(e);
  }
}

/** Whether the user watches the page (the page view's `Watching` toggle). */
// spec: docs/specs/09-decision-log.md section RD-061 (Watching)
export async function isWatching(db: Db, documentId: string, userId: string): Promise<boolean> {
  return (await clientOf(db).documentWatch.count({ where: { documentId, userId } })) > 0;
}

/** Whether the user saved the page for later. */
// spec: docs/specs/09-decision-log.md section RD-061 (Save for later)
export async function isFavourite(db: Db, documentId: string, userId: string): Promise<boolean> {
  return (await clientOf(db).documentFavourite.count({ where: { documentId, userId } })) > 0;
}

/**
 * How many users watch the page AND can still view it — the number a publish's
 * `Notify watchers` would reach, recorded on its audit event (RD-061). `excludeUserId` leaves
 * out the publisher.
 */
// spec: docs/specs/09-decision-log.md section RD-061 (recorded with the number of watchers it applies to); 07 §2.2 rule X2
export async function watcherCount(db: Db, documentId: string, options: { readonly excludeUserId?: string } = {}): Promise<number> {
  const exclude = options.excludeUserId === undefined ? Prisma.empty : Prisma.sql`AND w."userId" <> ${options.excludeUserId}`;
  const [row] = await clientOf(db).$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS "count"
    FROM "DocumentWatch" w JOIN "Document" d ON d."id" = w."documentId"
    WHERE w."documentId" = ${documentId} ${exclude} AND ${pageVisibleSql(Prisma.sql`w."userId"`)}`;
  return row?.count ?? 0;
}

/** Records a presence heartbeat (RD-062). Never moves `lastSeenAt` backwards. NotFoundError for an unknown page or user. */
// spec: docs/specs/09-decision-log.md section RD-062 (heartbeat; state is a table, not process memory)
export async function touchPresence(db: Db, documentId: string, userId: string, at: Date): Promise<void> {
  try {
    await clientOf(db).$executeRaw`
      INSERT INTO "DocumentPresence" ("documentId", "userId", "lastSeenAt") VALUES (${documentId}, ${userId}, ${at})
      ON CONFLICT ("documentId", "userId")
      DO UPDATE SET "lastSeenAt" = GREATEST("DocumentPresence"."lastSeenAt", EXCLUDED."lastSeenAt")`;
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * The OTHER users present on a live page: heartbeat at or after `since` (inclusive — the
 * caller computes it from the presence window), never the viewer themselves, and only users
 * who can still view the page. Ordered by name. Empty when the viewer cannot see the page.
 */
// spec: docs/specs/09-decision-log.md section RD-062 (present for 45 s after the last heartbeat; never shown to themselves); 08 §3 (POST /pages/{id}/presence)
export async function listPresence(db: Db, viewerId: string, documentId: string, since: Date): Promise<readonly UserRef[]> {
  const rows = await clientOf(db).$queryRaw<UserRef[]>`
    SELECT u."id", u."name"
    FROM "Document" d
    JOIN "DocumentPresence" p ON p."documentId" = d."id"
    JOIN "User" u ON u."id" = p."userId"
    WHERE d."id" = ${documentId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}
      AND p."lastSeenAt" >= ${since} AND p."userId" <> ${viewerId}
      AND ${pageVisibleSql(Prisma.sql`p."userId"`)}
    ORDER BY u."name", u."id"`;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** Deletes heartbeats older than `before` (exclusive), on every page or one. Returns how many. */
// spec: docs/specs/09-decision-log.md section RD-062 (rows older than the window are pruned opportunistically)
export async function prunePresence(db: Db, before: Date, documentId?: string): Promise<number> {
  const { count } = await clientOf(db).documentPresence.deleteMany({
    where: { lastSeenAt: { lt: before }, ...(documentId === undefined ? {} : { documentId }) },
  });
  return count;
}
