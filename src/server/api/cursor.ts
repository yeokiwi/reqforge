import { z } from 'zod/v4';
import { ValidationError } from '@/domain/errors';

/**
 * Opaque keyset cursors. spec: 08-api-surface.md §1 — "`?limit` (default 50, max 600) and
 * an opaque `?cursor`. Never offset." RD-068.
 *
 * Opaque means a client must not build one; it is base64url JSON only so that a malformed
 * cursor can be rejected precisely rather than silently restarting the list.
 */
export type Cursor = { upperKey: string; id: string };

export const LIMIT_DEFAULT = 50;
export const LIMIT_MAX = 600;

export const limitSchema = z.coerce.number().int().min(1).max(LIMIT_MAX).default(LIMIT_DEFAULT);
export const cursorSchema = z.string().max(512).optional();

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.upperKey, cursor.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (raw === undefined || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { upperKey: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through to the refusal
  }
  throw new ValidationError('That cursor is not one this API issued.');
}

/**
 * The traceability matrix still pages by position internally (its tree view and column
 * computation are built on `runMatrixForUser`'s offset). Its cursor is opaque like every
 * other, so moving it to a keyset is a change on this side only (RD-068).
 */
export function encodePositionCursor(offset: number): string {
  return Buffer.from(JSON.stringify(['@', offset]), 'utf8').toString('base64url');
}

export function decodePositionCursor(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed[0] === '@' && Number.isInteger(parsed[1]) && (parsed[1] as number) >= 0) {
      return parsed[1] as number;
    }
  } catch {
    // fall through to the refusal
  }
  throw new ValidationError('That cursor is not one this API issued.');
}
