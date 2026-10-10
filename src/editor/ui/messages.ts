// What the editor says when something goes wrong: the footer's error line (separate from the
// three save-state strings), the title's own error and the conflict banner. Pure: problems in,
// copy-deck ids and parameters out, so every mapping is unit-tested and no component composes
// user-facing text itself.
// spec: docs/specs/10-ui-reference.md sections 5.1 and 13.3; docs/specs/09-decision-log.md sections RD-055, RD-063
import { type ParamlessCopyId, t } from "@/copy";
import { LIMITS } from "@/domain/documents/limits";
import type { ApiError } from "./api";
import type { DiscardProblem, PublishField, PublishProblem, SaveProblem, SaveState } from "./save-state";

/** A copy-deck string to show, with its parameters. */
export type EditorMessage =
  | { readonly id: ParamlessCopyId; readonly params?: undefined }
  | { readonly id: "editor.save.tooLarge" | "editor.publish.tooLarge"; readonly params: { readonly mib: string } };

/** The text of a message, from the copy deck. */
export function messageText(message: EditorMessage): string {
  switch (message.id) {
    case "editor.save.tooLarge":
      return t("editor.save.tooLarge", message.params);
    case "editor.publish.tooLarge":
      return t("editor.publish.tooLarge", message.params);
    default:
      return t(message.id);
  }
}

const MIB = 1024 * 1024;

/** A byte limit as the MiB number the copy shows: `5`, `2.5`. */
export function mibOf(limit: number | null): string {
  const bytes = limit !== null && Number.isFinite(limit) && limit > 0 ? limit : LIMITS.contentMaxBytes;
  return String(Math.round((bytes / MIB) * 10) / 10);
}

/** The line under the footer while a draft save is failing (the label itself stays `Saving changes`). */
// spec: docs/specs/10-ui-reference.md section 5.1 (save state); RD-055, RD-063
export function saveProblemMessage(problem: SaveProblem): EditorMessage {
  switch (problem.code) {
    case "UNAUTHENTICATED":
      return { id: "editor.save.signedOut" };
    case "FORBIDDEN":
    case "NOT_FOUND":
      return { id: "editor.save.noAccess" };
    case "VALIDATION":
      return { id: "editor.save.invalid" };
    case "TOO_LARGE":
      return { id: "editor.save.tooLarge", params: { mib: mibOf(problem.limit) } };
    default:
      return problem.retrying ? { id: "editor.save.retrying" } : { id: "editor.save.failed" };
  }
}

/** The field a VALIDATION refusal of a publish belongs to, from the problem's `errors[].path`. */
// spec: docs/specs/08-api-surface.md section 3.2 (VALIDATION: errors { path, message }[])
export function publishFieldOf(paths: readonly string[]): PublishField | null {
  const fieldOf = (path: string): PublishField | null => {
    const head = path.split(".")[0];
    return head === "title" || head === "message" || head === "content" ? head : null;
  };
  // A title problem is the one the user can fix in place, so it wins; then the change note.
  const fields = paths.map(fieldOf);
  for (const field of ["title", "message", "content"] as const) {
    if (fields.includes(field)) return field;
  }
  return null;
}

/** A failed publish (anything but VERSION_CONFLICT, which raises the banner) as a PublishProblem. */
// spec: docs/specs/08-api-surface.md section 3.2; RD-055
export function publishProblemOf(error: ApiError): PublishProblem {
  if (error.code === "TITLE_TAKEN") return { code: "TITLE_TAKEN", field: "title", limit: null };
  const field = error.code === "VALIDATION" ? publishFieldOf(error.errors.map((e) => e.path)) : null;
  return { code: error.code, field, limit: error.limit };
}

/** What a failed Update says. */
// spec: docs/specs/10-ui-reference.md section 5.1 (Update); RD-055, RD-056, RD-063, RD-067
export function publishProblemMessage(problem: PublishProblem): EditorMessage {
  switch (problem.code) {
    case "TITLE_EMPTY":
      return { id: "editor.title.empty" };
    case "TITLE_INVALID":
      return { id: "editor.title.invalid" };
    case "TITLE_TAKEN":
      return { id: "editor.title.taken" };
    case "VALIDATION":
      if (problem.field === "title") return { id: "editor.title.invalid" };
      if (problem.field === "message") return { id: "editor.publish.messageInvalid" };
      return { id: "editor.publish.invalid" };
    case "TOO_LARGE":
      return { id: "editor.publish.tooLarge", params: { mib: mibOf(problem.limit) } };
    case "UNAUTHENTICATED":
      return { id: "editor.publish.signedOut" };
    case "FORBIDDEN":
    case "NOT_FOUND":
      return { id: "editor.publish.noAccess" };
    default:
      return { id: "editor.publish.failed" };
  }
}

/** Whether a publish problem belongs under the title field (it is shown there, not in the footer). */
export function isTitleProblem(problem: PublishProblem | null): boolean {
  if (!problem) return false;
  return problem.code === "TITLE_EMPTY" || problem.code === "TITLE_INVALID" || problem.field === "title";
}

/** What a failed Revert or Reload latest says. */
// spec: docs/specs/09-decision-log.md section RD-055 (Revert to last published, Reload latest)
export function discardProblemMessage(problem: DiscardProblem): EditorMessage {
  return problem.action === "revert" ? { id: "editor.revert.failed" } : { id: "editor.reload.failed" };
}

/**
 * Every line the footer shows under the save state, most urgent first: the last action the user
 * took (Update, Revert, Reload), then the background save. A title problem is shown under the
 * title instead.
 */
// spec: docs/specs/10-ui-reference.md section 5.1; RD-055
export function footerMessages(state: SaveState): EditorMessage[] {
  const lines: EditorMessage[] = [];
  if (state.publishProblem && !isTitleProblem(state.publishProblem)) lines.push(publishProblemMessage(state.publishProblem));
  if (state.discardProblem) lines.push(discardProblemMessage(state.discardProblem));
  if (state.saveProblem) lines.push(saveProblemMessage(state.saveProblem));
  return lines;
}

/** The message under the title, or null. */
export function titleMessage(state: SaveState): EditorMessage | null {
  return state.publishProblem && isTitleProblem(state.publishProblem) ? publishProblemMessage(state.publishProblem) : null;
}
