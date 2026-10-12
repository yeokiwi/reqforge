// The frame's live page tree for the page view's client components (the header's breadcrumb, the
// Move and Copy dialogs): the store AppFrame provides around every space screen, its current model
// and its status, re-rendering when the store changes. The model is the same object between
// changes, and the server render and the first client render build the store from the same data,
// so hydration agrees.
// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE); docs/specs/09-decision-log.md section RD-056
import { useSyncExternalStore } from "react";
import type { TreeModel } from "@/ui/page-tree/model";
import { usePageTreeStore } from "@/ui/page-tree/provider";
import type { PageTreeStore, TreeStatus } from "@/ui/page-tree/store";

export interface LiveTree {
  readonly store: PageTreeStore;
  readonly model: TreeModel;
  readonly status: TreeStatus;
}

export function useLiveTree(): LiveTree {
  const store = usePageTreeStore();
  const model = useSyncExternalStore(store.subscribe, () => store.getModel(), () => store.getModel());
  const status = useSyncExternalStore(store.subscribe, () => store.getStatus(), () => store.getStatus());
  return { store, model, status };
}
