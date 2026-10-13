// What every pages use case shares: finding a page through its space (the IDOR check), the
// input checks that run before any lock is taken, the mapping from repository rows to the wire
// types of spec 08 §3.1, and the audit call.
import {
  LIMITS,
  attachmentUrl,
  checkTitle,
  codePointLength,
  exceedsRaw,
  normalizeTitle,
  type AttachmentRef,
  type PageDetail,
  type PageSummary,
  type TitleProblem,
  type VersionDetail,
  type VersionSummary,
} from "@/domain/documents";
import { NotFoundError, TooLargeError, ValidationError, type ValidationIssue } from "@/domain/errors";
import { validateDocumentJson, type DocumentJson } from "@/editor/schema";
import type { Actor } from "@/server/authz/actor";
import { authorizeSpace, type SpaceNeed } from "@/server/authz/space-permission";
import type { AttachmentRow } from "@/server/repositories/attachments";
import { writeAudit } from "@/server/repositories/audit";
import { getPage, type PageRecord, type PageRow } from "@/server/repositories/documents";
import { rootDb, type Db, type Tx } from "@/server/repositories/transaction";
import type { VersionRow, VersionWithContent } from "@/server/repositories/versions";
import type { SpaceView } from "@/server/usecases/spaces";

/** Database ids (cuid) as they appear in URLs: one URL-safe segment. Anything else is not found. */
const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether `id` can be a database id at all. A malformed id is answered as not found (08 §3.2). */
export function isWellFormedId(id: string): boolean {
  return ENTITY_ID.test(id);
}

/** A version number as the database stores it: a positive int4. */
export function isVersionNumber(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1 && n <= 2_147_483_647;
}

/**
 * The page `pageId` as `actor` sees it, provided it belongs to `space`. A page of another space
 * is NOT found here even when the actor can see it there: a page id from space A must never be
 * readable or writable through space B's URL, whose permissions may differ (the IDOR check).
 * Missing, deleted and invisible pages are equally not found (rule X2, RD-051).
 */
// spec: docs/specs/08-api-surface.md section 3 (all paths under /spaces/{spaceKey}); docs/specs/07-permissions-and-limits.md section 2.2 (rule X2); RD-051
export async function findPageInSpace(db: Db, actor: Actor, space: SpaceView, pageId: string): Promise<PageRecord> {
  if (!isWellFormedId(pageId)) throw new NotFoundError("Page");
  const page = await getPage(db, actor.id, pageId);
  if (!page || page.spaceId !== space.id) throw new NotFoundError("Page");
  return page;
}

export interface ResolvedPage {
  readonly space: SpaceView;
  readonly page: PageRecord;
}

/**
 * authorizeSpace(need), then findPageInSpace. The order of the answers is fixed:
 *   1. the URL's space is not visible            → 404 (RD-051)
 *   2. visible, but the caller lacks `need` there → 403, the same for every page id, so a caller
 *      without the permission learns nothing about which pages exist
 *   3. the page is not a visible live page of THAT space → 404 (rule X2; the IDOR check)
 * Every use case addressed to a page calls this BEFORE its own checks of the request (title rules,
 * change note, content schema, attachment references — the last depends on the page), so those are
 * only ever judged for a page the caller may change; then locks are taken. The route has already
 * refused what is wrong with the request whatever the page (media type, size, JSON syntax, field
 * types), and those answers reveal nothing about the page.
 */
// spec: docs/specs/07-permissions-and-limits.md section 2.4 (page actions); docs/specs/09-decision-log.md section RD-051
export async function resolvePage(actor: Actor, spaceKey: string, pageId: string, need: SpaceNeed): Promise<ResolvedPage> {
  const space = await authorizeSpace(actor, spaceKey, need);
  const page = await findPageInSpace(rootDb, actor, space, pageId);
  return { space, page };
}

// ------------------------------------------------------------------------------ input checks

const TITLE_MESSAGES: Readonly<Record<TitleProblem, string>> = {
  EMPTY: "must not be empty",
  CONTROL_CHARACTERS: "must not contain control characters or line breaks",
  TOO_LONG: `must be at most ${LIMITS.titleMax} characters`,
};

/** A title to publish or create with: checkTitle, or ValidationError at `path`. Returns the stored (normalised) form. */
// spec: docs/specs/09-decision-log.md sections RD-056 and RD-067 (titles: 1–255 code points after NFC and trimming; no control characters)
export function requireTitle(raw: string, path = "title"): string {
  const checked = checkTitle(raw);
  if (!checked.ok) throw new ValidationError([{ path, message: TITLE_MESSAGES[checked.problem] }]);
  return checked.title;
}

/**
 * Why Postgres would refuse this text (U+0000 or an unpaired UTF-16 surrogate), or null.
 * Such input is refused, not stripped (RD-068).
 */
function unstorableText(s: string): string | null {
  if (s.includes("\u0000")) return "must not contain the character U+0000";
  if (/\p{Cs}/u.test(s)) return "must not contain half of a character (an unpaired UTF-16 surrogate)";
  return null;
}

/**
 * A draft's title: only normalised (NFC, trimmed), because a draft may be saved mid-typing —
 * empty is allowed, up to 255 code points. checkTitle runs when the draft is published.
 */
// spec: docs/specs/09-decision-log.md section RD-055 (autosave); docs/specs/01-domain-model.md (DocumentDraft); RD-067
export function draftTitle(raw: string): string {
  if (exceedsRaw(raw, LIMITS.titleMax)) throw new ValidationError([{ path: "title", message: TITLE_MESSAGES.TOO_LONG }]);
  const title = normalizeTitle(raw);
  const bad = unstorableText(title);
  if (bad) throw new ValidationError([{ path: "title", message: bad }]);
  if (codePointLength(title) > LIMITS.titleMax) {
    throw new ValidationError([{ path: "title", message: TITLE_MESSAGES.TOO_LONG }]);
  }
  return title;
}

/** The change note (`What did you change?`): at most 500 code points; blank is no note (null). */
// spec: docs/specs/07-permissions-and-limits.md section 4 (Change note, 500 characters); RD-063
export function changeNote(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  // Bounded before NFC, which is quadratic on a run of combining marks (RD-085).
  if (exceedsRaw(raw, LIMITS.messageMax)) {
    throw new ValidationError([{ path: "message", message: `must be at most ${LIMITS.messageMax} characters` }]);
  }
  const note = raw.normalize("NFC").trim();
  if (note === "") return null;
  const bad = unstorableText(note);
  if (bad) throw new ValidationError([{ path: "message", message: bad }]);
  if (codePointLength(note) > LIMITS.messageMax) {
    throw new ValidationError([{ path: "message", message: `must be at most ${LIMITS.messageMax} characters` }]);
  }
  return note;
}

/** A JSON Pointer into the content (`/content/0/attrs/src`) as a request-field path (`content.content.0.attrs.src`). */
export function contentPath(pointer: string): string {
  if (pointer === "") return "content";
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  return ["content", ...tokens].join(".");
}

/**
 * Untrusted content to its canonical form (RD-063), with images limited to `allowedAttachmentIds`
 * (RD-058). Over 5 MiB is TooLargeError; every other refusal is ValidationError with paths.
 */
// spec: docs/specs/09-decision-log.md sections RD-058, RD-063, RD-068; docs/specs/08-api-surface.md section 3.2 (VALIDATION, TOO_LARGE)
export function canonicalContent(input: unknown, allowedAttachmentIds: ReadonlySet<string>): DocumentJson {
  const result = validateDocumentJson(input, { allowedAttachmentIds });
  if (result.ok) return result.doc;
  if (result.reason === "TOO_LARGE") throw new TooLargeError(LIMITS.contentMaxBytes);
  const errors: ValidationIssue[] = result.errors.map((e) => ({ path: contentPath(e.path), message: e.message }));
  throw new ValidationError(errors.length > 0 ? errors : [{ path: "content", message: "is not a valid document" }]);
}

// ------------------------------------------------------------------------------ wire shapes

const iso = (d: Date): string => d.toISOString();

// spec: docs/specs/08-api-surface.md section 3.1 (PageSummary)
export function toPageSummary(row: PageRow): PageSummary {
  return {
    id: row.id,
    title: row.title,
    parentId: row.parentId,
    ordinal: row.ordinal,
    currentVersion: row.currentVersion,
    lastModifiedAt: iso(row.lastModifiedAt),
  };
}

/** PageDetail for the caller: their watch, favourite and draft state, and their permissions in the space. */
// spec: docs/specs/08-api-surface.md section 3.1 (PageDetail)
export function toPageDetail(page: PageRecord, space: SpaceView): PageDetail {
  return {
    ...toPageSummary(page),
    spaceKey: page.spaceKey,
    ancestors: page.ancestors.map((a) => ({ id: a.id, title: a.title })),
    createdBy: { id: page.createdBy.id, name: page.createdBy.name },
    createdAt: iso(page.createdAt),
    lastModifiedBy: { id: page.lastModifiedBy.id, name: page.lastModifiedBy.name },
    descendantCount: page.descendantCount,
    watching: page.watching,
    favourite: page.favourite,
    hasDraft: page.hasDraft,
    permissions: { canEdit: space.access.canEdit, canAdmin: space.access.canAdmin },
  };
}

/** VersionSummary; `pinnedBy` stays absent until baselines exist (slice 13). */
// spec: docs/specs/08-api-surface.md section 3.1 (VersionSummary)
export function toVersionSummary(v: VersionRow): VersionSummary {
  return {
    number: v.number,
    title: v.title,
    message: v.message,
    author: { id: v.author.id, name: v.author.name },
    createdAt: iso(v.createdAt),
    current: v.current,
    pinned: v.pinned,
  };
}

// spec: docs/specs/08-api-surface.md section 3.1 (VersionDetail)
export function toVersionDetail(v: VersionWithContent): VersionDetail {
  return { ...toVersionSummary(v), content: v.content };
}

const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Whether a stored content type is one of the verified image types (RD-058, RD-071). */
export function isImageContentType(contentType: string): boolean {
  return IMAGE_TYPES.has(contentType);
}

/** AttachmentRef, its url built with attachmentUrl (percent-encoded, as the content validator requires). */
// spec: docs/specs/08-api-surface.md section 3.1 (AttachmentRef); docs/specs/09-decision-log.md sections RD-058, RD-068 (images)
export function toAttachmentRef(a: AttachmentRow): AttachmentRef {
  return {
    id: a.id,
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
    url: attachmentUrl(a.id, a.filename),
    image: isImageContentType(a.contentType),
    uploadedBy: { id: a.uploadedBy.id, name: a.uploadedBy.name },
    createdAt: iso(a.createdAt),
  };
}

// ------------------------------------------------------------------------------ audit

export type PageOperation =
  | "page.create"
  | "page.update"
  | "page.rename"
  | "page.move"
  | "page.copy"
  | "page.delete"
  | "page.restore-version"
  | "page.delete-version"
  // A user's own state (RD-055, RD-061): written only when it actually changes.
  | "page.watch"
  | "page.unwatch"
  | "page.favourite"
  | "page.unfavourite"
  | "page.discard-draft";

export type AttachmentOperation = "attachment.upload" | "attachment.delete";

/** One audit row for a page operation, written with the transaction that made the change. */
// spec: docs/specs/07-permissions-and-limits.md section 6 (every state-changing operation writes an audit row)
export async function auditPage(
  tx: Tx,
  actor: Actor,
  spaceId: string,
  pageId: string,
  operation: PageOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<void> {
  await writeAudit(tx, { actorId: actor.id, spaceId, objectType: "page", objectId: pageId, operation, parameters });
}

/** One audit row for an attachment operation; `parameters` should name the page. */
// spec: docs/specs/07-permissions-and-limits.md section 6
export async function auditAttachment(
  tx: Tx,
  actor: Actor,
  spaceId: string,
  attachmentId: string,
  operation: AttachmentOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<void> {
  await writeAudit(tx, { actorId: actor.id, spaceId, objectType: "attachment", objectId: attachmentId, operation, parameters });
}

/** The page as the actor now sees it, read inside the transaction that changed it. */
export async function reread(tx: Tx, actor: Actor, pageId: string): Promise<PageRecord> {
  const page = await getPage(tx, actor.id, pageId);
  if (!page) throw new NotFoundError("Page");
  return page;
}
