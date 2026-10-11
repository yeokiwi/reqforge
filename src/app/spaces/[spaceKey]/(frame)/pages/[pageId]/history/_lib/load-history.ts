// What Page History and Compare load, through the pages use cases only. Each authorises against
// the space: a space or page the viewer cannot see, and a version that does not exist, are
// NotFoundError, which the routes turn into the 404 page (RD-051) — the viewer never learns the
// page exists.
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}, GET /pages/{id}/versions); docs/specs/09-decision-log.md sections RD-051, RD-060, RD-066
import type { Actor } from "@/server/authz/actor";
import { compareVersions, getPageView, listVersions } from "@/server/usecases/pages";
import { type CompareInput, readApproximate } from "./compare-model";
import type { ComparePair } from "./compare-params";
import type { HistoryScreen } from "./history-model";

/**
 * The page (title, ancestors, the viewer's permissions) and every version, newest first. Needs
 * space VIEW.
 */
// spec: docs/specs/10-ui-reference.md section 23; 08 section 3 (GET /pages/{id}/versions: VersionSummary[], newest first)
export async function loadHistory(actor: Actor, spaceKey: string, pageId: string): Promise<HistoryScreen> {
  const [view, versions] = await Promise.all([getPageView(actor, spaceKey, pageId), listVersions(actor, spaceKey, pageId)]);
  return { space: { key: view.space.key, name: view.space.name }, page: view.page, versions };
}

/** Both versions and their aligned top-level blocks, `a` on the left. Needs space VIEW. */
// spec: docs/specs/09-decision-log.md sections RD-060 (Compare selected versions), RD-066 (work cap)
export async function loadComparison(actor: Actor, spaceKey: string, pageId: string, pair: ComparePair): Promise<CompareInput> {
  const comparison = await compareVersions(actor, spaceKey, pageId, pair.a, pair.b);
  return {
    space: { key: comparison.space.key },
    page: comparison.page,
    left: comparison.left,
    right: comparison.right,
    blocks: comparison.blocks,
    approximate: readApproximate(comparison),
  };
}
