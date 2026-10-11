// Which pages are open in the tree, remembered per space in localStorage. Every access is in a
// try/catch: storage can be disabled, full, or throw on the mere `window.localStorage` getter
// (some privacy modes), and the tree must render correctly without it.
// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE)

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Returns the storage to use, or null. May throw; callers never let that escape. */
export type StorageSource = () => StorageLike | null;

/** At most this many ids are kept, so a corrupt or hostile value cannot grow without bound. */
export const MAX_REMEMBERED = 5000;

export function expansionKey(spaceKey: string): string {
  return `reqforge.pageTree.expanded.${spaceKey.toUpperCase()}`;
}

/** The ids remembered as open in this space; [] when there is nothing usable. */
export function readExpanded(source: StorageSource, spaceKey: string): string[] {
  try {
    const raw = source()?.getItem(expansionKey(spaceKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64).slice(0, MAX_REMEMBERED);
  } catch {
    return [];
  }
}

/** Remembers the open ids; failures are ignored. */
export function writeExpanded(source: StorageSource, spaceKey: string, ids: Iterable<string>): void {
  try {
    const list = [...ids].slice(0, MAX_REMEMBERED);
    source()?.setItem(expansionKey(spaceKey), JSON.stringify(list));
  } catch {
    // Storage unavailable or full: the tree still works, it just won't remember.
  }
}

/** The browser's localStorage, read lazily (the getter itself can throw). */
export const browserStorage: StorageSource = () => (typeof window === "undefined" ? null : window.localStorage);
