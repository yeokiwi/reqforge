// What one drawn tree (the sidebar's, or the space overview's) keeps for itself, apart from the
// shared PageTreeStore: the roving tab stop, the drop indicator of a drag in progress, the page
// highlighted by `?highlight=` and the focus/scroll requests rows act on after they render.
//
// Every value is read per row through a selector (`isOpen(id)`, `dropZoneFor(id)`,
// `getTabStop() === id`), so a change re-renders only the rows whose answer changed: a drag
// moving across a 2,000-page tree re-renders two rows per step, not the list.
// spec: docs/specs/10-ui-reference.md sections 3.2 (PAGE TREE) and 11 (?highlight= for View in Hierarchy); RD-059
import { ancestorIds, visibleRepresentative, type DropZone } from "./model";
import type { PageTreeStore } from "./store";

const EMPTY: ReadonlySet<string> = new Set();

export class TreeView {
  private readonly store: PageTreeStore;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private activeId: string | null = null;
  private drop: { readonly id: string; readonly zone: DropZone } | null = null;
  /** The page being dragged, while a drag that started in this tree is in progress. */
  private dragging: string | null = null;
  /**
   * The highlight's ancestors, drawn open from the very first render (so the server's HTML
   * already shows the path) until `commitHighlight` writes them into the shared store.
   */
  private forced: ReadonlySet<string>;
  private highlightPending: boolean;
  /** "Page `id` should have focus", numbered so a repeated request is a new value for its row. */
  private focusRequest: { readonly id: string; readonly tick: number } | null = null;
  private focusTicks = 0;
  private scrollRequest: string | null;
  private tabCache: { readonly key: string; readonly value: string | null } | null = null;
  /** `?highlight=`: shown only when it names a page in the tree; anything else is ignored. */
  readonly highlightId: string | null;

  constructor(store: PageTreeStore, highlightId: string | null = null) {
    this.store = store;
    this.highlightId = highlightId;
    const model = store.getModel();
    const known = highlightId !== null && model.nodes.has(highlightId);
    this.forced = known ? new Set(ancestorIds(model, highlightId)) : EMPTY;
    this.highlightPending = highlightId !== null;
    this.scrollRequest = highlightId;
  }

  // ---- subscription ------------------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Both this view and the shared store: for selectors that read both. */
  readonly subscribeAll = (listener: () => void): (() => void) => {
    const a = this.store.subscribe(listener);
    const b = this.subscribe(listener);
    return () => {
      a();
      b();
    };
  };

  private emit(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  /** Starts following the store (for a highlight that arrives with later data). Returns the stop. */
  attach(): () => void {
    this.commitHighlight();
    return this.store.subscribe(() => this.commitHighlight());
  }

  // ---- open / closed -----------------------------------------------------------------------

  readonly isOpen = (id: string): boolean => this.store.isExpanded(id) || this.forced.has(id);

  /**
   * Opens the path to the highlighted page in the shared store, once, as soon as that page is in
   * the tree. An unknown or invisible id is simply ignored (10 §11).
   */
  // spec: docs/specs/10-ui-reference.md section 11 (?highlight= expands the path to the page); RD-059
  commitHighlight(): void {
    if (!this.highlightPending || this.highlightId === null) return;
    const model = this.store.getModel();
    if (!model.nodes.has(this.highlightId)) return;
    this.highlightPending = false;
    const path = ancestorIds(model, this.highlightId);
    this.store.expand(path);
    if (this.forced.size > 0) {
      this.forced = EMPTY;
      this.emit();
    }
  }

  collapse(id: string): void {
    if (this.forced.has(id)) {
      const next = new Set(this.forced);
      next.delete(id);
      this.forced = next;
      this.emit();
    }
    this.store.collapse(id);
  }

  /** Whether the page `?highlight=` names is this one (and it is in the tree). */
  isHighlighted(id: string): boolean {
    return id === this.highlightId && this.store.getModel().nodes.has(id);
  }

  // ---- the roving tab stop -----------------------------------------------------------------

  setActive(id: string): void {
    // Focus went elsewhere in the tree: an older request no longer applies.
    if (this.focusRequest !== null && this.focusRequest.id !== id) this.focusRequest = null;
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit();
  }

  /**
   * The one row in the Tab order: the last focused page, else the highlighted one, else the
   * current page, else the first; whichever it is, the closest row actually drawn (a page inside
   * a closed parent is represented by that parent).
   */
  // spec: WAI-ARIA APG tree view pattern (roving tabindex: one focusable treeitem)
  getTabStop(): string | null {
    const key = `${this.store.getVersion()}:${this.version}`;
    if (this.tabCache?.key === key) return this.tabCache.value;
    const model = this.store.getModel();
    let value: string | null = null;
    for (const candidate of [this.activeId, this.highlightId, this.store.getCurrentId()]) {
      if (candidate === null) continue;
      value = visibleRepresentative(model, candidate, this.isOpen);
      if (value !== null) break;
    }
    value ??= model.rootIds[0] ?? null;
    this.tabCache = { key, value };
    return value;
  }

  // ---- focus and scroll requests (acted on by the row once it has rendered) ---------------

  /**
   * Asks the row of `id` to take focus — the row as it is now, or the one mounted for it after a
   * move or a rollback re-parents it. The request stands until focus goes to another row.
   */
  requestFocus(id: string): void {
    this.focusTicks += 1;
    this.focusRequest = { id, tick: this.focusTicks };
    if (this.activeId !== id) this.activeId = id;
    this.emit();
  }

  /** The standing focus request's number if it is for `id`, else 0. */
  focusTickFor(id: string): number {
    return this.focusRequest !== null && this.focusRequest.id === id ? this.focusRequest.tick : 0;
  }

  /** True once, for the highlighted row: it scrolls itself into view on load. */
  takeScrollRequest(id: string): boolean {
    if (this.scrollRequest !== id) return false;
    this.scrollRequest = null;
    return true;
  }

  // ---- drag and drop -----------------------------------------------------------------------

  get dragId(): string | null {
    return this.dragging;
  }

  startDrag(id: string): void {
    this.dragging = id;
    this.setDrop(null);
  }

  endDrag(): void {
    this.dragging = null;
    this.setDrop(null);
  }

  dropZoneFor(id: string): DropZone | null {
    return this.drop !== null && this.drop.id === id ? this.drop.zone : null;
  }

  /** Shows the drop indicator on one row (or none). Emits only when it changes. */
  setDrop(target: { readonly id: string; readonly zone: DropZone } | null): void {
    if (target === null ? this.drop === null : this.drop?.id === target.id && this.drop.zone === target.zone) return;
    this.drop = target;
    this.emit();
  }

  /** Clears the indicator if it is on `id` (the pointer left that row). */
  clearDropFor(id: string): void {
    if (this.drop?.id === id) this.setDrop(null);
  }
}
