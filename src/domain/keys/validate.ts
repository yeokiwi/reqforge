/**
 * Key validation. spec: 03-authoring-and-indexing.md §4.1 —
 * `^[A-Za-z0-9._-]+$`, length 2–64, at least one non-digit, no leading/trailing separator.
 * Rejects slashes and spaces, as Requirement Yogi does (research §2.2, §6.7).
 *
 * Always applied server-side during indexing; a key arriving from the client is never
 * trusted (research §2.2's devtools warning).
 */
export const KEY_MIN_LENGTH = 2;
export const KEY_MAX_LENGTH = 64;

const ALLOWED = /^[A-Za-z0-9._-]+$/;
const SEPARATOR = /^[._-]|[._-]$/;

export type KeyProblem =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'ILLEGAL_CHARACTER'
  | 'ALL_DIGITS'
  | 'EDGE_SEPARATOR';

export type KeyCheck = { ok: true; key: string; upperKey: string } | { ok: false; problem: KeyProblem; message: string };

export function checkKey(raw: string): KeyCheck {
  const key = raw.trim();

  if (key.length === 0) {
    return { ok: false, problem: 'EMPTY', message: 'A requirement key cannot be empty.' };
  }
  if (!ALLOWED.test(key)) {
    return {
      ok: false,
      problem: 'ILLEGAL_CHARACTER',
      message: 'A requirement key may contain only letters, digits, dot, underscore and hyphen.',
    };
  }
  if (key.length < KEY_MIN_LENGTH) {
    return { ok: false, problem: 'TOO_SHORT', message: `A requirement key must be at least ${KEY_MIN_LENGTH} characters.` };
  }
  if (key.length > KEY_MAX_LENGTH) {
    return { ok: false, problem: 'TOO_LONG', message: `A requirement key must be at most ${KEY_MAX_LENGTH} characters.` };
  }
  if (SEPARATOR.test(key)) {
    return {
      ok: false,
      problem: 'EDGE_SEPARATOR',
      message: 'A requirement key cannot start or end with a dot, underscore or hyphen.',
    };
  }
  if (!/[^0-9]/.test(key)) {
    return { ok: false, problem: 'ALL_DIGITS', message: 'A requirement key needs at least one non-digit character.' };
  }

  return { ok: true, key, upperKey: key.toUpperCase() };
}

export function isValidKey(raw: string): boolean {
  return checkKey(raw).ok;
}

/** The denormalised uppercase form used for case-insensitive matching (research §5.7). */
export function upperKey(key: string): string {
  return key.trim().toUpperCase();
}
