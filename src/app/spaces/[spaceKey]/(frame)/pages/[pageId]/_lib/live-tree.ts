// The page's place in the frame's LIVE page tree: the PageTreeStore that AppFrame provides and the
// sidebar shows (src/ui/page-tree). A move dragged in the sidebar, a refetch after another user's
// change, or a move made from this view lands there at once; the view's server render does not
// change until the next navigation. So the Move dialog's list and its `Current` mark, and the
// breadcrumb's ancestors, are read from here, and the render's PageDetail is only the fallback
// for a page the live tree does not (yet) have. Pure, so the rules are tested without React.
// spec: docs/specs/10-ui-reference.md sections 3.2 (PAGE TREE) and 4.1 (breadcrumb, `···` → Move); docs/specs/09-decision-log.md sections RD-056, RD-078
import type { PageDetail, PageSummary } from "@/domain/documents";
import { ancestorIds, type TreeModel } from "@/ui/page-tree/model";

/** The page's parent as the live tree has it; the render's when the tree does not have the page. */
// spec: docs/specs/09-decision-log.md section RD-056 (moving: the page's present place is where the tree has it)
export function liveParentId(pages: readonly PageSummary[], page: Pick<PageDetail, "id" | "parentId">): string | null {
  const live = pages.find((candidate) => candidate.id === page.id);
  return live === undefined ? page.parentId : live.parentId;
}

/**
 * The page's ancestors, root first and the page left out (as PageDetail.ancestors), as the live
 * tree has them; null when the tree does not have the page.
 */
// spec: docs/specs/10-ui-reference.md section 4.1 (Breadcrumb `Pages / <ancestors> / <title>`); RD-078
export function liveAncestors(model: TreeModel, pageId: string): { readonly id: string; readonly title: string }[] | null {
  if (!model.nodes.has(pageId)) return null;
  return ancestorIds(model, pageId).map((id) => ({ id, title: model.nodes.get(id)?.title ?? "" }));
}
