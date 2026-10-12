// What the page view route loads: the page with the version being viewed (getPageView), one use
// case. It authorises against the space; a space or page the viewer cannot see is NotFoundError,
// which the route turns into the 404 page (RD-051) — the viewer never learns it exists.
// The space's tree is NOT loaded here: AppFrame already loads it once per request (loadFrameTree)
// into the frame's PageTreeStore, which the `···` → Move and Copy dialogs and the breadcrumb read
// live — a second copy would cost a second query, ship the tree twice, and go stale after a move
// in the sidebar.
// spec: docs/specs/10-ui-reference.md sections 4 and 11; docs/specs/09-decision-log.md sections RD-051, RD-059, RD-060
import type { PageDetail, VersionDetail } from "@/domain/documents";
import type { Actor } from "@/server/authz/actor";
import { getPageView } from "@/server/usecases/pages";

export interface PageScreen {
  /** The space as stored: `key` is canonical, whatever case the URL used. */
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  /** The version shown: the current one, or the past one `?version=N` names (RD-060). */
  readonly version: VersionDetail;
}

/**
 * Loads the page view. `version` undefined is the current version. Throws NotFoundError for an
 * unknown or invisible space, page or version.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}?version=N); RD-051, RD-060
export async function loadPageScreen(actor: Actor, spaceKey: string, pageId: string, version?: number): Promise<PageScreen> {
  const view = await getPageView(actor, spaceKey, pageId, version);
  return {
    space: { key: view.space.key, name: view.space.name },
    page: view.page,
    version: view.version,
  };
}
