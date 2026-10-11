"use client";

// The page tree (10 §3.2): the expanded sidebar's PAGE TREE and, roomier, the space overview
// (10 §11). One component, reading the space's shared PageTreeStore.
//
//   ▾ Specifications          open, with children
//       • Page Heading        a page without children; the current page is bold
//       › Test session 1a     closed, with children
//
// Structure (WAI-ARIA APG tree view): <ul role=tree> of <li role=treeitem> rows, children in a
// nested <ul role=group>. The treeitem takes focus (one roving tab stop) and is named by its title
// link; the chevron is a mouse affordance for what → and ← do. Each row also holds a "+" that
// creates a child page (RD-056), for viewers who can edit the space; the "+" of the focused row
// is the one in the Tab order.
//
// Drag to reorder and re-parent (10 §3.2), for viewers who can edit: drop before or after a row,
// or onto it (as its last child). A drop onto the dragged page or one of its descendants is
// refused before anything is sent and shows no drop affordance (RD-056). Moves are optimistic,
// rolled back with an alert when the server refuses, and the tree is refetched either way
// (PageTreeStore.move). Alt+↑/↓ and Alt+Shift+→/← are the keyboard route to the same moves.
//
// Rendering cost: rows are memoised and each reads only its own slice of state, so typing,
// hovering (CSS only) and dragging re-render the rows that change, never the whole list.
// spec: docs/specs/10-ui-reference.md sections 3.2 (PAGE TREE: drag to reorder and re-parent; current page in bold) and 11; RD-056, RD-059, RD-070, RD-072
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { t } from "@/copy";
import { BulletIcon, ChevronDownIcon, ChevronRightIcon, CrossIcon, PlusIcon } from "./icons";
import { treeKeyAction } from "./keyboard";
import { createFailureMessage, moveFailureMessage, movedAnnouncement } from "./messages";
import { moveForDrop, pageHref, positionOf, zoneFor, type MoveTarget } from "./model";
import { usePageTreeStore } from "./provider";
import { dropLineClassName, rowClassName, rowIndent, titleClassName, type PageTreeVariant } from "./row-style";
import type { PageTreeStore } from "./store";
import { TreeView } from "./view-state";

export type { PageTreeVariant } from "./row-style";

/** The drag payload type: a drag that did not start in a page tree carries none and is ignored. */
export const PAGE_DRAG_TYPE = "application/x-reqforge-page";

export interface PageTreeProps {
  readonly variant: PageTreeVariant;
  /** The tree's accessible name, from the copy deck. */
  readonly label: string;
  /** `?highlight=` on the space overview (10 §11, RD-059). Remount (key) the tree when it changes. */
  readonly highlightId?: string | null;
}

interface ItemEnv {
  readonly store: PageTreeStore;
  readonly view: TreeView;
  readonly variant: PageTreeVariant;
  readonly idPrefix: string;
  readonly onToggle: (id: string) => void;
  readonly onCreate: (parentId: string | null) => void;
  readonly onDragStart: (id: string, event: DragEvent<HTMLElement>) => void;
  readonly onDragOver: (id: string, event: DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (id: string, event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (id: string, event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
}

const ItemEnvContext = createContext<ItemEnv | null>(null);

function useItemEnv(): ItemEnv {
  const env = useContext(ItemEnvContext);
  if (env === null) throw new Error("TreeItem rendered outside PageTree");
  return env;
}

/** The DOM id of a row's treeitem; page ids are `[A-Za-z0-9_-]` (RD-072), so this is a valid id. */
const itemDomId = (prefix: string, id: string) => `${prefix}-item-${id}`;
const titleDomId = (prefix: string, id: string) => `${prefix}-title-${id}`;

/** Where in the row the pointer is, for the drop zone (top quarter: before; bottom quarter: after). */
function zoneOf(event: DragEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return zoneFor(event.clientY - rect.top, rect.height);
}

interface TreeItemProps {
  readonly id: string;
  readonly level: number;
  readonly posinset: number;
  readonly setsize: number;
}

// The inner function must not be named `TreeItem`: a named function expression's own name would
// shadow the memoised component inside its body, and nested rows would render un-memoised.
const TreeItem = memo(function TreeRow({ id, level, posinset, setsize }: TreeItemProps) {
  const env = useItemEnv();
  const { store, view, variant, idPrefix } = env;
  const node = useSyncExternalStore(store.subscribe, () => store.getNode(id), () => store.getNode(id));
  const open = useSyncExternalStore(view.subscribeAll, () => view.isOpen(id), () => view.isOpen(id));
  const current = useSyncExternalStore(store.subscribe, () => store.getCurrentId() === id, () => store.getCurrentId() === id);
  const tabStop = useSyncExternalStore(view.subscribeAll, () => view.getTabStop() === id, () => view.getTabStop() === id);
  const drop = useSyncExternalStore(view.subscribe, () => view.dropZoneFor(id), () => view.dropZoneFor(id));
  const canEdit = useSyncExternalStore(store.subscribe, () => store.getCanEdit(), () => store.getCanEdit());
  const creating = useSyncExternalStore(store.subscribe, () => store.getCreatingParent() === id, () => store.getCreatingParent() === id);
  const focusTick = useSyncExternalStore(view.subscribe, () => view.focusTickFor(id), () => 0);
  const ref = useRef<HTMLLIElement>(null);

  // A keyboard move, or its rollback, re-mounts the row under another parent: focus follows the
  // page — unless the reader has meanwhile put focus somewhere outside the tree.
  useEffect(() => {
    const element = ref.current;
    if (element === null || focusTick === 0 || view.focusTickFor(id) !== focusTick) return;
    const active = document.activeElement;
    const tree = element.closest('[role="tree"]');
    if (active === null || active === document.body || tree?.contains(active) === true) element.focus();
  }, [view, id, focusTick]);

  // The highlighted row scrolls itself into view once, on load (10 §11).
  useEffect(() => {
    const element = ref.current;
    if (element !== null && view.takeScrollRequest(id) && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center" });
    }
  });

  if (node === undefined) return null;
  const hasChildren = node.childIds.length > 0;
  const highlighted = view.isHighlighted(id);
  const titleId = titleDomId(idPrefix, id);
  const ariaCurrent = current ? ("page" as const) : highlighted ? ("true" as const) : undefined;

  return (
    <li
      ref={ref}
      role="treeitem"
      id={itemDomId(idPrefix, id)}
      data-tree-id={id}
      aria-labelledby={titleId}
      aria-level={level}
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-expanded={hasChildren ? open : undefined}
      // Single-select tree (APG): only the selected node carries aria-selected.
      aria-selected={ariaCurrent !== undefined ? true : undefined}
      aria-current={ariaCurrent}
      tabIndex={tabStop ? 0 : -1}
      className="list-none outline-none [&:focus-visible>div]:ring-2 [&:focus-visible>div]:ring-[#4c9aff]"
    >
      <div
        className={rowClassName({ variant, highlighted, drop })}
        style={{ paddingLeft: rowIndent(variant, level) }}
        data-drop={drop ?? undefined}
        draggable={canEdit ? true : undefined}
        onDragStart={canEdit ? (event) => env.onDragStart(id, event) : undefined}
        onDragOver={canEdit ? (event) => env.onDragOver(id, event) : undefined}
        onDragLeave={canEdit ? (event) => env.onDragLeave(id, event) : undefined}
        onDrop={canEdit ? (event) => env.onDrop(id, event) : undefined}
        onDragEnd={canEdit ? env.onDragEnd : undefined}
      >
        {drop === "before" || drop === "after" ? <span aria-hidden="true" data-drop-line={drop} className={dropLineClassName(drop)} /> : null}
        <span
          aria-hidden="true"
          data-toggle={hasChildren ? "" : undefined}
          className={`flex h-6 w-5 shrink-0 items-center justify-center text-slate-500 ${hasChildren ? "cursor-pointer hover:text-slate-900" : ""}`}
          onClick={hasChildren ? () => env.onToggle(id) : undefined}
        >
          {hasChildren ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : <BulletIcon size={10} />}
        </span>
        <Link
          id={titleId}
          href={pageHref(store.spaceKey, id)}
          prefetch={false}
          tabIndex={-1}
          title={variant === "sidebar" ? node.title : undefined}
          className={titleClassName(variant, current)}
        >
          {node.title}
        </Link>
        {canEdit ? (
          <button
            type="button"
            tabIndex={tabStop ? 0 : -1}
            aria-label={t("tree.createChild", { title: node.title })}
            title={t("tree.createChild", { title: node.title })}
            aria-disabled={creating || undefined}
            aria-busy={creating || undefined}
            data-create-child={id}
            onClick={() => env.onCreate(id)}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-white hover:text-slate-900 aria-disabled:cursor-progress ${
              variant === "sidebar"
                ? "opacity-0 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 [div:hover>&]:opacity-100 [li:focus-visible>div>&]:opacity-100"
                : ""
            }`}
          >
            <PlusIcon />
          </button>
        ) : null}
      </div>
      {hasChildren && open ? (
        <ul role="group" className="m-0 list-none p-0">
          {node.childIds.map((childId, index) => (
            <TreeItem key={childId} id={childId} level={level + 1} posinset={index + 1} setsize={node.childIds.length} />
          ))}
        </ul>
      ) : null}
    </li>
  );
});

const createButtonClass =
  "inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 aria-disabled:cursor-progress aria-disabled:opacity-70";

// spec: docs/specs/10-ui-reference.md sections 3.2 and 11; RD-056 (a child is created from the tree or the space overview)
export function PageTree({ variant, label, highlightId = null }: PageTreeProps) {
  const store = usePageTreeStore();
  const router = useRouter();
  const [view] = useState(() => new TreeView(store, highlightId));
  const idPrefix = `rf-tree${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const helpId = `${idPrefix}-help`;
  const status = useSyncExternalStore(store.subscribe, () => store.getStatus(), () => store.getStatus());
  const rootIds = useSyncExternalStore(store.subscribe, () => store.getRootIds(), () => store.getRootIds());
  const canEdit = useSyncExternalStore(store.subscribe, () => store.getCanEdit(), () => store.getCanEdit());
  const creatingRoot = useSyncExternalStore(store.subscribe, () => store.getCreatingParent() === null, () => store.getCreatingParent() === null);
  const [alert, setAlert] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => store.retain(), [store]);
  useLayoutEffect(() => view.attach(), [view]);

  const focusItem = useCallback(
    (id: string) => {
      view.setActive(id);
      document.getElementById(itemDomId(idPrefix, id))?.focus();
    },
    [view, idPrefix],
  );

  const create = useCallback(
    (parentId: string | null) => {
      void store.createChild(parentId).then((outcome) => {
        if (outcome.ok) router.push(outcome.href);
        else if (!outcome.busy) setAlert(createFailureMessage(outcome.code, parentId));
      });
    },
    [store, router],
  );

  /** Shows the move at once and sends it; a refusal is rolled back by the store and explained here. */
  const runMove = useCallback(
    (id: string, target: MoveTarget, source: "drag" | "key") => {
      // Keep the moved page in sight: a closed new parent opens.
      if (target.parentId !== null && !view.isOpen(target.parentId)) store.expand([target.parentId]);
      if (source === "key") view.requestFocus(id);
      setAlert(null);
      void store.move(id, target).then((outcome) => {
        if (outcome.ok) {
          const node = store.getNode(id);
          const where = positionOf(store.getModel(), id);
          if (source === "key" && node !== undefined && where !== null) setAnnouncement(movedAnnouncement(node.title, where));
          return;
        }
        if (outcome.cancelled) return;
        if (source === "key" && store.getNode(id) !== undefined) view.requestFocus(id);
        setAlert(moveFailureMessage(outcome.code));
      });
    },
    [store, view],
  );

  const env = useMemo<ItemEnv>(
    () => ({
      store,
      view,
      variant,
      idPrefix,
      onToggle: (id) => {
        if (view.isOpen(id)) view.collapse(id);
        else store.expand([id]);
      },
      onCreate: create,
      onDragStart: (id, event) => {
        if (!store.getCanEdit()) return;
        // A row's group of children is a sibling of the row, so a drag bubbles through one row only.
        view.startDrag(id);
        const data = event.dataTransfer;
        if (data) {
          data.effectAllowed = "move";
          try {
            data.setData(PAGE_DRAG_TYPE, id);
          } catch {
            // Some browsers refuse custom types; the drag id is kept in the view anyway.
          }
        }
      },
      onDragOver: (id, event) => {
        const dragId = view.dragId;
        if (dragId === null) return;
        const zone = zoneOf(event);
        const move = moveForDrop(store.getModel(), dragId, id, zone, view.isOpen(id));
        if (move === null) {
          // Onto itself or a descendant (RD-056), or nowhere new: no drop affordance at all.
          view.clearDropFor(id);
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        view.setDrop({ id, zone });
      },
      onDragLeave: (id, event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        view.clearDropFor(id);
      },
      onDrop: (id, event) => {
        const dragId = view.dragId;
        if (dragId === null) return;
        event.preventDefault();
        const move = moveForDrop(store.getModel(), dragId, id, zoneOf(event), view.isOpen(id));
        view.endDrag();
        if (move !== null) runMove(dragId, move, "drag");
      },
      onDragEnd: () => view.endDrag(),
    }),
    [store, view, variant, idPrefix, create, runMove],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const element = event.target;
    if (!(element instanceof HTMLElement) || element.getAttribute("role") !== "treeitem") return;
    const id = element.dataset.treeId;
    if (id === undefined) return;
    const action = treeKeyAction(event, store.getModel(), view.isOpen, id, store.getCanEdit());
    if (action === null) return;
    event.preventDefault();
    event.stopPropagation();
    switch (action.kind) {
      case "none":
        return;
      case "focus":
        focusItem(action.id);
        return;
      case "expand":
        store.expand([action.id]);
        return;
      case "collapse":
        view.collapse(action.id);
        return;
      case "open":
        router.push(pageHref(store.spaceKey, action.id));
        return;
      case "move":
        runMove(action.id, action.target, "key");
        return;
    }
  };

  const onFocus = (event: FocusEvent<HTMLUListElement>) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="treeitem"]') : null;
    const id = item?.dataset.treeId;
    if (id !== undefined) view.setActive(id);
  };

  const createRootButton = canEdit ? (
    <button
      type="button"
      className={createButtonClass}
      aria-disabled={creatingRoot || undefined}
      aria-busy={creatingRoot || undefined}
      data-create-root=""
      onClick={() => create(null)}
    >
      <PlusIcon />
      <span>{t("tree.createPage")}</span>
    </button>
  ) : null;

  let body: ReactNode;
  if (rootIds.length > 0) {
    body = (
      <ItemEnvContext.Provider value={env}>
        <ul
          role="tree"
          aria-label={label}
          aria-describedby={canEdit ? helpId : undefined}
          className={`m-0 list-none p-0 ${variant === "overview" ? "max-w-3xl" : ""}`}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
        >
          {rootIds.map((id, index) => (
            <TreeItem key={id} id={id} level={1} posinset={index + 1} setsize={rootIds.length} />
          ))}
        </ul>
        {canEdit ? (
          <p id={helpId} className="sr-only">
            {t("tree.keyboardHelp")}
          </p>
        ) : null}
      </ItemEnvContext.Provider>
    );
  } else if (status === "loading") {
    body = <p className="text-sm text-slate-500">{t("tree.loading")}</p>;
  } else if (status === "error") {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-slate-700">
        <p>{t("tree.error")}</p>
        <button type="button" className={createButtonClass} onClick={() => void store.refresh()}>
          {t("tree.retry")}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className={variant === "sidebar" ? "text-sm text-slate-500" : "text-slate-600"}>
          {variant === "sidebar" ? t("sidebar.pageTree.empty") : t("space.empty")}
        </p>
        {createRootButton}
      </div>
    );
  }

  return (
    <div data-page-tree={variant}>
      {variant === "overview" && rootIds.length > 0 && createRootButton !== null ? <div className="mb-4">{createRootButton}</div> : null}
      {alert !== null ? (
        <div role="alert" className="mb-2 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          <span className="min-w-0 flex-1">{alert}</span>
          <button
            type="button"
            aria-label={t("tree.alert.dismiss")}
            title={t("tree.alert.dismiss")}
            className="rounded p-0.5 text-red-700 hover:bg-red-100"
            onClick={() => setAlert(null)}
          >
            <CrossIcon />
          </button>
        </div>
      ) : null}
      {body}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
