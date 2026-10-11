// What Page History says when a Restore or Delete is refused (10 section 23, RD-060, 08 section
// 3.2). Branches on the problem's stable `code`, never on its text, and answers with a copy-deck
// string plus what the screen should do next: refresh the list (the refusal means the list the
// user is looking at is out of date) and drop the version from the compare selection (it is gone).
// spec: docs/specs/08-api-surface.md section 3.2 (error codes); docs/specs/09-decision-log.md section RD-060
import { t } from "@/copy";
import { ApiError } from "@/ui/api-client";

export interface FailureOutcome {
  /** The alert's text. */
  readonly text: string;
  /** Re-render the history from the server: what the user sees no longer matches it. */
  readonly refresh: boolean;
  /** The version no longer exists: take it out of the compare selection. */
  readonly drop: boolean;
}

const codeOf = (error: unknown): string => (error instanceof ApiError ? error.code : "UNKNOWN");

/**
 * A refused `POST …/versions/{n}/restore`. Restore needs space EDIT (FORBIDDEN), the version must
 * still exist (NOT_FOUND) and the old title must still be free (TITLE_TAKEN, RD-056). Anything
 * else — a network failure, a 500 — is "try again".
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Restore needs EDIT); 08 section 3.2
export function restoreFailure(error: unknown, version: number): FailureOutcome {
  switch (codeOf(error)) {
    case "UNAUTHENTICATED":
      return { text: t("history.signedOut"), refresh: false, drop: false };
    case "FORBIDDEN":
      return { text: t("history.restore.forbidden"), refresh: true, drop: false };
    case "NOT_FOUND":
      return { text: t("history.gone", { n: version }), refresh: true, drop: true };
    case "TITLE_TAKEN":
      return { text: t("history.restore.titleTaken", { n: version }), refresh: false, drop: false };
    default:
      return { text: t("history.restore.failed", { n: version }), refresh: false, drop: false };
  }
}

/**
 * A refused `DELETE …/versions/{n}`. Delete needs space ADMIN (FORBIDDEN) and refuses the current
 * version (CURRENT_VERSION) and a version pinned by a baseline (PINNED_VERSION, invariant D2).
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Delete: non-current, non-pinned, ADMIN); 08 section 3.2
export function deleteFailure(error: unknown, version: number): FailureOutcome {
  switch (codeOf(error)) {
    case "UNAUTHENTICATED":
      return { text: t("history.signedOut"), refresh: false, drop: false };
    case "FORBIDDEN":
      return { text: t("history.delete.forbidden"), refresh: true, drop: false };
    case "NOT_FOUND":
      return { text: t("history.gone", { n: version }), refresh: true, drop: true };
    case "CURRENT_VERSION":
      return { text: t("history.delete.current", { n: version }), refresh: true, drop: false };
    case "PINNED_VERSION":
      return { text: t("history.delete.pinned", { n: version }), refresh: true, drop: false };
    default:
      return { text: t("history.delete.failed", { n: version }), refresh: false, drop: false };
  }
}
