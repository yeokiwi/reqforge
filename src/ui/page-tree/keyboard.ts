// The page tree's keyboard, as a pure function of the key, the tree and which rows are open.
//
//   ↓ / ↑         next / previous visible page            (WAI-ARIA APG tree pattern)
//   →             open a closed page; on an open one, go to its first child
//   ←             close an open page; on a closed or childless one, go to its parent
//   Home / End    first / last visible page
//   Enter         open the page (the treeitem's link)
//   Alt+↑ / Alt+↓            move the page among its siblings        (the keyboard route for
//   Alt+Shift+→              make it the last child of the page above  "drag to reorder and
//   Alt+Shift+←              move it up a level, after its parent       re-parent", 10 §3.2)
//
// The move keys only exist for viewers who can edit the space; for everyone else they are left
// to the browser (Alt+← is "back" in most browsers, so it is never claimed without Shift).
// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE: drag to reorder and re-parent); RD-056
import { moveForKey, visibleIds, type MoveTarget, type TreeModel } from "./model";

export interface KeyInput {
  readonly key: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export type TreeKeyAction =
  /** A key the tree owns that does nothing here (an arrow at the edge): swallow it, so the page does not scroll. */
  | { readonly kind: "none" }
  | { readonly kind: "focus"; readonly id: string }
  | { readonly kind: "expand"; readonly id: string }
  | { readonly kind: "collapse"; readonly id: string }
  | { readonly kind: "open"; readonly id: string }
  | { readonly kind: "move"; readonly id: string; readonly target: MoveTarget };

const NONE: TreeKeyAction = { kind: "none" };

/** The move a key asks for, or null when the key is not a move key. */
function moveKind(input: KeyInput): "up" | "down" | "indent" | "outdent" | null {
  if (!input.altKey || input.ctrlKey || input.metaKey) return null;
  if (!input.shiftKey && input.key === "ArrowUp") return "up";
  if (!input.shiftKey && input.key === "ArrowDown") return "down";
  if (input.shiftKey && input.key === "ArrowRight") return "indent";
  if (input.shiftKey && input.key === "ArrowLeft") return "outdent";
  return null;
}

/**
 * What a key press on the treeitem `id` does, or null when the tree does not handle it (the
 * caller then leaves the event alone).
 */
// spec: docs/specs/10-ui-reference.md section 3.2; WAI-ARIA APG tree view pattern (keyboard interaction)
export function treeKeyAction(
  input: KeyInput,
  model: TreeModel,
  isOpen: (id: string) => boolean,
  id: string,
  canEdit: boolean,
): TreeKeyAction | null {
  const node = model.nodes.get(id);
  if (!node) return null;

  const kind = moveKind(input);
  if (kind !== null) {
    if (!canEdit) return null;
    const target = moveForKey(model, id, kind);
    return target === null ? NONE : { kind: "move", id, target };
  }
  if (input.altKey || input.ctrlKey || input.metaKey || input.shiftKey) return null;

  const hasChildren = node.childIds.length > 0;
  switch (input.key) {
    case "Enter":
      return { kind: "open", id };
    case "ArrowDown":
    case "ArrowUp": {
      const rows = visibleIds(model, isOpen);
      const at = rows.indexOf(id);
      const next = at < 0 ? undefined : rows[input.key === "ArrowDown" ? at + 1 : at - 1];
      return next === undefined ? NONE : { kind: "focus", id: next };
    }
    case "Home":
    case "End": {
      const rows = visibleIds(model, isOpen);
      const edge = input.key === "Home" ? rows[0] : rows[rows.length - 1];
      return edge === undefined || edge === id ? NONE : { kind: "focus", id: edge };
    }
    case "ArrowRight": {
      if (!hasChildren) return NONE;
      if (!isOpen(id)) return { kind: "expand", id };
      const first = node.childIds[0];
      return first === undefined ? NONE : { kind: "focus", id: first };
    }
    case "ArrowLeft": {
      if (hasChildren && isOpen(id)) return { kind: "collapse", id };
      return node.parentId === null ? NONE : { kind: "focus", id: node.parentId };
    }
    default:
      return null;
  }
}
