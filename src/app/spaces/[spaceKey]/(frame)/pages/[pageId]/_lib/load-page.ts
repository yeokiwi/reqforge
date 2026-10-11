// What the page view route loads, in one call: the page with the version being viewed
// (getPageView) and the space's whole tree for the `···` → Move picker (listPageTree, RD-059).
// Both authorise against the space; a space or page the viewer cannot see is NotFoundError from
// either, which the route turns into the 404 page (RD-051) — the viewer never learns it exists.
// spec: docs/specs/10-ui-reference.md sections 4 and 11; docs/specs/09-decision-log.md sections RD-051, RD-059, RD-060
import type { PageDetail, PageSummary, VersionDetail } from "@/domain/documents";
import type { Actor } from "@/server/authz/actor";
import { getPageView, listPageTree } from "@/server/usecases/pages";

export interface PageScreen {
  /** The space as stored: `key` is canonical, whatever case the URL used. */
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  /** The version shown: the current one, or the past one `?version=N` names (RD-060). */
  readonly version: VersionDetail;
  /** The whole live tree of the space, flat. */
  readonly pages: readonly PageSummary[];
}

/**
 * Loads the page view. `version` undefined is the current version. Throws NotFoundError for an
 * unknown or invisible space, page or version.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}?version=N, GET /pages); RD-051, RD-060
export async function loadPageScreen(actor: Actor, spaceKey: string, pageId: string, version?: number): Promise<PageScreen> {
  const [view, tree] = await Promise.all([getPageView(actor, spaceKey, pageId, version), listPageTree(actor, spaceKey)]);
  return {
    space: { key: view.space.key, name: view.space.name },
    page: view.page,
    version: view.version,
    pages: tree.pages,
  };
}
