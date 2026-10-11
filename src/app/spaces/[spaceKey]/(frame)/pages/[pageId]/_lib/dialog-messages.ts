// What the `···` menu's dialogs say when something fails, and how they write sizes and counts.
// Every failure is decided by the problem's `code` (08 section 3.2), never by the server's text,
// and every word comes from the copy deck (10 section 13.2). Pure, so each mapping is tested
// without rendering.
// spec: docs/specs/08-api-surface.md section 3.2 (error codes); docs/specs/09-decision-log.md sections RD-056, RD-058, RD-067, RD-070, RD-071, RD-074
import { t } from "@/copy";
import { LIMITS } from "@/domain/documents/limits";
import type { TitleProblem } from "@/domain/documents/title";
import { ApiError } from "@/ui/api-client";

const KIB = 1024;
const MIB = 1024 * 1024;
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The problem code of a failed call; anything that is not an ApiError is a client-side surprise. */
export function failureCode(error: unknown): ApiError["code"] {
  return error instanceof ApiError ? error.code : "UNEXPECTED_RESPONSE";
}

/** A byte count as MiB for a sentence ("10", "50", "0.5"). */
export function mibText(bytes: number): string {
  return decimal.format(bytes / MIB);
}

/** An attachment's size: `512 B`, `1.5 KiB`, `10 MiB` (binary units, as the limits are stated). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < KIB) return t("pageAttachments.size.bytes", { n: count.format(Math.max(0, bytes || 0)) });
  if (bytes < MIB) return t("pageAttachments.size.kib", { n: decimal.format(bytes / KIB) });
  return t("pageAttachments.size.mib", { n: decimal.format(bytes / MIB) });
}

// ------------------------------------------------------------------------------ attachments

export type UploadRefusal = "EMPTY" | "TOO_LARGE";

/**
 * What the browser can refuse before sending anything: an empty file, or one over the 10 MiB
 * limit. The server checks both again, with the type checks (SVG) only it can make.
 */
// spec: docs/specs/09-decision-log.md sections RD-058 (up to 10 MiB each) and RD-071 (empty, too large, then SVG)
export function precheckUpload(file: { readonly size: number }): UploadRefusal | null {
  if (file.size === 0) return "EMPTY";
  if (file.size > LIMITS.attachmentMaxBytes) return "TOO_LARGE";
  return null;
}

/** The sentence for an upload the browser refused. */
export function uploadRefusalMessage(refusal: UploadRefusal, name: string): string {
  return refusal === "EMPTY"
    ? t("pageAttachments.upload.empty", { name })
    : t("pageAttachments.upload.tooLarge", { name, mib: mibText(LIMITS.attachmentMaxBytes) });
}

/** The sentence for an upload the server refused (or that never arrived). */
// spec: docs/specs/08-api-surface.md section 3.2 (TOO_LARGE with limit, UNSUPPORTED_MEDIA, VALIDATION); RD-058, RD-071
export function uploadFailureMessage(error: unknown, name: string): string {
  switch (failureCode(error)) {
    case "TOO_LARGE": {
      const limit = error instanceof ApiError && error.limit !== null && error.limit > 0 ? error.limit : LIMITS.attachmentMaxBytes;
      return t("pageAttachments.upload.tooLarge", { name, mib: mibText(limit) });
    }
    case "UNSUPPORTED_MEDIA":
      return t("pageAttachments.upload.unsupported", { name });
    // The server's only VALIDATION for a well-formed upload is an empty file.
    case "VALIDATION":
      return t("pageAttachments.upload.empty", { name });
    case "FORBIDDEN":
      return t("pageAttachments.upload.forbidden");
    case "NOT_FOUND":
      return t("pageView.dialog.gone");
    case "UNAUTHENTICATED":
      return t("pageView.dialog.signedOut");
    default:
      return t("pageAttachments.upload.failed", { name });
  }
}

/** The sentence for a Hide the server refused. NOT_FOUND also means: reload the list. */
// spec: docs/specs/09-decision-log.md section RD-058 (deleting an attachment hides it); 08 section 3.2
export function hideFailureMessage(error: unknown, name: string): string {
  switch (failureCode(error)) {
    case "FORBIDDEN":
      return t("pageAttachments.hide.forbidden");
    case "NOT_FOUND":
      return t("pageAttachments.hide.gone", { name });
    case "UNAUTHENTICATED":
      return t("pageView.dialog.signedOut");
    default:
      return t("pageAttachments.hide.failed", { name });
  }
}

// ------------------------------------------------------------------------------------- copy

/** Where a copy failure is shown: under the title field, or as the dialog's alert. */
export interface CopyFailure {
  readonly where: "field" | "alert";
  readonly message: string;
}

/** The sentence under the title field for a title checkTitle refused (RD-067). */
// spec: docs/specs/09-decision-log.md section RD-067 (EMPTY, CONTROL_CHARACTERS, TOO_LONG); 07 section 4 (Page title)
export function titleProblemMessage(problem: TitleProblem): string {
  return problem === "EMPTY" ? t("pageCopy.field.empty") : t("pageCopy.field.invalid", { max: LIMITS.titleMax });
}

/**
 * A refused copy. Title problems (TITLE_TAKEN, VALIDATION at `title`) go under the field; the
 * copy budget (TOO_LARGE, RD-074: the images the page shows, at most 50 MiB in all — not the
 * 5 MiB content limit) names the limit the server sent.
 */
// spec: docs/specs/09-decision-log.md sections RD-056 (titles unique per space), RD-067, RD-074 (copy budget: 413 TOO_LARGE with limit); 08 section 3.2
export function copyFailure(error: unknown): CopyFailure {
  const alert = (message: string): CopyFailure => ({ where: "alert", message });
  switch (failureCode(error)) {
    case "TITLE_TAKEN":
      return { where: "field", message: t("pageCopy.field.taken") };
    case "VALIDATION": {
      const issues = error instanceof ApiError ? error.errors : [];
      const aboutTitle = issues.length === 0 || issues.some((issue) => issue.path === "title" || issue.path.startsWith("title."));
      return aboutTitle ? { where: "field", message: titleProblemMessage("TOO_LONG") } : alert(t("pageCopy.failed"));
    }
    case "TOO_LARGE": {
      const limit = error instanceof ApiError ? error.limit : null;
      return alert(limit !== null && limit > 0 ? t("pageCopy.tooLarge", { mib: mibText(limit) }) : t("pageCopy.tooLarge.unknown"));
    }
    case "FORBIDDEN":
      return alert(t("pageCopy.forbidden"));
    case "NOT_FOUND":
      return alert(t("pageView.dialog.gone"));
    case "UNAUTHENTICATED":
      return alert(t("pageView.dialog.signedOut"));
    default:
      return alert(t("pageCopy.failed"));
  }
}

// ------------------------------------------------------------------------------------- move

/** A refused move. VALIDATION is a tree that would be too deep, or a parent that has gone (RD-070). */
// spec: docs/specs/09-decision-log.md sections RD-056 (no cycles), RD-070 (too deep, unknown parent: VALIDATION at parentId); 08 section 3.2
export function moveFailureMessage(error: unknown): string {
  switch (failureCode(error)) {
    case "CYCLE":
      return t("pageMove.cycle");
    case "VALIDATION":
      return t("pageMove.invalid");
    case "FORBIDDEN":
      return t("pageMove.forbidden");
    case "NOT_FOUND":
      return t("pageView.dialog.gone");
    case "UNAUTHENTICATED":
      return t("pageView.dialog.signedOut");
    default:
      return t("pageMove.failed");
  }
}

// ----------------------------------------------------------------------------------- delete

/**
 * The confirmation's sentence: it names how many pages will go — the page and every live
 * descendant (PageDetail.descendantCount), because deleting takes the subtree.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (deleting is soft and takes the subtree; the confirmation names how many pages will go)
export function deleteConfirmation(descendantCount: number): string {
  const below = Number.isFinite(descendantCount) ? Math.max(0, Math.floor(descendantCount)) : 0;
  if (below === 0) return t("pageDelete.body.leaf");
  if (below === 1) return t("pageDelete.body.oneChild");
  return t("pageDelete.body.children", { d: count.format(below), n: count.format(below + 1) });
}

/** A refused delete. */
// spec: docs/specs/08-api-surface.md section 3.2; docs/specs/07-permissions-and-limits.md section 2.4 (EDIT)
export function deleteFailureMessage(error: unknown): string {
  switch (failureCode(error)) {
    case "FORBIDDEN":
      return t("pageDelete.forbidden");
    case "NOT_FOUND":
      return t("pageView.dialog.gone");
    case "UNAUTHENTICATED":
      return t("pageView.dialog.signedOut");
    default:
      return t("pageDelete.failed");
  }
}
