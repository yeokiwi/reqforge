import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors';
import {
  matchesPattern,
  parsePattern,
  resetSequenceTo,
  suggestNextKey,
  type KeyPattern,
} from '@/domain/keys/pattern';
import { checkKey } from '@/domain/keys/validate';
import { requireSpace } from '@/server/authz';
import { recordAuditEvent } from '@/server/repositories/audit';
import {
  keysUsedInDocument,
  listAllKeys,
  listKeysExcludingDeleted,
  listRequirementTypes,
  setNextSequence,
} from '@/server/repositories/requirement-types';

export type KeySuggestion = {
  key: string;
  typeId: string;
  typeName: string | null;
  keyPattern: string;
};

function patternOf(source: string): KeyPattern | null {
  const parsed = parsePattern(source);
  return parsed.ok ? parsed.pattern : null;
}

/**
 * Next key for this document.
 * spec: 03-authoring-and-indexing.md §4.2 —
 * 1. the type matching the context (the last key used in this document, else the space
 *    default), 2. `max(nextSequence, highestExistingNumber + 1)`.
 */
export async function suggestNextKeyUseCase(input: {
  spaceKey: string;
  documentId?: string | null;
  typeId?: string | null;
}): Promise<KeySuggestion> {
  const { space } = await requireSpace(input.spaceKey, 'EDIT');
  const types = await listRequirementTypes(space.id);
  if (types.length === 0) {
    throw new NotFoundError('This space has no key patterns configured yet.');
  }

  let chosen = input.typeId ? types.find((type) => type.id === input.typeId) : undefined;

  if (!chosen && input.documentId) {
    const recent = await keysUsedInDocument(space.id, input.documentId);
    chosen = types.find((type) => {
      const pattern = patternOf(type.keyPattern);
      return pattern ? recent.some((key) => matchesPattern(pattern, key)) : false;
    });
  }

  chosen ??= types[0]!;

  const pattern = patternOf(chosen.keyPattern);
  if (!pattern) throw new ValidationError(`The key pattern "${chosen.keyPattern}" is not usable.`);

  // RD-026: `preventReusingDeletedKeys` decides whether DELETED keys still block reuse.
  // With it off, a reset sequence would otherwise be a no-op.
  const existingKeys = chosen.preventReusingDeletedKeys
    ? await listAllKeys(space.id)
    : await listKeysExcludingDeleted(space.id);

  const { key } = suggestNextKey({ pattern, nextSequence: chosen.nextSequence, existingKeys });

  return { key, typeId: chosen.id, typeName: chosen.name, keyPattern: chosen.keyPattern };
}

/**
 * "Reset sequence" rewinds to the highest *live* key plus one.
 * spec: 03-authoring-and-indexing.md §4.2 step 4 — gated on
 * `preventReusingDeletedKeys = false` and the edit-space permission.
 */
export async function resetKeySequenceUseCase(spaceKey: string, typeId: string): Promise<number> {
  const { space, user } = await requireSpace(spaceKey, 'EDIT');
  const types = await listRequirementTypes(space.id);
  const type = types.find((candidate) => candidate.id === typeId);
  if (!type) throw new NotFoundError('That key pattern does not exist in this space.');

  if (type.preventReusingDeletedKeys) {
    throw new ConflictError(
      `${type.keyPattern} prevents reusing deleted keys. Turn that off before resetting the sequence.`,
    );
  }

  const pattern = patternOf(type.keyPattern);
  if (!pattern) throw new ValidationError(`The key pattern "${type.keyPattern}" is not usable.`);

  const next = resetSequenceTo(pattern, await listKeysExcludingDeleted(space.id));
  await setNextSequence(type.id, next);
  // RD-062 — a reset can let a key be issued twice across time; an auditor will ask when.
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'RequirementType',
    objectId: type.id,
    operation: 'reset-sequence',
    parameters: { keyPattern: type.keyPattern, next },
  });
  return next;
}

/** Server-side validation of a key typed by a user, before it reaches a document. */
export function validateKeyInput(raw: string): string {
  const checked = checkKey(raw);
  if (!checked.ok) throw new ValidationError(checked.message);
  return checked.key;
}
