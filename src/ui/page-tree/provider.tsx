"use client";

// One PageTreeStore per space frame, shared by the sidebar's tree and the space overview's, so a
// move made in one shows in the other (10 §3.2, §11).
//
// Why a client store at all: a Next layout is not re-rendered by client-side navigation, so the
// pages AppFrame loads on the server go stale after a publish, rename, move, delete or create made
// on another screen. The store starts from the server's pages (the first paint is right, and the
// links work before JavaScript runs) and then:
//   - refetches GET /api/v1/spaces/{KEY}/pages whenever the pathname changes, when the tab is shown
//     again, and after each of its own moves;
//   - offers the store the layout's pages again whenever the layout re-renders (router.refresh(),
//     a server action), and the overview's pages when the overview renders; a render of unknown
//     age never replaces what the store fetched or confirmed itself (PageTreeStore.adopt);
//   - applies a response only if nothing newer has been applied since its request was issued, so a
//     slow, older response never overwrites a newer tree (PageTreeStore.refresh).
// spec: docs/specs/10-ui-reference.md sections 3.2 (PAGE TREE) and 11; docs/specs/08-api-surface.md section 3 (GET /pages); RD-056, RD-072
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppError } from "@/domain/errors";
import type { FetchLike } from "@/ui/api-client";
import { browserStorage, type StorageSource } from "./expansion-storage";
import { currentPageIdFromPath } from "./model";
import { PageTreeStore, type InitialTree } from "./store";

const PageTreeContext = createContext<PageTreeStore | null>(null);

export class MissingPageTreeProviderError extends AppError {
  constructor() {
    super("PAGE_TREE_PROVIDER", "A page tree was rendered outside a PageTreeProvider (AppFrame renders one for every space).");
  }
}

/** The space's shared tree store. */
export function usePageTreeStore(): PageTreeStore {
  const store = useContext(PageTreeContext);
  if (store === null) throw new MissingPageTreeProviderError();
  return store;
}

export interface PageTreeProviderProps {
  /** The space's canonical key. Give the provider `key={spaceKey}` so another space gets a new store. */
  readonly spaceKey: string;
  /** Space EDIT (07 §2.4): whether moving and creating are offered. The server checks again. */
  readonly canEdit: boolean;
  /** The pages the server loaded, or the fact that loading failed; null when nothing was loaded. */
  readonly initial: InitialTree | null;
  readonly children: ReactNode;
  /** Tests only. */
  readonly fetchImpl?: FetchLike;
  /** Tests only: where expansion state is remembered (default: localStorage). */
  readonly storage?: StorageSource;
}

// spec: docs/specs/10-ui-reference.md section 3.2; docs/specs/08-api-surface.md section 3 (GET /pages)
export function PageTreeProvider({ spaceKey, canEdit, initial, children, fetchImpl, storage = browserStorage }: PageTreeProviderProps) {
  const pathname = usePathname();
  const currentId = currentPageIdFromPath(pathname, spaceKey);
  const [store] = useState(() => new PageTreeStore({ spaceKey, canEdit, initial, currentId, fetchImpl }));

  useEffect(() => {
    store.setCanEdit(canEdit);
  }, [store, canEdit]);

  // The layout re-rendered with newer server data (router.refresh(), a server action).
  const seenInitial = useRef(initial);
  useEffect(() => {
    if (initial === seenInitial.current) return;
    seenInitial.current = initial;
    if (initial !== null) store.setInitial(initial);
  }, [store, initial]);

  // Client-side navigation: a new current page, and something may have changed elsewhere.
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (pathname === seenPath.current) return;
    seenPath.current = pathname;
    store.navigated(currentId);
  }, [store, pathname, currentId]);

  // Remembered expansion is read after hydration, so the server's HTML and the first client
  // render agree; then the remembered pages open.
  useEffect(() => {
    store.attachStorage(storage);
  }, [store, storage]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") store.invalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [store]);

  useEffect(() => () => store.dispose(), [store]);

  return <PageTreeContext.Provider value={store}>{children}</PageTreeContext.Provider>;
}
