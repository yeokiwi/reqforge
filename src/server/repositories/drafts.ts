// Autosaved drafts (RD-055): mutable, one per (page, user), not history. Update deletes the
// draft (in the publish transaction), Close keeps it, Revert to last published deletes it.
import type { Prisma } from "@prisma/client";
import { ValidationError } from "@/domain/errors";
import { mapDbError } from "./db-errors";
import { clientOf } from "./internal";
import { pageVisibleSql } from "./page-visibility";
import type { Db } from "./transaction";

export interface DraftRow {
  readonly documentId: string;
  readonly userId: string;
  readonly title: string;
  readonly content: unknown;
  /** The version number the draft started from. */
  readonly baseVersionNumber: number;
  readonly updatedAt: Date;
  /** The page's current version number now — the draft is stale when the two differ. */
  readonly currentVersion: number;
}

export interface DraftInput {
  readonly documentId: string;
  readonly userId: string;
  /** May be empty while editing (0–255); publishing checks it properly. */
  readonly title: string;
  /** Canonical ProseMirror JSON, validated by the use case. */
  readonly content: unknown;
  readonly baseVersionNumber: number;
  /** Defaults to now. */
  readonly at?: Date;
}

/**
 * The viewer's own draft of a live page they can see, or null (no draft; page missing,
 * deleted or invisible). A user who lost access to the space cannot read their old draft.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/draft: the caller's own); RD-055; rule X2
export async function getDraft(db: Db, viewerId: string, documentId: string): Promise<DraftRow | null> {
  const rows = await clientOf(db).$queryRaw<DraftRow[]>`
    SELECT dr."documentId", dr."userId", dr."title", dr."content", dr."baseVersionNumber", dr."updatedAt",
           v."number" AS "currentVersion"
    FROM "DocumentDraft" dr
    JOIN "Document" d ON d."id" = dr."documentId"
    JOIN "DocumentVersion" v ON v."id" = d."currentVersionId"
    WHERE dr."documentId" = ${documentId} AND dr."userId" = ${viewerId}
      AND d."deletedAt" IS NULL AND ${pageVisibleSql(viewerId)}`;
  const r = rows[0];
  if (!r) return null;
  return {
    documentId: r.documentId,
    userId: r.userId,
    title: r.title,
    content: r.content,
    baseVersionNumber: r.baseVersionNumber,
    updatedAt: r.updatedAt,
    currentVersion: r.currentVersion,
  };
}

/**
 * Creates or replaces the user's draft of a page (autosave). Never creates history. Throws
 * NotFoundError for an unknown page or user, ValidationError for a bad title or base number.
 */
// spec: docs/specs/09-decision-log.md section RD-055 (autosave writes a mutable DocumentDraft); 08 §3 (PUT /pages/{id}/draft)
export async function upsertDraft(db: Db, input: DraftInput): Promise<{ readonly updatedAt: Date }> {
  if (input.content === undefined || input.content === null) {
    throw new ValidationError([{ path: "content", message: "is required" }]);
  }
  const content = input.content as Prisma.InputJsonValue;
  const updatedAt = input.at ?? new Date();
  try {
    const row = await clientOf(db).documentDraft.upsert({
      where: { documentId_userId: { documentId: input.documentId, userId: input.userId } },
      create: {
        documentId: input.documentId,
        userId: input.userId,
        title: input.title,
        content,
        baseVersionNumber: input.baseVersionNumber,
        updatedAt,
      },
      update: { title: input.title, content, baseVersionNumber: input.baseVersionNumber, updatedAt },
      select: { updatedAt: true },
    });
    return { updatedAt: row.updatedAt };
  } catch (e) {
    throw mapDbError(e);
  }
}

/** Deletes the user's draft of a page. Idempotent: true if there was one. */
// spec: docs/specs/08-api-surface.md section 3 (DELETE /pages/{id}/draft: idempotent); RD-055 (Update and Revert delete the draft)
export async function deleteDraft(db: Db, documentId: string, userId: string): Promise<boolean> {
  const { count } = await clientOf(db).documentDraft.deleteMany({ where: { documentId, userId } });
  return count > 0;
}
