// The page tree's client-side state for one space: the pages, which ones are open, which one is
// current, and the moves still on their way to the server. One store per space frame, shared by
// the sidebar's tree and the space overview's, so a move made in one shows in the other.
//
// Freshness. A Next layout is not re-rendered by client-side navigation, so the pages it passed
// down go stale after a publish, rename, move, delete or create elsewhere. The store therefore
//   - starts from the server's pages (first paint is right, and the links work without JS),
//   - refetches GET /pages on every navigation, when the tab becomes visible again, and after
//     each of its own mutations,
//   - is offered the server's pages again whenever the layout or the overview re-render
//     (router.refresh, a server action, navigating to the overview) — but when such a render
//     was made is unknown, so it never replaces what the store fetched or confirmed itself; a
//     render that differs from the tree shown is settled by a GET issued after it (`adopt`),
// and applies a response only if nothing newer has been applied since its request was issued
// (`issued` / `applied` sequence numbers), so a slow old response never overwrites a newer one.
//
// Moves are optimistic. The display is the server's pages with the pending moves replayed on
// top (`planMove`, the server's own rule), so a refetch landing mid-flight cannot make the
// moved page jump back. Moves are sent one at a time, in order; a refusal rolls back that move
// and every move queued after it, and the tree is refetched either way.
// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE: drag to reorder and re-parent); docs/specs/08-api-surface.md section 3; RD-056, RD-072
import type { PageSummary } from "@/domain/documents";
import { ApiError, callApi, spaceUrls, type FetchLike } from "@/ui/api-client";
import { writeExpanded, readExpanded, type StorageSource } from "./expansion-storage";
import {
  ancestorIds,
  applyMove,
  buildModel,
  editHref,
  parsePages,
  samePages,
  toPageSummary,
  type MoveTarget,
  type TreeModel,
  type TreeNodeView,
} from "./model";

export type TreeStatus = "loading" | "ready" | "error";

/** What the server render hands the client: the pages, or the fact that loading them failed. */
export type InitialTree =
  | { readonly status: "ready"; readonly pages: readonly PageSummary[] }
  | { readonly status: "error" };

export interface PageTreeStoreOptions {
  /** The space's canonical key (upper case). */
  readonly spaceKey: string;
  /** Space EDIT (07 §2.4). The server checks again; this only decides what is offered. */
  readonly canEdit: boolean;
  /** null: nothing loaded yet; the first consumer to mount fetches. */
  readonly initial: InitialTree | null;
  /** The page the browser is on, if any; its ancestors start open. */
  readonly currentId?: string | null;
  readonly fetchImpl?: FetchLike;
}

export type MoveOutcome =
  | { readonly ok: true }
  /** `cancelled`: an earlier queued move was refused, so this one was never sent. */
  | { readonly ok: false; readonly code: string; readonly cancelled: boolean };

export type CreateOutcome =
  | { readonly ok: true; readonly page: PageSummary; readonly href: string }
  /** `busy`: another create is in flight (or just succeeded and is navigating); nothing was sent. */
  | { readonly ok: false; readonly code: string; readonly busy: boolean };

interface PendingMove {
  readonly id: string;
  readonly target: MoveTarget;
  cancelled: boolean;
}

/** After a successful create the lock is held until navigation (or this long), so a double click creates one page. */
export const CREATE_LOCK_MS = 5000;

function codeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : "UNEXPECTED_RESPONSE";
}

export class PageTreeStore {
  readonly spaceKey: string;
  private canEditValue: boolean;
  private readonly fetchImpl: FetchLike | undefined;
  private base: readonly PageSummary[] | null;
  private status: TreeStatus;
  private pending: PendingMove[] = [];
  private model: TreeModel;
  private readonly expanded = new Set<string>();
  private currentId: string | null;
  private revealCurrentPending: boolean;
  /**
   * Sequence numbers: the last request issued, and the newest state applied — a GET's answer or
   * a confirmed mutation; 0 while the store shows nothing but server renders.
   */
  private issued = 0;
  private applied = 0;
  /** The sequence number of the last GET issued. */
  private lastFetch = 0;
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  /** The parent a create is running under (null: the root), or undefined when none is. */
  private creatingParent: string | null | undefined = undefined;
  private createLockTimer: ReturnType<typeof setTimeout> | null = null;
  private storage: StorageSource | null = null;
  private consumers = 0;
  private stale: boolean;
  private version = 0;

  constructor(options: PageTreeStoreOptions) {
    this.spaceKey = options.spaceKey;
    this.canEditValue = options.canEdit;
    this.fetchImpl = options.fetchImpl;
    const initial = options.initial;
    this.base = initial?.status === "ready" ? initial.pages : null;
    this.status = initial === null ? "loading" : initial.status;
    this.stale = initial === null;
    this.model = buildModel(this.base ?? []);
    this.currentId = options.currentId ?? null;
    this.revealCurrentPending = this.currentId !== null;
    this.revealCurrent();
  }

  // ---- reading (stable values, for useSyncExternalStore) ------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion(): number {
    return this.version;
  }
  getModel(): TreeModel {
    return this.model;
  }
  getNode(id: string): TreeNodeView | undefined {
    return this.model.nodes.get(id);
  }
  getRootIds(): readonly string[] {
    return this.model.rootIds;
  }
  getStatus(): TreeStatus {
    return this.status;
  }
  isExpanded(id: string): boolean {
    return this.expanded.has(id);
  }
  getCurrentId(): string | null {
    return this.currentId;
  }
  getCanEdit(): boolean {
    return this.canEditValue;
  }
  /** Moves not yet confirmed by the server. */
  hasPendingMoves(): boolean {
    return this.pending.length > 0;
  }

  private emit(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private recompute(): void {
    let display = this.base ?? [];
    for (const move of this.pending) display = applyMove(display, move.id, move.target);
    this.model = buildModel(display, this.model);
  }

  private setBase(pages: readonly PageSummary[]): void {
    const changed = this.base === null || !samePages(this.base, pages);
    if (!changed && this.status === "ready") return;
    if (changed) this.base = pages;
    this.status = "ready";
    this.recompute();
    this.revealCurrent();
    this.emit();
  }

  // ---- freshness -----------------------------------------------------------------------------

  /**
   * Refetches the whole tree. The answer is applied only if nothing newer has been applied
   * since this request was issued; a failure keeps whatever is shown (the error state only
   * appears when there is nothing to show).
   */
  // spec: docs/specs/08-api-surface.md section 3 (GET /pages); RD-072 (a bare PageSummary[])
  async refresh(): Promise<void> {
    const seq = ++this.issued;
    this.lastFetch = seq;
    if (this.base === null && this.status !== "loading") {
      this.status = "loading";
      this.emit();
    }
    let pages: PageSummary[] | null;
    try {
      pages = parsePages(await callApi("GET", spaceUrls(this.spaceKey).pages, undefined, this.fetchImpl));
    } catch {
      pages = null;
    }
    if (seq <= this.applied) return; // older than what is already on screen
    if (pages === null) {
      if (this.base === null && this.status !== "error") {
        this.status = "error";
        this.emit();
      }
      return;
    }
    this.applied = seq;
    this.setBase(pages);
  }

  /**
   * Pages from a server render: the layout re-rendered (router.refresh(), a server action) or the
   * overview rendered. When that render was made is unknown — Back/Forward replays a payload
   * cached before this tab's latest moves, and a server action's render can read the tree before
   * a move commits yet arrive after the move is confirmed — so it never replaces anything this
   * store fetched or confirmed itself (`applied > 0`), and it never outranks a GET in flight.
   * It is shown at once only while the store holds nothing but server renders. Either way, a
   * render that differs from the tree shown is settled by a GET issued after it.
   */
  // spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE: drag to reorder and re-parent); docs/specs/08-api-surface.md section 3 (GET /pages); RD-056
  adopt(pages: readonly PageSummary[]): void {
    if (this.base !== null && samePages(this.base, pages)) return; // nothing it could tell us
    if (this.applied === 0) {
      this.stale = false;
      this.setBase(pages);
    }
    this.checkSoon();
  }

  /**
   * Refetches once the current turn is over, unless a GET has been issued by then anyway: a
   * navigation's refetch, issued by the provider's effect right after the overview's `adopt`,
   * is newer than the render and settles it just as well.
   */
  private checkSoon(): void {
    const mark = this.issued;
    queueMicrotask(() => {
      if (this.lastFetch <= mark) this.invalidate();
    });
  }

  /** The layout re-rendered (router.refresh, a server action) and passed new initial data (see `adopt`). */
  setInitial(initial: InitialTree): void {
    if (initial.status === "ready") {
      this.adopt(initial.pages);
    } else if (this.base === null && this.status !== "error") {
      this.status = "error";
      this.emit();
    }
  }

  /** A tree is on screen. Returns its release. The first consumer fetches if the data is stale. */
  retain(): () => void {
    this.consumers += 1;
    if (this.consumers === 1 && this.stale) {
      this.stale = false;
      void this.refresh();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumers -= 1;
    };
  }

  /** Something may have changed elsewhere (navigation, the tab shown again): refetch if anyone is looking. */
  invalidate(): void {
    if (this.consumers > 0) void this.refresh();
    else this.stale = true;
  }

  /** The browser moved to another URL inside the frame. */
  navigated(currentId: string | null): void {
    this.releaseCreateLock();
    this.setCurrent(currentId);
    this.invalidate();
  }

  setCanEdit(canEdit: boolean): void {
    if (canEdit === this.canEditValue) return;
    this.canEditValue = canEdit;
    this.emit();
  }

  // ---- open / closed -------------------------------------------------------------------------

  /** The page being viewed; its ancestors open once, as soon as it is in the tree (10 §3.2). */
  // spec: docs/specs/10-ui-reference.md section 3.2 (current page in bold, inside its open parents)
  setCurrent(id: string | null): void {
    if (id === this.currentId) return;
    this.currentId = id;
    this.revealCurrentPending = id !== null;
    this.revealCurrent();
    this.emit();
  }

  private revealCurrent(): void {
    if (!this.revealCurrentPending || this.currentId === null || !this.model.nodes.has(this.currentId)) return;
    this.revealCurrentPending = false;
    this.addExpanded(ancestorIds(this.model, this.currentId));
  }

  private addExpanded(ids: readonly string[]): boolean {
    let changed = false;
    for (const id of ids) {
      if (this.expanded.has(id)) continue;
      this.expanded.add(id);
      changed = true;
    }
    if (changed) this.persist();
    return changed;
  }

  toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.persist();
    this.emit();
  }

  expand(ids: readonly string[]): void {
    if (this.addExpanded(ids)) this.emit();
  }

  collapse(id: string): void {
    if (!this.expanded.delete(id)) return;
    this.persist();
    this.emit();
  }

  /** Remembered open pages (localStorage) are merged in; from now on changes are remembered. */
  attachStorage(source: StorageSource): void {
    this.storage = source;
    const remembered = readExpanded(source, this.spaceKey);
    let changed = false;
    for (const id of remembered) {
      if (this.expanded.has(id)) continue;
      this.expanded.add(id);
      changed = true;
    }
    if (changed) this.emit();
  }

  private persist(): void {
    if (this.storage === null) return; // not read yet: writing now would overwrite what is stored
    const ids = this.status === "ready" ? [...this.expanded].filter((id) => this.model.nodes.has(id)) : [...this.expanded];
    writeExpanded(this.storage, this.spaceKey, ids);
  }

  // ---- moving (POST /pages/{id}/move) ---------------------------------------------------------

  /**
   * Shows the move at once and sends it after any moves already queued. Resolves when the
   * server has answered; on a refusal the display has already been rolled back.
   */
  // spec: docs/specs/08-api-surface.md section 3 (POST /pages/{id}/move { parentId, index }); RD-056
  move(id: string, target: MoveTarget): Promise<MoveOutcome> {
    if (!this.canEditValue) return Promise.resolve({ ok: false, code: "FORBIDDEN", cancelled: false });
    const entry: PendingMove = { id, target, cancelled: false };
    this.pending.push(entry);
    this.recompute();
    this.emit();
    const run = this.chain.then(() => this.send(entry));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async send(entry: PendingMove): Promise<MoveOutcome> {
    if (entry.cancelled) return { ok: false, code: "CANCELLED", cancelled: true };
    try {
      await callApi("POST", spaceUrls(this.spaceKey).move(entry.id), { parentId: entry.target.parentId, index: entry.target.index }, this.fetchImpl);
    } catch (error) {
      // Roll back this move and everything queued after it: they were planned on top of it.
      for (const queued of this.pending) queued.cancelled = true;
      this.pending = [];
      this.recompute();
      this.emit();
      void this.refresh();
      return { ok: false, code: codeOf(error), cancelled: false };
    }
    this.pending = this.pending.filter((queued) => queued !== entry);
    if (this.base !== null) this.base = applyMove(this.base, entry.id, entry.target);
    // Any request issued before now predates this move: its answer must not undo it.
    this.applied = ++this.issued;
    this.recompute();
    this.emit();
    if (this.pending.length === 0) void this.refresh();
    return { ok: true };
  }

  // ---- creating (POST /pages { parentId }) ---------------------------------------------------

  /**
   * Creates a page under `parentId` (null: the root of the space), as `Untitled`, … (RD-056).
   * One request per press: while a create is in flight — and after it succeeded, until the
   * browser navigates to the editor — further presses send nothing.
   */
  // spec: docs/specs/09-decision-log.md section RD-056 (a child is created from the tree or the space overview); 08 §3 (POST /pages)
  async createChild(parentId: string | null): Promise<CreateOutcome> {
    if (!this.canEditValue) return { ok: false, code: "FORBIDDEN", busy: false };
    if (this.creatingParent !== undefined) return { ok: false, code: "BUSY", busy: true };
    this.creatingParent = parentId;
    this.emit();
    let page: PageSummary | null;
    try {
      page = toPageSummary(await callApi("POST", spaceUrls(this.spaceKey).pages, { parentId }, this.fetchImpl));
      if (page === null) throw new ApiError("UNEXPECTED_RESPONSE", 201);
    } catch (error) {
      this.creatingParent = undefined;
      this.emit();
      void this.refresh();
      return { ok: false, code: codeOf(error), busy: false };
    }
    const created = page;
    if (this.base === null) this.base = [created];
    else if (!this.base.some((p) => p.id === created.id)) this.base = [...this.base, created];
    this.status = "ready";
    if (parentId !== null) this.addExpanded([parentId]);
    this.applied = ++this.issued;
    this.recompute();
    this.emit();
    this.createLockTimer = setTimeout(() => this.releaseCreateLock(), CREATE_LOCK_MS);
    return { ok: true, page: created, href: editHref(this.spaceKey, created.id) };
  }

  isCreating(): boolean {
    return this.creatingParent !== undefined;
  }

  /** The parent a create is running under (null: the root of the space), or undefined. */
  getCreatingParent(): string | null | undefined {
    return this.creatingParent;
  }

  releaseCreateLock(): void {
    if (this.createLockTimer !== null) clearTimeout(this.createLockTimer);
    this.createLockTimer = null;
    if (this.creatingParent === undefined) return;
    this.creatingParent = undefined;
    this.emit();
  }

  /**
   * Stops the create-lock timer. Listeners are left alone: under React's StrictMode effects run
   * twice, and subscribers re-subscribe in their own effects.
   */
  dispose(): void {
    if (this.createLockTimer !== null) clearTimeout(this.createLockTimer);
    this.createLockTimer = null;
  }
}
