// Loads a space's page tree for the frame (AppFrame's sidebar) and for the space overview, once
// per request: both call it with the same actor and the same URL key, and React's `cache`
// shares the answer, so a full load of `/spaces/{KEY}` reads the tree once.
//
// A failure never takes the screen down: it becomes `{ status: "error" }`, which the tree shows
// as its error state with Try again (10 §12). The screen's own authorisation (getShellContext,
// openSpace) is what answers 404 for a space the viewer cannot see (RD-051).
// spec: docs/specs/08-api-surface.md section 3 (GET /pages: the whole tree, flat); docs/specs/10-ui-reference.md sections 3.2 and 12
import { cache } from "react";
import { NotFoundError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { listPageTree } from "@/server/usecases/pages";
import type { InitialTree } from "@/ui/page-tree/store";

// spec: docs/specs/10-ui-reference.md section 3.2 (PAGE TREE); 08 section 3 (GET /pages)
export async function loadPageTree(actor: Actor, spaceKey: string): Promise<InitialTree> {
  try {
    const { pages } = await listPageTree(actor, spaceKey);
    return { status: "ready", pages };
  } catch (error) {
    // NotFound is expected when the space disappears mid-request; anything else is worth a log line.
    if (!(error instanceof NotFoundError)) console.error("[page-tree] could not load the page tree", error);
    return { status: "error" };
  }
}

/** `loadPageTree`, memoised for the duration of one server request. */
export const loadFrameTree = cache(loadPageTree);
