"use client";

// The space overview, `/spaces/{SPACE}` (10 §11): the space's name and its whole page tree, in
// the same PageTree the sidebar uses, roomier. `?highlight={pageId}` (View in Hierarchy, RD-059)
// opens the path to that page, marks it and scrolls it into view once. Editors get Create a page
// at the root and a "+" on every page (RD-056).
//
// The overview renders on every navigation to it (the layout does not), so its server-loaded
// pages are offered to the frame's shared store. They may come from a cached payload (Back,
// Forward), so the store shows them only while it holds nothing it fetched or confirmed itself,
// and settles any difference with a GET (PageTreeStore.adopt).
// spec: docs/specs/10-ui-reference.md sections 11 and 12; RD-056, RD-059
import { useEffect } from "react";
import { t } from "@/copy";
import { PageTree } from "@/ui/page-tree/page-tree";
import { usePageTreeStore } from "@/ui/page-tree/provider";
import type { InitialTree } from "@/ui/page-tree/store";

export interface SpaceOverviewProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly initial: InitialTree;
  /** Already checked against the tree (highlightFromParam); null for none. */
  readonly highlightId: string | null;
}

// spec: docs/specs/10-ui-reference.md section 11 (Space overview = the page tree)
export function SpaceOverview({ space, initial, highlightId }: SpaceOverviewProps) {
  const store = usePageTreeStore();

  useEffect(() => {
    if (initial.status === "ready") store.adopt(initial.pages);
  }, [store, initial]);

  return (
    <section aria-labelledby="space-overview-title" className="mx-auto max-w-5xl">
      <h1 id="space-overview-title" className="mb-6 break-words text-2xl font-semibold text-slate-900">
        {space.name}
      </h1>
      {/* A new highlight is a new tree: the path opens and the page scrolls into view again. */}
      <PageTree key={highlightId ?? ""} variant="overview" label={t("overview.tree", { space: space.name })} highlightId={highlightId} />
    </section>
  );
}
