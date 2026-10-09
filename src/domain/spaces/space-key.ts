// spec: 01-domain-model.md (Space) — `key` is a short uppercase identifier, unique globally,
// `[A-Z][A-Z0-9]{1,15}`. The same pattern is a CHECK constraint in the init migration.

export const SPACE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,15}$/;

export function isValidSpaceKey(key: string): boolean {
  return SPACE_KEY_PATTERN.test(key);
}

/**
 * URLs carry the key as typed, but the canonical form is uppercase (`/spaces/team` and
 * `/spaces/TEAM` are the same space). Returns null when the result is not a valid key, so
 * callers can answer "not found" without touching the database.
 */
export function canonicalSpaceKey(raw: string): string | null {
  const upper = raw.toUpperCase();
  return isValidSpaceKey(upper) ? upper : null;
}
