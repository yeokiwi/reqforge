"use client";

// The client half of Page History (10 section 23). The table itself is server-rendered; the
// checkboxes, "Compare selected versions", Restore, Delete and the message line are small client
// islands that share one HistoryStore through this provider. Each island subscribes to its own
// primitive snapshot, so ticking a box re-renders that box and the Compare button, not the table.
// The provider outlives router.refresh() (same place in the tree), so the selection survives the
// re-render that follows a Delete; versions that disappear from the server's list are dropped.
// spec: docs/specs/10-ui-reference.md section 23; docs/specs/09-decision-log.md section RD-060
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FetchLike } from "@/ui/api-client";
import { createHistoryStore, type HistoryNotice, type HistoryStore, type PendingAction } from "./selection";

interface HistoryContextValue {
  readonly store: HistoryStore;
  readonly spaceKey: string;
  readonly pageId: string;
  readonly fetchImpl: FetchLike | undefined;
  /** The message line: focus lands here when the row that had it is about to disappear. */
  readonly noticeRef: RefObject<HTMLDivElement | null>;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export interface HistoryProviderProps {
  /** The space's canonical key. */
  readonly spaceKey: string;
  readonly pageId: string;
  /** Every version number the server listed, to prune the selection after a refresh. */
  readonly versions: readonly number[];
  /** Ticked on first render (the current version, 10 section 23). */
  readonly initialSelected: readonly number[];
  /** Tests pass a fake; the browser's fetch otherwise. */
  readonly fetchImpl?: FetchLike;
  readonly children: ReactNode;
}

export function HistoryProvider({ spaceKey, pageId, versions, initialSelected, fetchImpl, children }: HistoryProviderProps) {
  const [store] = useState(() => createHistoryStore(initialSelected));
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const versionsKey = versions.join(",");

  useEffect(() => {
    store.retain(versionsKey === "" ? [] : versionsKey.split(",").map(Number));
  }, [store, versionsKey]);

  return <HistoryContext.Provider value={{ store, spaceKey, pageId, fetchImpl, noticeRef }}>{children}</HistoryContext.Provider>;
}

export function useHistory(): HistoryContextValue {
  const value = useContext(HistoryContext);
  if (value === null) throw new Error("Page History components must be rendered inside <HistoryProvider>");
  return value;
}

/** Whether `version` is ticked. Re-renders only when that answer changes. */
export function useIsSelected(version: number): boolean {
  const { store } = useHistory();
  const read = () => store.isSelected(version);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** The ticked versions, ascending (a stable array until the selection changes). */
export function useSelected(): readonly number[] {
  const { store } = useHistory();
  return useSyncExternalStore(store.subscribe, store.selected, store.selected);
}

/** The Restore or Delete in flight, if any. */
export function usePending(): PendingAction | null {
  const { store } = useHistory();
  return useSyncExternalStore(store.subscribe, store.pending, store.pending);
}

export function useNotice(): HistoryNotice | null {
  const { store } = useHistory();
  return useSyncExternalStore(store.subscribe, store.notice, store.notice);
}
