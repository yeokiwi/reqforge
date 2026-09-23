import type { Space, SpacePermission, User } from '@prisma/client';
import { AuthenticationError, ForbiddenError, NotFoundError } from '@/domain/errors';
import { intersectPermissions } from '@/domain/api-scopes';
import { currentPrincipal } from '@/server/auth/principal';
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

  const principal = currentPrincipal();
  // RD-065 — a token confined to other spaces sees this one exactly as a space it may not
  // view: not found, never forbidden.
  if (principal?.kind === 'token' && principal.spaceKeys.length > 0 && !principal.spaceKeys.includes(space.key)) {
    throw new NotFoundError(`No space with key "${spaceKey}".`);
  }
  const owned = await effectivePermissions(user.id, space.id);
  // RD-065 — a token never exceeds its owner, and never exceeds its own scopes.
  const permissions = principal?.kind === 'token' ? intersectPermissions(owned, principal.scopes) : owned;
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
  // RD-065 — instance administration needs a person at a browser, never a token.
  if (currentPrincipal()?.kind === 'token') {
    throw new ForbiddenError(`An API token cannot ${what}; sign in to do it.`);
  }
  if (!user.isAdmin) {
    throw new ForbiddenError(`Only an instance administrator can ${what}.`);
  }
  return user;
}

/**
 * Managing API tokens needs a session: a token that could mint tokens would make every
 * scope meaningless (RD-065).
 */
export async function requireSessionUser(): Promise<User> {
  const user = await requireUser();
  if (currentPrincipal()?.kind === 'token') {
    throw new ForbiddenError('API tokens are managed from a signed-in session, not with a token.');
  }
  return user;
}
