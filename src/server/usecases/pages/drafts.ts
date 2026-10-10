// Autosaved drafts (RD-055): the caller's own, mutable, never history.
import { isDraftStale, type Draft, type DraftRequest, type DraftResponse } from "@/domain/documents";
import { ValidationError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { allAttachmentIdsForPage } from "@/server/repositories/attachments";
import { deleteDraft, getDraft as readDraft, upsertDraft } from "@/server/repositories/drafts";
import { rootDb } from "@/server/repositories/transaction";
import { canonicalContent, draftTitle, isVersionNumber, resolvePage } from "./shared";

/** The caller's own unpublished draft of the page, or null. Needs space EDIT (08 §3). */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}/draft: { draft: Draft | null }); RD-055
export async function getDraft(actor: Actor, spaceKey: string, pageId: string): Promise<Draft | null> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  const draft = await readDraft(rootDb, actor.id, page.id);
  if (!draft) return null;
  return {
    title: draft.title,
    content: draft.content,
    baseVersion: draft.baseVersionNumber,
    updatedAt: draft.updatedAt.toISOString(),
    stale: isDraftStale(draft.baseVersionNumber, draft.currentVersion),
    currentVersion: draft.currentVersion,
  };
}

/**
 * Autosave. The content is validated and canonicalised exactly as for a publish; the title is
 * only normalised (it may be empty mid-typing, up to 255 code points). A draft over a stale
 * base is saved and reported `stale`, never refused (RD-055). Not audited: it is not history.
 */
// spec: docs/specs/09-decision-log.md sections RD-055 (autosave writes a mutable DocumentDraft), RD-063; 08 §3 (PUT /pages/{id}/draft)
export async function saveDraft(actor: Actor, spaceKey: string, pageId: string, input: DraftRequest): Promise<DraftResponse> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  const title = draftTitle(input.title);
  if (!isVersionNumber(input.baseVersion)) {
    throw new ValidationError([{ path: "baseVersion", message: "must be a positive integer" }]);
  }
  const content = canonicalContent(input.content, await allAttachmentIdsForPage(rootDb, actor.id, page.id));
  const { updatedAt } = await upsertDraft(rootDb, {
    documentId: page.id,
    userId: actor.id,
    title,
    content,
    baseVersionNumber: input.baseVersion,
  });
  return {
    savedAt: updatedAt.toISOString(),
    stale: isDraftStale(input.baseVersion, page.currentVersion),
    currentVersion: page.currentVersion,
  };
}

/** Revert to last published: deletes the caller's draft. Idempotent. Needs space EDIT. */
// spec: docs/specs/08-api-surface.md section 3 (DELETE /pages/{id}/draft: idempotent 204); RD-055
export async function discardDraft(actor: Actor, spaceKey: string, pageId: string): Promise<void> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "EDIT");
  await deleteDraft(rootDb, page.id, actor.id);
}
