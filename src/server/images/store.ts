import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureStorageDir, resolveStoredPath } from '@/server/jobs/storage';

/**
 * Content-addressed image storage.
 * spec: 05-baselines-and-diff.md §3.2 step 7; `RD-012` — "copied into content-addressed
 * storage and the frozen body rewritten to the immutable URL".
 *
 * Addressing by digest is what makes the snapshot hold: the bytes behind a stored URL
 * cannot change, because a different image is a different URL. It also means the same
 * image in ten requirements is stored once.
 */

const DIRECTORY = 'images';

/** A stored image is named `<sha256>.<ext>`; the digest alone identifies the bytes. */
export type StoredImage = { digest: string; name: string; mediaType: string };

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

export function extensionFor(mediaType: string): string {
  return EXTENSIONS[mediaType.toLowerCase()] ?? 'bin';
}

export function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Writes the bytes unless they are already there. Idempotent by construction. */
export async function storeImage(bytes: Uint8Array, mediaType: string): Promise<StoredImage> {
  const digest = digestOf(bytes);
  const name = `${digest}.${extensionFor(mediaType)}`;
  const directory = await ensureStorageDir(DIRECTORY);
  const path = join(directory, name);

  try {
    await stat(path);
    // Already stored: the digest says the bytes are the same ones.
  } catch {
    await writeFile(path, bytes);
  }

  return { digest, name, mediaType };
}

/** The URL a frozen body points at. Served through a route that checks permissions. */
export function storedImageUrl(spaceKey: string, name: string): string {
  return `/s/${encodeURIComponent(spaceKey)}/images/${encodeURIComponent(name)}`;
}

const STORED_NAME = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

/**
 * Reads a stored image back. The name is a database-shaped value arriving from a URL, so
 * it is matched against the exact stored shape *and* re-checked by `resolveStoredPath` —
 * a traversal in a path segment must not become a file read anywhere on disk.
 */
export async function readStoredImage(name: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
  if (!STORED_NAME.test(name)) return null;

  const path = resolveStoredPath(join(DIRECTORY, name));
  if (!path) return null;

  try {
    const bytes = await readFile(path);
    return { bytes, mediaType: mediaTypeOf(name) };
  } catch {
    return null;
  }
}

function mediaTypeOf(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1);
  const found = Object.entries(EXTENSIONS).find(([, candidate]) => candidate === extension);
  return found?.[0] ?? 'application/octet-stream';
}
