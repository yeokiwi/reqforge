// Page versions: immutable history (invariant D2). A version is inserted by Update, by a
// rename, by Restore and by Create (RD-055, RD-056, RD-060); only `pinned` ever changes after
// insert, and the database refuses everything else — this module never tries.
import type { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/domain/errors";
import { mapDbError } from "./db-errors";
import { clientOf } from "./internal";
import { pageVisibleSql } from "./page-visibility";
import { lockPage, type Db, type Tx } from "./transaction";
import type { UserRef } from "./types";

/** spec 08 §3.1 `VersionSummary`, with Dates. */
export interface VersionRow {
  readonly id: string;
  readonly documentId: string;
  readonly number: number;
  readonly title: string;
  readonly message: string | null;
  readonly author: UserRef;
  readonly createdAt: Date;
  readonly pinned: boolean;
  /** Whether this is the page's current version. */
  readonly current: boolean;
}

/** spec 08 §3.1 `VersionDetail`: canonical ProseMirror JSON as stored. */
export interface VersionWithContent extends VersionRow {
  readonly content: unknown;
}

export interface NewVersion {
  readonly documentId: string;
  /** Normalised and checked by the use case; the database re-checks 1–255 after trimming. */
  readonly title: string;
  /** Canonical ProseMirror JSON (03 §1.5, RD-063), already validated by the use case. */
  readonly content: unknown;
  readonly authorId: string;
  /** `What did you change?` — at most 500 characters. */
  readonly message?: string | null;
  /** Defaults to now. */
  readonly at?: Date;
}

/**
 * Appends the next version — number MAX+1 under the page lock — and makes it current, setting
 * the page's title to the version's title in the same transaction. Because the current version
 * is never deletable, MAX+1 never reuses a number. Throws NotFoundError (missing or deleted
 * page), TitleTakenError (a rename onto a live title), ValidationError.
 */
// spec: docs/specs/09-decision-log.md section RD-055 (Update creates the next immutable version and makes it current); RD-056 (renaming creates a version); docs/specs/01-domain-model.md (DocumentVersion.number sequential, never reused)
export async function insertVersion(tx: Tx, input: NewVersion): Promise<VersionRow> {
  if (input.content === undefined || input.content === null) {
    throw new ValidationError([{ path: "content", message: "is required" }]);
  }
  const client = clientOf(tx);
  const page = await lockPage(tx, input.documentId);
  if (!page || page.deleted) throw new NotFoundError("Page");
  const [max] = await client.$queryRaw<{ next: number }[]>`
    SELECT (COALESCE(MAX("number"), 0) + 1)::int AS "next" FROM "DocumentVersion" WHERE "documentId" = ${input.documentId}`;
  const number = max?.next ?? 1;
  try {
    const v = await client.documentVersion.create({
      data: {
        documentId: input.documentId,
        number,
        title: input.title,
        content: input.content as Prisma.InputJsonValue,
        authorId: input.authorId,
        message: input.message ?? null,
        ...(input.at ? { createdAt: input.at } : {}),
      },
      select: {
        id: true,
        documentId: true,
        number: true,
        title: true,
        message: true,
        pinned: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });
    await client.document.update({ where: { id: input.documentId }, data: { currentVersionId: v.id, title: input.title } });
    return { ...v, author: { id: v.author.id, name: v.author.name }, current: true };
  } catch (e) {
    throw mapDbError(e);
  }
}

interface VersionDbRow {
  id: string;
  documentId: string;
  number: number;
  title: string;
  message: string | null;
  pinned: boolean;
  createdAt: Date;
  authorId: string;
  authorName: string;
  current: boolean;
}

function toVersionRow(r: VersionDbRow): VersionRow {
  return {
    id: r.id,
    documentId: r.documentId,
    number: r.number,
    title: r.title,
    message: r.message,
    author: { id: r.authorId, name: r.authorName },
    createdAt: r.createdAt,
    pinned: r.pinned,
    current: r.current,
  };
}

/**
 * Every version of a live page, newest first. Null when the page is missing, deleted or
 * invisible to the viewer (a visible page always has at least one version).
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/versions, newest first); docs/specs/07-permissions-and-limits.md section 2.2 (rule X2)
export async function listVersions(db: Db, viewerId: string, documentId: string): Promise<readonly VersionRow[] | null> {
  const rows = await clientOf(db).$queryRaw<VersionDbRow[]>`
    SELECT v."id", v."documentId", v."number", v."title", v."message", v."pinned", v."createdAt",
           u."id" AS "authorId", u."name" AS "authorName", (v."id" = d."currentVersionId") AS "current"
    FROM "Document" d
    JOIN "DocumentVersion" v ON v."documentId" = d."id"
    JOIN "User" u ON u."id" = v."authorId"
    WHERE d."id" = ${documentId} AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}
    ORDER BY v."number" DESC`;
  return rows.length === 0 ? null : rows.map(toVersionRow);
}

/** One version with its content, or null (unknown number; page missing, deleted or invisible). */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/versions/{n}; GET /pages/{id}?version=N); rule X2
export async function getVersion(db: Db, viewerId: string, documentId: string, number: number): Promise<VersionWithContent | null> {
  if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) return null;
  const rows = await clientOf(db).$queryRaw<(VersionDbRow & { content: unknown })[]>`
    SELECT v."id", v."documentId", v."number", v."title", v."message", v."pinned", v."createdAt", v."content",
           u."id" AS "authorId", u."name" AS "authorName", (v."id" = d."currentVersionId") AS "current"
    FROM "Document" d
    JOIN "DocumentVersion" v ON v."documentId" = d."id"
    JOIN "User" u ON u."id" = v."authorId"
    WHERE d."id" = ${documentId} AND v."number" = ${number}::int
      AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  const r = rows[0];
  return r ? { ...toVersionRow(r), content: r.content } : null;
}

/**
 * Deletes one version from history. The database decides: the current version is refused by
 * its foreign key (CurrentVersionError), a pinned one by the trigger (PinnedVersionError).
 * NotFoundError when the page has no such version.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Delete removes one non-current, non-pinned version); 08 §3.2 (CURRENT_VERSION, PINNED_VERSION); invariant D2
export async function deleteVersion(db: Db, documentId: string, number: number): Promise<void> {
  if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) throw new NotFoundError("Version");
  try {
    const { count } = await clientOf(db).documentVersion.deleteMany({ where: { documentId, number } });
    if (count === 0) throw new NotFoundError("Version");
  } catch (e) {
    throw mapDbError(e);
  }
}
