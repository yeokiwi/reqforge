// The transaction boundary lives in the USE CASE, not in the repositories: a use case that
// must run several repository calls atomically wraps them in `transaction()` and passes the
// handle it receives as the first argument of each call. Use cases never import
// @prisma/client; the handle is opaque to them.
//
//   await transaction(async (tx) => {
//     await lockTree(tx, space.id);
//     const { id } = await createPage(tx, { ... });
//     await insertVersion(tx, { documentId: id, ... });
//   });
//
// Functions that are only correct inside a transaction (they lock, or they write several
// rows that must agree) take `Tx`; the type system then refuses `rootDb` for them. Read
// functions take `Db`, which both `rootDb` and a `Tx` satisfy.
//
// Lock order, to stay deadlock-free: the space's tree lock (`lockTree`) before any page lock
// (`lockPage`). A failed statement aborts the whole transaction in PostgreSQL, so a use case
// must not catch a repository error inside `transaction()` and carry on; let it propagate,
// the transaction rolls back, and handle it outside.
import { prisma } from "./client";
import { clientOf, handleOf } from "./internal";

declare const DB_BRAND: unique symbol;
declare const TX_BRAND: unique symbol;

/** An opaque database handle: the root connection pool, or an open transaction. */
export interface Db {
  readonly [DB_BRAND]: "Db";
}

/** A handle inside an open transaction. Only `transaction()` makes one. */
export interface Tx extends Db {
  readonly [TX_BRAND]: "Tx";
}

/** The handle for calls that need no transaction. */
export const rootDb: Db = handleOf<Db>(prisma);

export interface TransactionOptions {
  /** How long the whole transaction may run. Default 15 s (an attachment upload is up to 10 MiB). */
  readonly timeoutMs?: number;
  /** How long to wait for a pooled connection. Default 5 s. */
  readonly maxWaitMs?: number;
}

/**
 * Runs `fn` in one database transaction (READ COMMITTED). Commits when `fn` resolves, rolls
 * back when it throws, and rethrows. Do not nest: call repositories with the `tx` you were given.
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  return prisma.$transaction((client) => fn(handleOf<Tx>(client)), {
    timeout: options.timeoutMs ?? 15_000,
    maxWait: options.maxWaitMs ?? 5_000,
  });
}

/** What `lockPage` read after taking the lock. */
export interface LockedPage {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  /** Soft-deleted pages are locked too; the caller decides whether that is "not found". */
  readonly deleted: boolean;
  /** The current version's number, or null if the page has none yet (inside its creating transaction). */
  readonly currentVersion: number | null;
}

/**
 * `SELECT … FOR UPDATE` on the page's row, held until the transaction ends. Serialises
 * publishes of one page so that "read MAX(number), insert MAX+1" cannot interleave
 * (`insertVersion` takes it again; row locks are re-entrant). Null when no such page.
 *
 * The state is read by a second statement on purpose: under READ COMMITTED a statement that
 * waited for the lock re-checks only the locked row, so a join in the locking statement would
 * compare the new `currentVersionId` with the old version row and drop the page.
 */
// spec: docs/specs/09-decision-log.md section RD-055 (Update creates the next version; concurrent publishes)
export async function lockPage(tx: Tx, documentId: string): Promise<LockedPage | null> {
  const client = clientOf(tx);
  const locked = await client.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Document" WHERE "id" = ${documentId} FOR UPDATE`;
  if (locked.length === 0) return null;
  const rows = await client.$queryRaw<
    { id: string; spaceId: string; title: string; deletedAt: Date | null; currentVersion: number | null }[]
  >`
    SELECT d."id", d."spaceId", d."title", d."deletedAt", v."number" AS "currentVersion"
    FROM "Document" d
    LEFT JOIN "DocumentVersion" v ON v."id" = d."currentVersionId"
    WHERE d."id" = ${documentId}`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.spaceId,
    title: row.title,
    deleted: row.deletedAt !== null,
    currentVersion: row.currentVersion,
  };
}

/**
 * Locks a space's page tree until the transaction ends: every create, move and delete of a
 * page in the space takes it first (`createPage`, `applyOrdinals` and `softDeleteSubtree` do
 * so themselves), so sibling ordinals and title checks never interleave. A use case that
 * reads the tree to plan a move (listPages → planMove → applyOrdinals) must take it BEFORE
 * reading. `FOR NO KEY UPDATE` does not block foreign-key checks, so inserts elsewhere that
 * reference the space carry on. False when the space does not exist.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (dense sibling ordinals; unique live titles)
export async function lockTree(tx: Tx, spaceId: string): Promise<boolean> {
  const rows = await clientOf(tx).$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`;
  return rows.length > 0;
}
