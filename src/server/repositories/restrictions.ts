import type { Prisma, RestrictionMode } from '@prisma/client';
import { ValidationError } from '@/domain/errors';
import { recordAuditEventIn } from './audit';
import { prisma } from './client';

/**
 * Document restrictions: the writer, the inherited gates, and the frozen copy of rule X4.
 * spec: 07-permissions-and-limits.md §2.2. RD-056 (inheritance), RD-057 (who may set
 * them), RD-058 (ADMIN unlock), RD-059 (X4).
 */

export type RestrictionGrant = {
  userId?: string | null;
  groupId?: string | null;
  canView: boolean;
  canEdit: boolean;
};

export type RestrictionInput = {
  documentId: string;
  mode: RestrictionMode;
  grants: readonly RestrictionGrant[];
};

/**
 * Normalises a restriction before it is written, so there is one representation of each
 * meaning:
 *   - edit implies view — you cannot edit what you cannot see (spec 07 §2.2);
 *   - a grant names exactly one user or one group;
 *   - duplicate subjects merge, their rights OR-ed;
 *   - `EXPLICIT` with no grants at all would hide the document from everyone, including
 *     the person setting it, so it is refused; `INHERIT` carries no grants.
 */
export function normaliseRestriction(input: RestrictionInput): RestrictionInput {
  if (input.mode === 'INHERIT') return { documentId: input.documentId, mode: 'INHERIT', grants: [] };

  const merged = new Map<string, RestrictionGrant>();
  for (const grant of input.grants) {
    const userId = grant.userId ?? null;
    const groupId = grant.groupId ?? null;
    if ((userId === null) === (groupId === null)) {
      throw new ValidationError('Each restriction entry names exactly one user or one group.');
    }
    if (!grant.canView && !grant.canEdit) continue;
    const subject = userId !== null ? `u:${userId}` : `g:${groupId}`;
    const previous = merged.get(subject);
    const canEdit = grant.canEdit || (previous?.canEdit ?? false);
    merged.set(subject, { userId, groupId, canEdit, canView: true });
  }

  if (merged.size === 0) {
    throw new ValidationError('A restricted document needs at least one person or group who can view it.');
  }
  return { documentId: input.documentId, mode: 'EXPLICIT', grants: [...merged.values()] };
}

/** Replaces a document's restriction and rebuilds the gates of its whole subtree. */
export async function setRestriction(tx: Prisma.TransactionClient, input: RestrictionInput): Promise<void> {
  const clean = normaliseRestriction(input);
  await tx.documentRestriction.deleteMany({ where: { documentId: clean.documentId } });
  if (clean.grants.length > 0) {
    await tx.documentRestriction.createMany({
      data: clean.grants.map((grant) => ({
        documentId: clean.documentId,
        userId: grant.userId ?? null,
        groupId: grant.groupId ?? null,
        canView: grant.canView,
        canEdit: grant.canEdit,
      })),
    });
  }
  await tx.document.update({ where: { id: clean.documentId }, data: { restrictionMode: clean.mode } });
  await rebuildGates(tx, clean.documentId);
}

/**
 * Recomputes `DocumentViewGate` for `rootDocumentId` and every descendant (RD-056): each
 * document is gated by every ancestor-or-self that is `EXPLICIT` with a view list.
 * Called when a restriction changes and when a document is created or moved, which are
 * the only events that change a document's ancestry or its ancestors' lists.
 *
 * `UNION` rather than `UNION ALL` makes both recursions terminate even if the tree were
 * ever to contain a cycle.
 */
export async function rebuildGates(tx: Prisma.TransactionClient, rootDocumentId: string): Promise<void> {
  // X3-exempt: maintains the gates the predicate reads; it shows nothing to anyone.
  await tx.$executeRaw`
    WITH RECURSIVE subtree AS (
      SELECT d."id" FROM "Document" d WHERE d."id" = ${rootDocumentId}
      UNION
      SELECT c."id" FROM "Document" c JOIN subtree s ON c."parentId" = s."id"
    )
    DELETE FROM "DocumentViewGate" g USING subtree s WHERE g."documentId" = s."id"
  `;
  await tx.$executeRaw`
    WITH RECURSIVE subtree AS (
      SELECT d."id" FROM "Document" d WHERE d."id" = ${rootDocumentId}
      UNION
      SELECT c."id" FROM "Document" c JOIN subtree s ON c."parentId" = s."id"
    ),
    ancestry AS (
      SELECT s."id" AS "documentId", s."id" AS "ancestorId" FROM subtree s
      UNION
      SELECT a."documentId", d."parentId"
        FROM ancestry a JOIN "Document" d ON d."id" = a."ancestorId"
       WHERE d."parentId" IS NOT NULL
    )
    INSERT INTO "DocumentViewGate" ("documentId", "gateDocumentId")
    SELECT a."documentId", a."ancestorId"
      FROM ancestry a
      JOIN "Document" gate ON gate."id" = a."ancestorId"
     WHERE gate."restrictionMode" = 'EXPLICIT'
       AND EXISTS (SELECT 1 FROM "DocumentRestriction" dr WHERE dr."documentId" = gate."id" AND dr."canView")
    ON CONFLICT DO NOTHING
  `;
}

export async function rebuildGatesNow(rootDocumentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => rebuildGates(tx, rootDocumentId));
}

export type RestrictionView = {
  mode: RestrictionMode;
  grants: Array<{
    userId: string | null;
    groupId: string | null;
    name: string;
    canView: boolean;
    canEdit: boolean;
  }>;
  /** Restricted ancestors whose view list also applies (RD-056), by title. */
  inherited: Array<{ documentId: string; title: string }>;
};

/**
 * The restriction screen's data. Only reached by someone who can edit the document, or by
 * space ADMIN through the unlock screen (RD-058), and it shows names and titles only.
 */
export async function restrictionOf(documentId: string): Promise<RestrictionView | null> {
  // X3-exempt: callers have established edit rights or ADMIN; no requirement content.
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      restrictionMode: true,
      restrictions: {
        select: { userId: true, groupId: true, canView: true, canEdit: true },
      },
      viewGates: {
        where: { gateDocumentId: { not: documentId } },
        select: { gateDocument: { select: { id: true, title: true } } },
      },
    },
  });
  if (!document) return null;

  const userIds = document.restrictions.flatMap((grant) => (grant.userId ? [grant.userId] : []));
  const groupIds = document.restrictions.flatMap((grant) => (grant.groupId ? [grant.groupId] : []));
  const [users, groups] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((user) => [user.id, `${user.name} <${user.email}>`]));
  const groupName = new Map(groups.map((group) => [group.id, `${group.name} (group)`]));

  return {
    mode: document.restrictionMode,
    grants: document.restrictions.map((grant) => ({
      userId: grant.userId,
      groupId: grant.groupId,
      name: grant.userId ? userName.get(grant.userId) ?? 'Unknown user' : groupName.get(grant.groupId ?? '') ?? 'Unknown group',
      canView: grant.canView,
      canEdit: grant.canEdit,
    })),
    inherited: document.viewGates.map((gate) => ({ documentId: gate.gateDocument.id, title: gate.gateDocument.title })),
  };
}

/**
 * RD-058 — the ADMIN unlock screen: restricted documents by **title only**. No content,
 * no requirement, nothing a restriction protects — a title is how an administrator finds
 * the document a leaver locked, and the title is what the document tree would show anyone
 * who can see it.
 */
export async function listRestrictedDocuments(spaceId: string) {
  // X3-exempt: RD-058 — titles only, for space ADMIN, to recover orphaned documents.
  const documents = await prisma.document.findMany({
    where: { spaceId, deletedAt: null, restrictionMode: 'EXPLICIT' },
    orderBy: { title: 'asc' },
    select: {
      id: true,
      title: true,
      restrictions: { select: { canView: true, canEdit: true } },
    },
  });
  return documents.map((document) => ({
    id: document.id,
    title: document.title,
    viewers: document.restrictions.filter((grant) => grant.canView).length,
    editors: document.restrictions.filter((grant) => grant.canEdit).length,
  }));
}

/**
 * Rule X4 — copies the gates, and their grants, of every frozen member's origin document
 * as they stand now into the baseline (RD-059). Called when a freeze completes; a refreeze
 * replaces the copy, because it is a new freeze.
 */
export async function snapshotGatesForBaseline(baselineId: string): Promise<void> {
  // X3-exempt: copies restriction state for rule X4; shows nothing to anyone.
  await prisma.$transaction(async (tx) => {
    await tx.baselineGateGrant.deleteMany({ where: { baselineId } });
    await tx.baselineViewGate.deleteMany({ where: { baselineId } });
    await tx.$executeRaw`
      INSERT INTO "BaselineViewGate" ("baselineId", "documentId", "gateDocumentId")
      SELECT DISTINCT r."baselineId", v."documentId", g."gateDocumentId"
        FROM "Requirement" r
        JOIN "DocumentVersion" v ON v."id" = r."originVersionId"
        JOIN "DocumentViewGate" g ON g."documentId" = v."documentId"
       WHERE r."baselineId" = ${baselineId}
      ON CONFLICT DO NOTHING
    `;
    await tx.$executeRaw`
      INSERT INTO "BaselineGateGrant" ("id", "baselineId", "gateDocumentId", "userId", "groupId")
      SELECT 'bgg_' || md5(${baselineId} || dr."id"), ${baselineId}, gates."gateDocumentId", dr."userId", dr."groupId"
        FROM (SELECT DISTINCT "gateDocumentId" FROM "BaselineViewGate" WHERE "baselineId" = ${baselineId}) gates
        JOIN "DocumentRestriction" dr ON dr."documentId" = gates."gateDocumentId" AND dr."canView"
    `;
  });
}

/**
 * Whether `userId` (with `groupIds`) would still view and edit the document under a
 * proposed list — RD-057's self-lockout check, evaluated on the proposal before anything
 * is written. Only the document's own list is in question: its ancestors' gates do not
 * change here, and the caller already passes them, or they could not be editing it.
 */
export function keepsAccess(
  proposal: RestrictionInput,
  actor: { userId: string; groupIds: readonly string[] },
): { view: boolean; edit: boolean } {
  if (proposal.mode === 'INHERIT') return { view: true, edit: true };
  const mine = proposal.grants.filter(
    (grant) => grant.userId === actor.userId || (grant.groupId !== null && grant.groupId !== undefined && actor.groupIds.includes(grant.groupId)),
  );
  const anyEditList = proposal.grants.some((grant) => grant.canEdit);
  return {
    view: mine.some((grant) => grant.canView || grant.canEdit),
    edit: !anyEditList || mine.some((grant) => grant.canEdit),
  };
}

/** Writes a restriction and its audit row together (spec 07 §6). */
export async function changeRestriction(input: {
  // X3-exempt: the caller established edit rights or ADMIN (RD-057, RD-058).
  proposal: RestrictionInput;
  actorId: string;
  spaceId: string;
  operation: 'restrict' | 'unlock';
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.documentRestriction.findMany({
      where: { documentId: input.proposal.documentId },
      select: { userId: true, groupId: true, canView: true, canEdit: true },
    });
    const document = await tx.document.findUniqueOrThrow({
      where: { id: input.proposal.documentId },
      select: { restrictionMode: true },
    });
    await setRestriction(tx, input.proposal);
    await recordAuditEventIn(tx, {
      actorId: input.actorId,
      spaceId: input.spaceId,
      objectType: 'Document',
      objectId: input.proposal.documentId,
      operation: input.operation,
      parameters: JSON.parse(
        JSON.stringify({
          from: { mode: document.restrictionMode, grants: before },
          to: { mode: input.proposal.mode, grants: input.proposal.grants },
        }),
      ),
    });
  });
}
