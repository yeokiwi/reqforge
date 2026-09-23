import type { RestrictionMode } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { listLevels } from '@/server/repositories/classification';
import { findDocument } from '@/server/repositories/documents';
import { listSubjects } from '@/server/repositories/memberships';
import {
  changeRestriction,
  keepsAccess,
  listRestrictedDocuments,
  normaliseRestriction,
  restrictionOf,
  type RestrictionGrant,
  type RestrictionInput,
} from '@/server/repositories/restrictions';
import { isDocumentEditable } from '@/server/repositories/visibility';

/**
 * Document restrictions. spec: 07-permissions-and-limits.md §2.2.
 *   - RD-057: whoever may edit a document may restrict it, but not lock themselves out.
 *   - RD-058: space ADMIN never reads restricted content, but can list restricted
 *     documents by title and unlock them — how a document orphaned by a leaver is
 *     recovered. Every change is audited.
 */

async function requireRestrictable(spaceKey: string, documentId: string) {
  const context = await requireSpace(spaceKey, 'EDIT');
  const document = await findDocument(context.viewer, context.space.id, documentId);
  // RD-064 — a hidden document reads as a missing one.
  if (!document) throw new NotFoundError('That document no longer exists.');
  if (!(await isDocumentEditable(context.viewer, documentId))) {
    throw new ForbiddenError('Only someone who may edit this document can change who sees it.');
  }
  return { ...context, document };
}

export async function documentRestrictionUseCase(spaceKey: string, documentId: string) {
  const { space, document } = await requireRestrictable(spaceKey, documentId);
  const [restriction, subjects, levels] = await Promise.all([
    restrictionOf(documentId),
    listSubjects(space.id),
    listLevels(),
  ]);
  if (!restriction) throw new NotFoundError('That document no longer exists.');
  return {
    document: { id: document.id, title: document.title, classificationId: document.classificationId },
    restriction,
    subjects,
    levels,
  };
}

function cleanGrants(raw: unknown): RestrictionGrant[] {
  if (!Array.isArray(raw)) throw new ValidationError('The restriction list is malformed.');
  return raw.flatMap((entry): RestrictionGrant[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { userId, groupId, canView, canEdit } = entry as Record<string, unknown>;
    return [
      {
        userId: typeof userId === 'string' && userId.length > 0 ? userId : null,
        groupId: typeof groupId === 'string' && groupId.length > 0 ? groupId : null,
        canView: canView === true,
        canEdit: canEdit === true,
      },
    ];
  });
}

export async function setDocumentRestrictionUseCase(input: {
  spaceKey: string;
  documentId: string;
  mode: unknown;
  grants: unknown;
}): Promise<void> {
  const { space, user, viewer } = await requireRestrictable(input.spaceKey, input.documentId);
  const mode: RestrictionMode = input.mode === 'EXPLICIT' ? 'EXPLICIT' : 'INHERIT';
  const proposal: RestrictionInput = normaliseRestriction({
    documentId: input.documentId,
    mode,
    grants: mode === 'EXPLICIT' ? cleanGrants(input.grants) : [],
  });

  // RD-057 — a change that would take away the actor's own view or edit is refused, not
  // warned about: nobody else might be able to undo it but an administrator.
  const kept = keepsAccess(proposal, viewer);
  if (!kept.view || !kept.edit) {
    throw new ValidationError(
      'That would lock you out of this document. Keep yourself (or a group you are in) on both lists.',
    );
  }

  await changeRestriction({ proposal, actorId: user.id, spaceId: space.id, operation: 'restrict' });
}

/** RD-058 — titles only; no content, no requirement. */
export async function listRestrictedDocumentsUseCase(spaceKey: string) {
  const { space } = await requireSpace(spaceKey, 'ADMIN');
  return listRestrictedDocuments(space.id);
}

/**
 * RD-058 — an administrator removes a restriction without being able to read what it
 * protected. Only a document that *is* restricted in this space can be unlocked, so this
 * cannot be used to probe whether a document id exists elsewhere.
 */
export async function unlockDocumentUseCase(spaceKey: string, documentId: string): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const restricted = await listRestrictedDocuments(space.id);
  if (!restricted.some((document) => document.id === documentId)) {
    throw new NotFoundError('That document is not restricted.');
  }
  await changeRestriction({
    proposal: { documentId, mode: 'INHERIT', grants: [] },
    actorId: user.id,
    spaceId: space.id,
    operation: 'unlock',
  });
}
