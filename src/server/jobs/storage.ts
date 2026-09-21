import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

/**
 * Where job results are written. Files are served only through a route that re-checks the
 * caller's permissions (spec 07 §2.1), never by path.
 */
export function storageRoot(): string {
  return resolve(process.env.REQFORGE_STORAGE_DIR ?? '.storage');
}

export async function ensureStorageDir(...segments: string[]): Promise<string> {
  const directory = join(storageRoot(), ...segments);
  await mkdir(directory, { recursive: true });
  return directory;
}

/**
 * Resolves a stored `resultRef` back to a path, refusing anything that escapes the
 * storage root — a `resultRef` is a database value and a traversal there must not become
 * a file read anywhere on disk.
 */
export function resolveStoredPath(resultRef: string): string | null {
  if (isAbsolute(resultRef) || resultRef.includes('\0')) return null;

  const root = storageRoot();
  const path = resolve(root, normalize(resultRef));
  return path === root || path.startsWith(root + sep) ? path : null;
}
