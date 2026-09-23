/**
 * API token scopes. Pure. spec: 08-api-surface.md §1 ("scoped, per user, revocable");
 * RD-065.
 *
 * A scope names one space permission. A token's effective rights in a space are the
 * intersection of its scopes and its owner's live permissions there — a token can never
 * do more than the person it belongs to, and loses what they lose.
 */
export const API_SCOPES = ['read', 'edit', 'export', 'admin'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

type Permission = 'VIEW' | 'EDIT' | 'EXPORT' | 'ADMIN';

const PERMISSION_OF: Readonly<Record<ApiScope, Permission>> = {
  read: 'VIEW',
  edit: 'EDIT',
  export: 'EXPORT',
  admin: 'ADMIN',
};

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

/**
 * Normalises a requested scope list: unknown names dropped, duplicates merged, and `read`
 * added whenever anything is granted — every permission is useless without VIEW, which is
 * the same rule `RD-061` applies to memberships.
 */
export function normaliseScopes(requested: readonly unknown[]): ApiScope[] {
  const wanted = new Set(requested.filter(isApiScope));
  if (wanted.size > 0) wanted.add('read');
  return API_SCOPES.filter((scope) => wanted.has(scope));
}

/** The owner's permissions, narrowed to what the token's scopes allow. */
export function intersectPermissions<P extends Permission>(
  ownerPermissions: readonly P[],
  scopes: readonly string[],
): P[] {
  const allowed = new Set(scopes.filter(isApiScope).map((scope) => PERMISSION_OF[scope]));
  return ownerPermissions.filter((permission) => allowed.has(permission));
}

/** `rf_<tokenId>_<secret>`: the id locates the row, the secret proves possession. */
export function parseTokenString(raw: string): { id: string; secret: string } | null {
  const match = /^rf_([a-z0-9]{20,40})_([A-Za-z0-9_-]{32,64})$/.exec(raw.trim());
  return match ? { id: match[1]!, secret: match[2]! } : null;
}
