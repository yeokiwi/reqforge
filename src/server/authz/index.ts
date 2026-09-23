import type { Space, SpacePermission, User } from '@prisma/client';
import { AuthenticationError, ForbiddenError, NotFoundError } from '@/domain/errors';
import { currentUser } from '@/server/auth/session';
import { effectivePermissions, findSpaceByKey } from '@/server/repositories/spaces';
import { viewerFor, type Viewer } from '@/server/repositories/visibility';

export type SpaceContext = {
  user: User;
  space: Space;
  permissions: SpacePermission[];
  can: (permission: SpacePermission) => boolean;
  /** Who is reading, groups resolved once — what every rule-X3 read takes (spec 07 §2.2). */
  viewer: Viewer;
};

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthenticationError('You must sign in to continue.');
  return user;
}

/**
 * The single gate for space-scoped work. VIEW is implied by every other permission
 * being useless without it, but it is checked explicitly so a membership granting only
 * EDIT cannot read.
 * spec: 07-permissions-and-limits.md §2.1
 */
export async function requireSpace(spaceKey: string, permission: SpacePermission = 'VIEW'): Promise<SpaceContext> {
  const user = await requireUser();
  const space = await findSpaceByKey(spaceKey);
  if (!space) throw new NotFoundError(`No space with key "${spaceKey}".`);

  const permissions = await effectivePermissions(user.id, space.id);
  if (!permissions.includes('VIEW')) {
    // Not "forbidden": a space you cannot view should not be distinguishable from one
    // that does not exist.
    throw new NotFoundError(`No space with key "${spaceKey}".`);
  }
  if (!permissions.includes(permission)) {
    throw new ForbiddenError(`You need the ${permission} permission in space ${spaceKey}.`);
  }

  return {
    user,
    space,
    permissions,
    can: (p: SpacePermission) => permissions.includes(p),
    viewer: await viewerFor(user.id),
  };
}

/**
 * External property definitions are instance-global (spec 01, research §2.6), so they are
 * not a space administrator's to change — a space admin would otherwise be editing a list
 * every other space depends on. `RD-036`.
 */
export async function requireInstanceAdmin(what = 'manage external property definitions'): Promise<User> {
  const user = await requireUser();
  if (!user.isAdmin) {
    throw new ForbiddenError(`Only an instance administrator can ${what}.`);
  }
  return user;
}
