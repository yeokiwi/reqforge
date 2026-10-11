// Where the Move dialog may put a page (RD-056: moving is within one space, and a page can never go
// under itself or one of its descendants). Pure, so the exclusion rule, the order and the index
// the request carries are tested without rendering.
// spec: docs/specs/09-decision-log.md sections RD-056 (moving within one space; no cycles), RD-067 (index); docs/specs/08-api-surface.md section 3 (POST /pages/{id}/move)
import { buildTree, descendantIds, type PageNode, type TreeNode, wouldCreateCycle } from "@/domain/documents/tree";

/** One choice in the Move dialog's list: the space's root, or a page to move under. */
export interface MoveTarget {
  /** The new parent's id, or null for the top level of the space. */
  readonly parentId: string | null;
  /** The page's title; empty for the root (the dialog labels it from the copy deck). */
  readonly title: string;
  /** 0 for the root and for top-level pages, then one more per level. */
  readonly depth: number;
  /** Titles of the target's ancestors, root first, so a filtered list still says where it is. */
  readonly path: readonly string[];
  /** This is where the page is now. */
  readonly current: boolean;
}

/**
 * Every place `pageId` can move to, in tree order: the top level first, then each page of the
 * space depth-first with siblings in their stored order. The page itself and all its descendants
 * are left out (moving there would create a cycle), whatever their depth. `currentParentId` is the
 * page's present parent (PageDetail.parentId), marked `current`.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (a page cannot be moved under itself or a descendant)
export function moveTargets(pages: readonly PageNode[], pageId: string, currentParentId: string | null): MoveTarget[] {
  const excluded = new Set<string>([pageId, ...descendantIds(pages, pageId)]);
  const targets: MoveTarget[] = [{ parentId: null, title: "", depth: 0, path: [], current: currentParentId === null }];
  const forest = buildTree(pages);

  // The database refuses cycles, so a list with one is corrupt or caught mid-change; buildTree then
  // shows a cycle member as a root although its parent chain loops. Only then is each target also
  // checked with wouldCreateCycle (which is linear per call, so not run on every healthy tree).
  const ids = new Set(pages.map((p) => p.id));
  const looped = forest.some((root) => root.page.parentId !== null && root.page.parentId !== root.page.id && ids.has(root.page.parentId));

  // Depth-first with an explicit stack: a chain of pages can be deeper than the call stack. Each
  // node carries a link to its parent's crumb, not a copy of the whole path, so a deep chain costs
  // linear time; a target's `path` is built only if something reads it (the filtered list does).
  const stack: { node: TreeNode<PageNode>; up: Crumb | null }[] = [];
  const pushChildren = (nodes: readonly TreeNode<PageNode>[], up: Crumb | null) => {
    for (let i = nodes.length - 1; i >= 0; i--) stack.push({ node: nodes[i] as TreeNode<PageNode>, up });
  };
  pushChildren(forest, null);
  while (stack.length > 0) {
    const { node, up } = stack.pop() as (typeof stack)[number];
    // Every node is visited; the exclusion set alone decides, so the rule has one place to fail.
    pushChildren(node.children, { title: node.page.title, up });
    if (excluded.has(node.page.id)) continue;
    if (looped && wouldCreateCycle(pages, pageId, node.page.id)) continue;
    targets.push(pageTarget(node, up, node.page.id === currentParentId));
  }
  return targets;
}

/** A link in the chain of titles above a node. */
interface Crumb {
  readonly title: string;
  readonly up: Crumb | null;
}

function pageTarget(node: TreeNode<PageNode>, up: Crumb | null, current: boolean): MoveTarget {
  let path: readonly string[] | undefined;
  return {
    parentId: node.page.id,
    title: node.page.title,
    depth: node.depth,
    current,
    get path() {
      if (path === undefined) {
        const titles: string[] = [];
        for (let crumb = up; crumb !== null; crumb = crumb.up) titles.push(crumb.title);
        path = titles.reverse();
      }
      return path;
    },
  };
}

/**
 * The targets whose title contains `query`, ignoring case (after trimming; an empty query keeps
 * everything). The top level is always kept: it is the one choice that has no title to match.
 */
export function filterMoveTargets(targets: readonly MoveTarget[], query: string): MoveTarget[] {
  const needle = query.trim().toLocaleLowerCase("en-US");
  if (needle === "") return [...targets];
  return targets.filter((target) => target.parentId === null || target.title.toLocaleLowerCase("en-US").includes(needle));
}

/**
 * The `index` a move request carries to put the page LAST among its new siblings: how many
 * children `parentId` has, not counting the moved page (RD-067: the index is a 0-based position
 * among the new siblings with the moved page left out). A stale list only makes this too small or
 * too large, and the server clamps it.
 */
// spec: docs/specs/09-decision-log.md section RD-067 (moving: index among the new siblings); docs/specs/08-api-surface.md section 3 (POST /pages/{id}/move: { parentId, index })
export function appendIndex(pages: readonly PageNode[], pageId: string, parentId: string | null): number {
  const forest = buildTree(pages);
  let siblings: readonly TreeNode<PageNode>[] = forest;
  if (parentId !== null) {
    const stack = [...forest];
    let found: TreeNode<PageNode> | undefined;
    while (stack.length > 0 && found === undefined) {
      const node = stack.pop() as TreeNode<PageNode>;
      if (node.page.id === parentId) found = node;
      else stack.push(...node.children);
    }
    siblings = found?.children ?? [];
  }
  return siblings.filter((node) => node.page.id !== pageId).length;
}

/** The body of `POST /pages/{id}/move`, exactly as the API takes it (moveBody: { parentId, index }). */
export interface MoveBody {
  readonly parentId: string | null;
  readonly index: number;
}

/** The request that moves `pageId` under `parentId`, last among its new siblings. */
export function moveBodyFor(pages: readonly PageNode[], pageId: string, parentId: string | null): MoveBody {
  return { parentId, index: appendIndex(pages, pageId, parentId) };
}
