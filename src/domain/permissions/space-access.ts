// spec: 07-permissions-and-limits.md §2.1 (space permissions), RD-051.
//
// Pure evaluation of what a user may do in a space, given the permission sets granted to
// them — directly or through a group. Persistence and group resolution happen elsewhere;
// this file only decides.

export const SPACE_PERMISSIONS = ["VIEW", "EDIT", "EXPORT", "ADMIN"] as const;
export type SpacePermission = (typeof SPACE_PERMISSIONS)[number];

/** One membership row's permissions. A user typically has several (direct + per group). */
export type PermissionGrant = readonly SpacePermission[];

export interface SpaceAccess {
  readonly permissions: ReadonlySet<SpacePermission>;
  /** The only gate on a space existing for this caller (rule X2: omitted, not redacted). */
  readonly canView: boolean;
  readonly canEdit: boolean;
  readonly canExport: boolean;
  readonly canAdmin: boolean;
}

// spec: 07 §2.1 + RD-051. Permissions are an explicit set and the union of every grant that
// applies. None implies another, but every action other than viewing also requires VIEW:
// a grant of EDIT alone on a space you cannot see does nothing.
export function evaluateSpaceAccess(grants: readonly PermissionGrant[]): SpaceAccess {
  const permissions = new Set<SpacePermission>();
  for (const grant of grants) for (const permission of grant) permissions.add(permission);

  const canView = permissions.has("VIEW");
  return {
    permissions,
    canView,
    canEdit: canView && permissions.has("EDIT"),
    canExport: canView && permissions.has("EXPORT"),
    canAdmin: canView && permissions.has("ADMIN"),
  };
}
