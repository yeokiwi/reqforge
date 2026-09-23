import type { SpacePermission } from '@prisma/client';
import { NotFoundError, ValidationError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { normalisePermissions } from '@/server/authz/permissions';
import {
  changeMembership,
  findGroupByName,
  findUserByEmail,
  listMemberships,
} from '@/server/repositories/memberships';

/**
 * Space permission administration. spec: 07-permissions-and-limits.md §2.1, §6; RD-061.
 * Space ADMIN grants and revokes; the change and the audit row are one transaction, and so
 * is the check that at least one person still administers the space afterwards.
 */

export async function listPermissionsUseCase(spaceKey: string) {
  const { space } = await requireSpace(spaceKey, 'ADMIN');
  return listMemberships(space.id);
}

export type GrantInput = {
  /** One of the two: an email address or a group name. */
  email?: unknown;
  group?: unknown;
  permissions: readonly string[];
};

async function resolveSubject(input: GrantInput): Promise<{ userId: string | null; groupId: string | null; label: string }> {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const group = typeof input.group === 'string' ? input.group.trim() : '';
  if ((email.length > 0) === (group.length > 0)) {
    throw new ValidationError('Name exactly one person (by email) or one group.');
  }
  if (email) {
    const user = await findUserByEmail(email);
    if (!user) throw new NotFoundError(`No user has the email ${email}.`);
    return { userId: user.id, groupId: null, label: user.email };
  }
  const found = await findGroupByName(group);
  if (!found) throw new NotFoundError(`No group is called “${group}”.`);
  return { userId: null, groupId: found.id, label: `group ${found.name}` };
}

/** Sets a subject's permissions in the space, exactly; an empty set revokes them all. */
export async function setPermissionsUseCase(spaceKey: string, input: GrantInput): Promise<SpacePermission[]> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const subject = await resolveSubject(input);
  const permissions = normalisePermissions(input.permissions);

  await changeMembership({ spaceId: space.id, subject, permissions, actorId: user.id });
  return permissions;
}
