// The page screens' URLs, in one place (10 section 11). Every path segment is percent-encoded,
// so a space key or page id can never break out of its segment.
// spec: docs/specs/10-ui-reference.md section 11 (URLs)

const enc = encodeURIComponent;

/** `/spaces/{SPACE}`: the space overview, which is its page tree. */
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

/** `/spaces/{SPACE}/pages/{pageId}/edit`: the editor. */
export function pageEditHref(spaceKey: string, pageId: string): string {
  return `${pageHref(spaceKey, pageId)}/edit`;
}

/** `/spaces/{SPACE}/pages/{pageId}/history`: Page History (10 section 23). */
export function pageHistoryHref(spaceKey: string, pageId: string): string {
  return `${pageHref(spaceKey, pageId)}/history`;
}

/** `/spaces/{SPACE}?highlight={pageId}`: View in Hierarchy (RD-059). */
export function hierarchyHref(spaceKey: string, pageId: string): string {
  return `${spaceHref(spaceKey)}?highlight=${enc(pageId)}`;
}
