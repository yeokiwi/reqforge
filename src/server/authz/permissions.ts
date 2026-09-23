import type { SpacePermission } from '@prisma/client';

/** spec: 07-permissions-and-limits.md §2.1 — what each permission grants, for the UI. */
export const PERMISSION_LABELS: Readonly<Record<SpacePermission, string>> = {
  VIEW: 'See the space, its documents, requirements, search and matrices',
  EDIT: 'Create and edit documents, edit external property values, reset key sequences',
  EXPORT: 'Dependency matrix, coverage, xlsx and diff exports, bulk operations',
  ADMIN: 'Requirement types, key locking, renaming, baselines, history settings, permissions, the audit log',
};

export const ALL_PERMISSIONS: readonly SpacePermission[] = ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'];

/**
 * RD-061 — every permission is useless without VIEW, and `requireSpace` checks VIEW
 * first, so granting any permission grants VIEW with it. Otherwise "EDIT only" would be a
 * membership that silently does nothing.
 */
export function normalisePermissions(requested: readonly string[]): SpacePermission[] {
  const wanted = new Set(requested.filter((value): value is SpacePermission => (ALL_PERMISSIONS as readonly string[]).includes(value)));
  if (wanted.size > 0) wanted.add('VIEW');
  return ALL_PERMISSIONS.filter((permission) => wanted.has(permission));
}
