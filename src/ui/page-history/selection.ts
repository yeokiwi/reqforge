// Page History's client-side state (10 section 23, RD-060): which versions are ticked for
// "Compare selected versions", which Restore or Delete is in flight, and the message the last one
// left. A tiny external store rather than React state at the top of the table, so ticking one box
// re-renders that box and the Compare button only — a history of hundreds of versions stays
// responsive (each subscriber reads its own primitive snapshot through useSyncExternalStore).
// No React and no browser APIs here: the rules are tested directly.
// spec: docs/specs/10-ui-reference.md section 23 (`Compare selected versions` takes exactly two checked versions); RD-060

/**
 * The pair "Compare selected versions" opens, or null. Exactly two distinct versions must be
 * selected; the lower number comes first, so `a` is always the older version.
 */
// spec: docs/specs/10-ui-reference.md section 23 (exactly two checked versions); section 11 (?a={n}&b={m})
export function comparePair(selected: Iterable<number>): readonly [number, number] | null {
  const distinct = [...new Set(selected)];
  if (distinct.length !== 2) return null;
  const [x, y] = distinct as [number, number];
  return x < y ? [x, y] : [y, x];
}

/** A Restore or Delete the user confirmed and the server has not answered yet. */
export interface PendingAction {
  readonly kind: "restore" | "delete";
  readonly version: number;
}

/** What the last action left to say: an error (role=alert) or a confirmation (role=status). */
export interface HistoryNotice {
  readonly tone: "error" | "status";
  readonly text: string;
}

export interface HistoryStore {
  subscribe(listener: () => void): () => void;
  isSelected(version: number): boolean;
  /** The selected versions, ascending; the same array until the selection changes. */
  selected(): readonly number[];
  setSelected(version: number, on: boolean): void;
  /** Forgets versions that are no longer in the history (deleted here or elsewhere). */
  retain(versions: readonly number[]): void;
  pending(): PendingAction | null;
  /**
   * Claims the single action slot. False when another Restore or Delete is still in flight: the
   * double-submit guard, decided synchronously so two fast presses cannot both get through.
   */
  begin(action: PendingAction): boolean;
  /** Releases the slot claimed by begin. */
  end(): void;
  notice(): HistoryNotice | null;
  setNotice(notice: HistoryNotice | null): void;
}

/** A store starting with `initial` ticked. */
export function createHistoryStore(initial: readonly number[] = []): HistoryStore {
  const listeners = new Set<() => void>();
  const chosen = new Set<number>(initial);
  let snapshot: readonly number[] = sortedOf(chosen);
  let pending: PendingAction | null = null;
  let notice: HistoryNotice | null = null;

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const selectionChanged = () => {
    snapshot = sortedOf(chosen);
    emit();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isSelected: (version) => chosen.has(version),
    selected: () => snapshot,
    setSelected(version, on) {
      if (chosen.has(version) === on) return;
      if (on) chosen.add(version);
      else chosen.delete(version);
      selectionChanged();
    },
    retain(versions) {
      const keep = new Set(versions);
      let changed = false;
      for (const version of [...chosen]) {
        if (!keep.has(version)) {
          chosen.delete(version);
          changed = true;
        }
      }
      if (changed) selectionChanged();
    },
    pending: () => pending,
    begin(action) {
      if (pending !== null) return false;
      pending = action;
      emit();
      return true;
    },
    end() {
      if (pending === null) return;
      pending = null;
      emit();
    },
    notice: () => notice,
    setNotice(next) {
      if (next === notice) return;
      notice = next;
      emit();
    },
  };
}

function sortedOf(values: ReadonlySet<number>): readonly number[] {
  return Object.freeze([...values].sort((p, q) => p - q));
}
