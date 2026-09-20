import type { SpacePermission } from '@prisma/client';

/** spec: 07-permissions-and-limits.md §2.1 — what each permission grants, for the UI. */
export const PERMISSION_LABELS: Readonly<Record<SpacePermission, string>> = {
  VIEW: 'See the space, its documents, requirements, search and matrices',
  EDIT: 'Create and edit documents, edit external property values, reset key sequences',
  EXPORT: 'Dependency matrix, coverage, xlsx and diff exports, bulk operations',
  ADMIN: 'Requirement types, key locking, baselines, history settings, permissions',
};

export const ALL_PERMISSIONS: readonly SpacePermission[] = ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'];
