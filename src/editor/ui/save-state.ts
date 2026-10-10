// The editor's save state as a pure reducer: what the footer says (exactly one of the three
// strings `10` §5.1 draws), the separate error line, the conflict banner and whether Update may
// be pressed. Nothing here touches the network, timers or React; the autosave scheduler and the
// editor component turn what happens into events and render what this computes.
//
// Revisions are counted by the autosave scheduler (one per edit) and carried on the events, so
// an edit that lands while a save is in flight is never reported as saved: the label is `saved`
// only once the newest revision has been confirmed.
// spec: docs/specs/10-ui-reference.md section 5.1 (save state); docs/specs/09-decision-log.md section RD-055
import type { CopyId } from "@/copy";
import type { ClientErrorCode } from "./api";

/** The three footer states, verbatim in the copy deck. */
export type SaveLabel = "ready" | "saving" | "saved";

export const SAVE_LABEL_COPY = {
  ready: "editor.state.ready",
  saving: "editor.state.saving",
  saved: "editor.state.saved",
} as const satisfies Record<SaveLabel, CopyId>;

/** Why the last draft save failed, until a save succeeds. */
export interface SaveProblem {
  readonly code: ClientErrorCode;
  /** A retry is scheduled (capped exponential backoff). */
  readonly retrying: boolean;
  /** TOO_LARGE's limit in bytes, when the server sent one. */
  readonly limit: number | null;
}

/** Someone published a version newer than the one this editor opened from (RD-055). */
export interface Conflict {
  /** `draft`: an autosave answered `stale: true`; `publish`: Update answered VERSION_CONFLICT. */
  readonly source: "draft" | "publish";
  readonly currentVersion: number;
}

export type PublishField = "title" | "message" | "content";

/**
 * Why the last Update failed. `TITLE_EMPTY` and `TITLE_INVALID` are the editor's own checks
 * (checkTitle, RD-067), made before anything is sent.
 */
export interface PublishProblem {
  readonly code: ClientErrorCode | "TITLE_EMPTY" | "TITLE_INVALID";
  /** The field the problem belongs to, when it belongs to one. */
  readonly field: PublishField | null;
  readonly limit: number | null;
}

export type DiscardAction = "revert" | "reload";

export interface DiscardProblem {
  readonly action: DiscardAction;
  readonly code: ClientErrorCode;
}

/** What the editor is doing besides editing. Update is enabled only while `editing`. */
export type Activity = "editing" | "publishing" | "published" | "discarding";

export interface SaveState {
  /** Edits made in this editing session (title or content), as numbered by the scheduler. */
  readonly revision: number;
  /** The newest revision the server has confirmed as the draft. */
  readonly savedRevision: number;
  /** The revision being saved right now, or null. */
  readonly inFlight: number | null;
  /** Consecutive failed saves. */
  readonly failures: number;
  readonly saveProblem: SaveProblem | null;
  readonly conflict: Conflict | null;
  readonly activity: Activity;
  readonly publishProblem: PublishProblem | null;
  readonly discardProblem: DiscardProblem | null;
}

export type SaveEvent =
  | { readonly type: "edited"; readonly revision: number; readonly field: "title" | "content" }
  | { readonly type: "saveStarted"; readonly revision: number }
  | { readonly type: "saveSucceeded"; readonly revision: number; readonly stale: boolean; readonly currentVersion: number }
  | {
      readonly type: "saveFailed";
      readonly revision: number;
      readonly code: ClientErrorCode;
      readonly retrying: boolean;
      readonly limit: number | null;
    }
  | { readonly type: "staleDraftFound"; readonly currentVersion: number }
  | { readonly type: "publishStarted" }
  | { readonly type: "publishSucceeded" }
  | { readonly type: "publishFailed"; readonly problem: PublishProblem }
  | { readonly type: "publishConflict"; readonly currentVersion: number }
  | { readonly type: "discardStarted"; readonly action: DiscardAction }
  | { readonly type: "discardFailed"; readonly action: DiscardAction; readonly code: ClientErrorCode }
  /** The editor was reloaded from the current version (Revert, Reload latest): a fresh session. */
  | { readonly type: "reset" };

export const INITIAL_SAVE_STATE: SaveState = Object.freeze({
  revision: 0,
  savedRevision: 0,
  inFlight: null,
  failures: 0,
  saveProblem: null,
  conflict: null,
  activity: "editing",
  publishProblem: null,
  discardProblem: null,
});

function newerConflict(existing: Conflict | null, next: Conflict): Conflict {
  if (!existing) return next;
  // Keep the banner's source once shown; only ever move the version number forward.
  return { source: existing.source, currentVersion: Math.max(existing.currentVersion, next.currentVersion) };
}

/** The save-state transition function. Pure; unknown or out-of-order events never lose an edit. */
// spec: docs/specs/10-ui-reference.md section 5.1 (Ready to go / Saving changes / Changes saved); docs/specs/09-decision-log.md section RD-055
export function saveReducer(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case "edited": {
      const clearTitleProblem = event.field === "title" && state.publishProblem?.field === "title";
      return {
        ...state,
        revision: Math.max(state.revision, event.revision),
        publishProblem: clearTitleProblem ? null : state.publishProblem,
      };
    }
    case "saveStarted":
      return { ...state, inFlight: event.revision };
    case "saveSucceeded": {
      let conflict = state.conflict;
      if (event.stale) conflict = newerConflict(conflict, { source: "draft", currentVersion: event.currentVersion });
      else if (conflict?.source === "draft") conflict = null;
      return {
        ...state,
        inFlight: state.inFlight === event.revision ? null : state.inFlight,
        savedRevision: Math.max(state.savedRevision, event.revision),
        failures: 0,
        saveProblem: null,
        conflict,
      };
    }
    case "saveFailed":
      return {
        ...state,
        inFlight: state.inFlight === event.revision ? null : state.inFlight,
        failures: state.failures + 1,
        saveProblem: { code: event.code, retrying: event.retrying, limit: event.limit },
      };
    case "staleDraftFound":
      return { ...state, conflict: newerConflict(state.conflict, { source: "draft", currentVersion: event.currentVersion }) };
    case "publishStarted":
      return { ...state, activity: "publishing", publishProblem: null, discardProblem: null };
    case "publishSucceeded":
      return { ...state, activity: "published", conflict: null, publishProblem: null };
    case "publishFailed":
      return { ...state, activity: "editing", publishProblem: event.problem };
    case "publishConflict":
      return {
        ...state,
        activity: "editing",
        publishProblem: null,
        conflict: newerConflict(state.conflict, { source: "publish", currentVersion: event.currentVersion }),
      };
    case "discardStarted":
      return { ...state, activity: "discarding", discardProblem: null, publishProblem: null };
    case "discardFailed":
      return { ...state, activity: "editing", discardProblem: { action: event.action, code: event.code } };
    case "reset":
      return INITIAL_SAVE_STATE;
  }
}

/**
 * Which of the three strings the footer shows. `Ready to go` until the first edit; `Saving
 * changes` while any edit is unconfirmed (pending, in flight, or failed and retrying);
 * `Changes saved` once the newest edit is confirmed.
 */
// spec: docs/specs/10-ui-reference.md section 5.1 (save state: exactly three strings)
export function saveLabel(state: SaveState): SaveLabel {
  if (state.revision === 0) return "ready";
  if (state.savedRevision >= state.revision && state.inFlight === null) return "saved";
  return "saving";
}

/** Some edit is not yet confirmed by the server. */
export function hasUnsavedChanges(state: SaveState): boolean {
  return state.revision > state.savedRevision || state.inFlight !== null;
}

/** Update is enabled only while editing: never during a publish, a discard, or after success. */
// spec: docs/specs/10-ui-reference.md section 5.1 (Update); RD-055
export function canPublish(state: SaveState): boolean {
  return state.activity === "editing";
}
