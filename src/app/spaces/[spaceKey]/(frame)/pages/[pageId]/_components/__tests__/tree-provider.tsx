// The frame's PageTreeProvider, as AppFrame renders it around every space screen, for the page
// view's component tests: the dialogs and the header read the live tree from it. `pages: null`
// is a tree that failed to load on the server. The test file must mock next/navigation with
// `usePathname` (the provider follows the URL).
import type { ReactNode } from "react";
import type { PageSummary } from "@/domain/documents/api-types";
import type { FetchLike } from "@/ui/api-client";
import { PageTreeProvider, usePageTreeStore } from "@/ui/page-tree/provider";
import type { PageTreeStore } from "@/ui/page-tree/store";

export interface TreeProviderProps {
  readonly pages: readonly PageSummary[] | null;
  readonly fetchImpl: FetchLike;
  readonly canEdit?: boolean;
  /** Receives the store, so a test can act as the sidebar does (store.move …). */
  readonly onStore?: (store: PageTreeStore) => void;
  readonly children: ReactNode;
}

function StoreProbe({ onStore }: { readonly onStore: (store: PageTreeStore) => void }) {
  onStore(usePageTreeStore());
  return null;
}

export function TreeProvider({ pages, fetchImpl, canEdit = true, onStore, children }: TreeProviderProps) {
  return (
    <PageTreeProvider
      spaceKey="TEAM"
      canEdit={canEdit}
      initial={pages === null ? { status: "error" } : { status: "ready", pages }}
      fetchImpl={fetchImpl}
      storage={() => null}
    >
      {onStore ? <StoreProbe onStore={onStore} /> : null}
      {children}
    </PageTreeProvider>
  );
}

/** The fake API's answer to GET /api/v1/spaces/TEAM/pages: is this request that GET? */
export const isTreeGet = (request: { readonly method: string; readonly url: string }) =>
  request.method === "GET" && request.url === "/api/v1/spaces/TEAM/pages";
