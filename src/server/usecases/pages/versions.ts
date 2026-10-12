// Page history (RD-060): list, read, restore, delete one version, compare two.
import {
  canDeleteVersion,
  diffDocumentsReport,
  type BlockDiff,
  type PageDetail,
  type PublishResponse,
  type VersionDetail,
  type VersionSummary,
} from "@/domain/documents";
import { CurrentVersionError, NotFoundError, PinnedVersionError } from "@/domain/errors";
import { t } from "@/copy";
import type { Actor } from "@/server/authz/actor";
import { lockPage, rootDb, transaction } from "@/server/repositories/transaction";
import {
  deleteVersion as deleteVersionRow,
  getVersion as readVersion,
  insertVersion,
  listVersions as readVersions,
} from "@/server/repositories/versions";
import type { SpaceView } from "@/server/usecases/spaces";
import { auditPage, isVersionNumber, reread, resolvePage, toPageDetail, toVersionDetail, toVersionSummary } from "./shared";

/** Every version of the page, newest first. Needs space VIEW. */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/versions: VersionSummary[], newest first)
export async function listVersions(actor: Actor, spaceKey: string, pageId: string): Promise<VersionSummary[]> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  const rows = await readVersions(rootDb, actor.id, page.id);
  if (!rows) throw new NotFoundError("Page");
  return rows.map(toVersionSummary);
}

/** One version with its content. Needs space VIEW. */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/versions/{n}: VersionDetail)
export async function getVersion(actor: Actor, spaceKey: string, pageId: string, versionNumber: number): Promise<VersionDetail> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  if (!isVersionNumber(versionNumber)) throw new NotFoundError("Version");
  const row = await readVersion(rootDb, actor.id, page.id, versionNumber);
  if (!row) throw new NotFoundError("Version");
  return toVersionDetail(row);
}

/**
 * Restore creates a NEW version whose title and content equal version `n`'s, with the note
 * `Restored from v. N`; history stays append-only (RD-060). Needs space EDIT. The old title may
 * since have been taken by another live page: TITLE_TAKEN.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Restore creates a new version); 08 §3 (POST /pages/{id}/versions/{n}/restore)
export async function restoreVersion(actor: Actor, spaceKey: string, pageId: string, versionNumber: number): Promise<PublishResponse> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  if (!isVersionNumber(versionNumber)) throw new NotFoundError("Version");

  const result = await transaction(async (tx) => {
    const locked = await lockPage(tx, page.id);
    if (!locked || locked.deleted || locked.spaceId !== space.id) throw new NotFoundError("Page");
    const old = await readVersion(tx, actor.id, page.id, versionNumber);
    if (!old) throw new NotFoundError("Version");
    const version = await insertVersion(tx, {
      documentId: page.id,
      title: old.title,
      content: old.content,
      authorId: actor.id,
      message: t("history.restoredNote", { n: old.number }),
    });
    await auditPage(tx, actor, space.id, page.id, "page.restore-version", {
      restoredFrom: old.number,
      version: version.number,
      previousVersion: locked.currentVersion,
      title: old.title,
    });
    return { record: await reread(tx, actor, page.id), version };
  });
  return { page: toPageDetail(result.record, space), version: toVersionSummary(result.version), diagnostics: [] };
}

/**
 * Deletes one version from history. Needs space ADMIN (RD-060). The current version is
 * CURRENT_VERSION and a pinned one PINNED_VERSION — decided here by canDeleteVersion under the
 * page lock, and again by the database.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Delete: non-current, non-pinned, space ADMIN); 08 §3 (DELETE /pages/{id}/versions/{n}), §3.2
export async function deleteVersion(actor: Actor, spaceKey: string, pageId: string, versionNumber: number): Promise<void> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "ADMIN");
  if (!isVersionNumber(versionNumber)) throw new NotFoundError("Version");

  await transaction(async (tx) => {
    const locked = await lockPage(tx, page.id);
    if (!locked || locked.deleted || locked.spaceId !== space.id) throw new NotFoundError("Page");
    const version = await readVersion(tx, actor.id, page.id, versionNumber);
    if (!version) throw new NotFoundError("Version");
    const check = canDeleteVersion({ current: version.current, pinned: version.pinned });
    if (!check.ok) throw check.code === "CURRENT_VERSION" ? new CurrentVersionError() : new PinnedVersionError();
    await deleteVersionRow(tx, page.id, version.number);
    await auditPage(tx, actor, space.id, page.id, "page.delete-version", {
      version: version.number,
      title: version.title,
      author: version.author.id,
      createdAt: version.createdAt.toISOString(),
    });
  });
}

export interface VersionComparison {
  readonly space: SpaceView;
  readonly page: PageDetail;
  readonly left: VersionDetail;
  readonly right: VersionDetail;
  /** Top-level blocks aligned and classified (RD-060, capped by RD-066). */
  readonly blocks: BlockDiff[];
  /** True when RD-066's work cap left the alignment possibly inexact: some equal blocks may show as changed. */
  readonly approximate: boolean;
}

/** Compare selected versions: both, side by side, with changed top-level blocks. Needs space VIEW. */
// spec: docs/specs/09-decision-log.md sections RD-060 (Compare selected versions), RD-066 (work cap)
export async function compareVersions(
  actor: Actor,
  spaceKey: string,
  pageId: string,
  a: number,
  b: number,
): Promise<VersionComparison> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  if (!isVersionNumber(a) || !isVersionNumber(b)) throw new NotFoundError("Version");
  const [left, right] = await Promise.all([readVersion(rootDb, actor.id, page.id, a), readVersion(rootDb, actor.id, page.id, b)]);
  if (!left || !right) throw new NotFoundError("Version");
  const diff = diffDocumentsReport(left.content, right.content);
  return {
    space,
    page: toPageDetail(page, space),
    left: toVersionDetail(left),
    right: toVersionDetail(right),
    blocks: diff.blocks,
    approximate: diff.approximate,
  };
}
