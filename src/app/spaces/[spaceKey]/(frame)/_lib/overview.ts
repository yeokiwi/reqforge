// The space overview's decisions, kept out of the route file (10 §11).
// spec: docs/specs/10-ui-reference.md section 11 (Space overview = the page tree; ?highlight={pageId} for View in Hierarchy); RD-059
import { isPageId } from "@/ui/page-tree/model";
import type { InitialTree } from "@/ui/page-tree/store";

/**
 * The page `?highlight=` names, or null. A malformed value, a repeated parameter, and an id that
 * is not a page of the tree as this viewer sees it (unknown, deleted, or not visible) are simply
 * ignored: the overview opens without a highlight and says nothing about the id (RD-051).
 */
// spec: docs/specs/10-ui-reference.md section 11; RD-059 (View in Hierarchy opens the overview with the page highlighted)
export function highlightFromParam(value: string | string[] | undefined, tree: InitialTree): string | null {
  if (typeof value !== "string" || !isPageId(value)) return null;
  // When the tree could not be loaded the client decides, once it has the pages.
  if (tree.status === "ready" && !tree.pages.some((page) => page.id === value)) return null;
  return value;
}
