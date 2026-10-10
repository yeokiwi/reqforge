// Reading a page: the page view (current or a past version) and the editor's starting state.
import type { PageDetail, VersionDetail } from "@/domain/documents";
import { NotFoundError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { getDraft } from "@/server/repositories/drafts";
import { rootDb } from "@/server/repositories/transaction";
import { getVersion } from "@/server/repositories/versions";
import type { SpaceView } from "@/server/usecases/spaces";
import { isVersionNumber, resolvePage, toPageDetail, toVersionDetail } from "./shared";

export interface PageView {
  readonly space: SpaceView;
  readonly page: PageDetail;
  readonly version: VersionDetail;
}

/**
 * A page with one version's content: the current one, or `versionNumber` (read-only past
 * version, RD-060). An unknown version number is NotFound. Needs space VIEW.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}, ?version=N); docs/specs/09-decision-log.md section RD-060
export async function getPageView(actor: Actor, spaceKey: string, pageId: string, versionNumber?: number): Promise<PageView> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  const number = versionNumber ?? page.currentVersion;
  if (!isVersionNumber(number)) throw new NotFoundError("Version");
  const version = await getVersion(rootDb, actor.id, page.id, number);
  if (!version) throw new NotFoundError("Version");
  return { space, page: toPageDetail(page, space), version: toVersionDetail(version) };
}

export interface EditorInitialState {
  readonly title: string;
  readonly content: unknown;
  /** The version the editor opens from: the draft's base, or the current version. */
  readonly baseVersion: number;
  /** True when the caller's own draft was resumed (RD-055: Close keeps the draft). */
  readonly fromDraft: boolean;
}

export interface EditorState {
  readonly space: SpaceView;
  readonly page: PageDetail;
  readonly initial: EditorInitialState;
}

/**
 * What the editor opens with: the caller's own draft if they have one (RD-055: opening Edit
 * again resumes it), else the current version. Needs space EDIT. A draft that is stale shows
 * as `initial.baseVersion !== page.currentVersion`.
 */
// spec: docs/specs/09-decision-log.md section RD-055 (Close keeps the draft; opening Edit again resumes it)
export async function getEditorState(actor: Actor, spaceKey: string, pageId: string): Promise<EditorState> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  const draft = await getDraft(rootDb, actor.id, page.id);
  if (draft) {
    return {
      space,
      page: toPageDetail(page, space),
      initial: { title: draft.title, content: draft.content, baseVersion: draft.baseVersionNumber, fromDraft: true },
    };
  }
  const current = await getVersion(rootDb, actor.id, page.id, page.currentVersion);
  if (!current) throw new NotFoundError("Page");
  return {
    space,
    page: toPageDetail(page, space),
    initial: { title: current.title, content: current.content, baseVersion: current.number, fromDraft: false },
  };
}
