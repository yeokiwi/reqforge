// The URLs Page History and Compare link to (10 section 11). Every path segment is percent-
// encoded, so a space key or page id can never break out of its segment. Kept here rather than
// borrowed from the page view's helpers so the two screens can be built in parallel; the paths
// are the table in 10 section 11, which both follow.
// spec: docs/specs/10-ui-reference.md section 11 (URLs); docs/specs/09-decision-log.md section RD-060

const enc = encodeURIComponent;

/** `/spaces/{SPACE}`: the space overview. */
export function spaceHref(spaceKey: string): string {
  return `/spaces/${enc(spaceKey)}`;
}

/** `/spaces/{SPACE}/pages/{pageId}`: the page view, current version. */
export function pageHref(spaceKey: string, pageId: string): string {
  return `${spaceHref(spaceKey)}/pages/${enc(pageId)}`;
}

/** `/spaces/{SPACE}/pages/{pageId}?version={n}`: a past version, read-only (RD-060). */
export function pageVersionHref(spaceKey: string, pageId: string, version: number): string {
  return `${pageHref(spaceKey, pageId)}?version=${version}`;
}

/** `/spaces/{SPACE}/pages/{pageId}/history`: Page History (10 section 23). */
export function historyHref(spaceKey: string, pageId: string): string {
  return `${pageHref(spaceKey, pageId)}/history`;
}

/**
 * `/spaces/{SPACE}/pages/{pageId}/history/compare?a={n}&b={m}` (10 section 11). The caller
 * decides the order; Page History always passes the older version as `a` (see comparePair).
 */
// spec: docs/specs/10-ui-reference.md section 11 (Compare two versions)
export function compareHref(spaceKey: string, pageId: string, a: number, b: number): string {
  return `${historyHref(spaceKey, pageId)}/compare?a=${a}&b=${b}`;
}
