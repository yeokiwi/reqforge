// The save-state reducer (10 §5.1, RD-055): exactly three footer strings, a separate error
// line, the conflict banner, and Update disabled while a publish is in flight. The rule that
// matters most: an edit made while a save is in flight is never reported as saved.
import { describe, expect, it } from "vitest";
import { t } from "@/copy";
import {
  INITIAL_SAVE_STATE,
  SAVE_LABEL_COPY,
  type SaveEvent,
  type SaveState,
  canPublish,
  hasUnsavedChanges,
  saveLabel,
  saveReducer,
} from "../save-state";

function run(...events: SaveEvent[]): SaveState {
  return events.reduce(saveReducer, INITIAL_SAVE_STATE);
}

const edited = (revision: number, field: "title" | "content" = "content"): SaveEvent => ({ type: "edited", revision, field });
const started = (revision: number): SaveEvent => ({ type: "saveStarted", revision });
const succeeded = (revision: number, stale = false, currentVersion = 3): SaveEvent => ({
  type: "saveSucceeded",
  revision,
  stale,
  currentVersion,
});
const failed = (revision: number, retrying = true, code: "NETWORK" | "VALIDATION" | "TOO_LARGE" = "NETWORK"): SaveEvent => ({
  type: "saveFailed",
  revision,
  code,
  retrying,
  limit: code === "TOO_LARGE" ? 5 * 1024 * 1024 : null,
});

describe("the three footer strings (10 §5.1)", () => {
  it("are exactly the copy deck's Ready to go, Saving changes and Changes saved", () => {
    expect(Object.values(SAVE_LABEL_COPY).map((id) => t(id))).toEqual(["Ready to go", "Saving changes", "Changes saved"]);
  });

  it("starts at Ready to go, with nothing unsaved and Update enabled", () => {
    expect(saveLabel(INITIAL_SAVE_STATE)).toBe("ready");
    expect(hasUnsavedChanges(INITIAL_SAVE_STATE)).toBe(false);
    expect(canPublish(INITIAL_SAVE_STATE)).toBe(true);
  });

  it("any edit, of the title or of the content, moves to Saving changes", () => {
    expect(saveLabel(run(edited(1, "content")))).toBe("saving");
    expect(saveLabel(run(edited(1, "title")))).toBe("saving");
    expect(hasUnsavedChanges(run(edited(1)))).toBe(true);
  });

  it("stays Saving changes while the save is in flight", () => {
    expect(saveLabel(run(edited(1), started(1)))).toBe("saving");
    expect(hasUnsavedChanges(run(edited(1), started(1)))).toBe(true);
  });

  it("a successful save of the newest edit moves to Changes saved", () => {
    const state = run(edited(1), started(1), succeeded(1));
    expect(saveLabel(state)).toBe("saved");
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("the next edit after Changes saved goes back to Saving changes", () => {
    expect(saveLabel(run(edited(1), started(1), succeeded(1), edited(2)))).toBe("saving");
  });
});

describe("edits during an in-flight save are never lost or reported as saved", () => {
  it("an edit made while revision 1 is saving keeps Saving changes after revision 1 succeeds", () => {
    const state = run(edited(1), started(1), edited(2), succeeded(1));
    expect(state.savedRevision).toBe(1);
    expect(state.revision).toBe(2);
    expect(saveLabel(state)).toBe("saving");
    expect(hasUnsavedChanges(state)).toBe(true);
  });

  it("only the save of the newest revision reaches Changes saved", () => {
    const state = run(edited(1), started(1), edited(2), edited(3), succeeded(1), started(3), succeeded(3));
    expect(saveLabel(state)).toBe("saved");
  });

  it("a late or out-of-order success never moves savedRevision backwards", () => {
    const state = run(edited(1), edited(2), started(2), succeeded(2), succeeded(1));
    expect(state.savedRevision).toBe(2);
    expect(saveLabel(state)).toBe("saved");
  });

  it("an edit event with an older revision number never lowers the revision", () => {
    const state = run(edited(3), edited(2));
    expect(state.revision).toBe(3);
  });

  it("a success for a revision other than the one in flight leaves the in-flight marker", () => {
    const state = run(edited(1), edited(2), started(2), succeeded(1));
    expect(state.inFlight).toBe(2);
    expect(saveLabel(state)).toBe("saving");
  });
});

describe("failed saves", () => {
  it("keep Saving changes and record the problem for the separate error line", () => {
    const state = run(edited(1), started(1), failed(1, true));
    expect(saveLabel(state)).toBe("saving");
    expect(state.saveProblem).toEqual({ code: "NETWORK", retrying: true, limit: null });
    expect(state.failures).toBe(1);
    expect(state.inFlight).toBeNull();
  });

  it("count consecutive failures and keep the latest problem", () => {
    const state = run(edited(1), started(1), failed(1), started(1), failed(1, false, "VALIDATION"));
    expect(state.failures).toBe(2);
    expect(state.saveProblem?.code).toBe("VALIDATION");
    expect(state.saveProblem?.retrying).toBe(false);
  });

  it("carry TOO_LARGE's limit", () => {
    expect(run(edited(1), started(1), failed(1, false, "TOO_LARGE")).saveProblem?.limit).toBe(5 * 1024 * 1024);
  });

  it("are cleared by the next success", () => {
    const state = run(edited(1), started(1), failed(1), started(1), succeeded(1));
    expect(state.saveProblem).toBeNull();
    expect(state.failures).toBe(0);
    expect(saveLabel(state)).toBe("saved");
  });
});

describe("conflicts (RD-055)", () => {
  it("a draft save answering stale raises the conflict with the current version", () => {
    const state = run(edited(1), started(1), succeeded(1, true, 7));
    expect(state.conflict).toEqual({ source: "draft", currentVersion: 7 });
    // The draft itself was saved: the label says so; the banner says the rest.
    expect(saveLabel(state)).toBe("saved");
  });

  it("a stale draft found on opening raises it too", () => {
    expect(run({ type: "staleDraftFound", currentVersion: 4 }).conflict).toEqual({ source: "draft", currentVersion: 4 });
  });

  it("a publish answering VERSION_CONFLICT raises it and returns to editing", () => {
    const state = run(edited(1), { type: "publishStarted" }, { type: "publishConflict", currentVersion: 9 });
    expect(state.conflict).toEqual({ source: "publish", currentVersion: 9 });
    expect(state.activity).toBe("editing");
    expect(canPublish(state)).toBe(true);
  });

  it("only ever moves the version forward and keeps the banner's first source", () => {
    const state = run(succeeded(0, true, 8), { type: "publishConflict", currentVersion: 6 });
    expect(state.conflict).toEqual({ source: "draft", currentVersion: 8 });
  });

  it("a fresh (non-stale) draft save clears a draft conflict but not a publish conflict", () => {
    expect(run(succeeded(0, true, 8), succeeded(0, false, 8)).conflict).toBeNull();
    expect(run({ type: "publishConflict", currentVersion: 8 }, succeeded(0, false, 8)).conflict).toEqual({
      source: "publish",
      currentVersion: 8,
    });
  });

  it("is cleared by a successful publish (Overwrite)", () => {
    const state = run({ type: "publishConflict", currentVersion: 8 }, { type: "publishStarted" }, { type: "publishSucceeded" });
    expect(state.conflict).toBeNull();
  });
});

describe("Update", () => {
  it("is disabled while a publish is in flight, and stays disabled after it succeeds", () => {
    const publishing = run(edited(1), { type: "publishStarted" });
    expect(publishing.activity).toBe("publishing");
    expect(canPublish(publishing)).toBe(false);
    const published = saveReducer(publishing, { type: "publishSucceeded" });
    expect(canPublish(published)).toBe(false);
  });

  it("is enabled again after a failed publish, which records the problem", () => {
    const problem = { code: "TITLE_TAKEN" as const, field: "title" as const, limit: null };
    const state = run({ type: "publishStarted" }, { type: "publishFailed", problem });
    expect(canPublish(state)).toBe(true);
    expect(state.publishProblem).toEqual(problem);
  });

  it("a new publish clears the previous publish and discard problems", () => {
    const state = run(
      { type: "publishFailed", problem: { code: "INTERNAL", field: null, limit: null } },
      { type: "discardFailed", action: "revert", code: "NETWORK" },
      { type: "publishStarted" },
    );
    expect(state.publishProblem).toBeNull();
    expect(state.discardProblem).toBeNull();
  });

  it("editing the title clears a title problem; editing the content does not", () => {
    const problem = { code: "TITLE_EMPTY" as const, field: "title" as const, limit: null };
    expect(run({ type: "publishFailed", problem }, edited(1, "content")).publishProblem).toEqual(problem);
    expect(run({ type: "publishFailed", problem }, edited(1, "title")).publishProblem).toBeNull();
  });

  it("editing the title keeps a problem that is not about the title", () => {
    const problem = { code: "TOO_LARGE" as const, field: null, limit: 1 };
    expect(run({ type: "publishFailed", problem }, edited(1, "title")).publishProblem).toEqual(problem);
  });
});

describe("Revert and Reload latest", () => {
  it("disable Update while discarding; a failure records which action failed", () => {
    const discarding = run(edited(1), { type: "discardStarted", action: "reload" });
    expect(discarding.activity).toBe("discarding");
    expect(canPublish(discarding)).toBe(false);
    const failedState = saveReducer(discarding, { type: "discardFailed", action: "reload", code: "NETWORK" });
    expect(failedState.activity).toBe("editing");
    expect(failedState.discardProblem).toEqual({ action: "reload", code: "NETWORK" });
  });

  it("reset returns to a fresh Ready to go with no conflict and no problems", () => {
    const state = run(
      edited(1),
      started(1),
      failed(1),
      { type: "publishConflict", currentVersion: 5 },
      { type: "discardStarted", action: "reload" },
      { type: "reset" },
    );
    expect(state).toEqual(INITIAL_SAVE_STATE);
    expect(saveLabel(state)).toBe("ready");
  });
});

describe("the reducer is pure", () => {
  it("never mutates the state it is given", () => {
    const before = run(edited(1), started(1));
    const snapshot = JSON.stringify(before);
    saveReducer(before, succeeded(1));
    saveReducer(before, failed(1));
    saveReducer(before, { type: "reset" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("the initial state is frozen", () => {
    expect(Object.isFrozen(INITIAL_SAVE_STATE)).toBe(true);
  });
});
