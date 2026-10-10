// What the editor says when something fails: every problem maps to a copy-deck string (13.3),
// title problems go under the title, everything else to the footer line.
import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import {
  discardProblemMessage,
  footerMessages,
  isTitleProblem,
  messageText,
  mibOf,
  publishFieldOf,
  publishProblemMessage,
  publishProblemOf,
  saveProblemMessage,
  titleMessage,
} from "../messages";
import { INITIAL_SAVE_STATE, type PublishProblem, type SaveState } from "../save-state";

const MIB = 1024 * 1024;

describe("draft save problems", () => {
  it.each([
    [{ code: "UNAUTHENTICATED", retrying: true, limit: null }, "You've been signed out. Sign in again in another tab and your changes will be saved."],
    [{ code: "FORBIDDEN", retrying: false, limit: null }, "You can no longer edit this page, so your changes can't be saved."],
    [{ code: "NOT_FOUND", retrying: false, limit: null }, "You can no longer edit this page, so your changes can't be saved."],
    [{ code: "VALIDATION", retrying: false, limit: null }, "Your changes can't be saved because some of the content isn't valid."],
    [{ code: "TOO_LARGE", retrying: false, limit: 5 * MIB }, "This page is too large to save. The limit is 5 MiB."],
    [{ code: "NETWORK", retrying: true, limit: null }, "Couldn't save your changes. Trying again…"],
    [{ code: "INTERNAL", retrying: true, limit: null }, "Couldn't save your changes. Trying again…"],
    [{ code: "ORIGIN_MISMATCH", retrying: false, limit: null }, "Couldn't save your changes."],
  ] as const)("%o says %s", (problem, text) => {
    expect(messageText(saveProblemMessage(problem))).toBe(text);
  });
});

describe("publish problems", () => {
  const p = (code: PublishProblem["code"], field: PublishProblem["field"] = null, limit: number | null = null): PublishProblem => ({
    code,
    field,
    limit,
  });

  it.each([
    [p("TITLE_EMPTY", "title"), "Give this page a title before you publish it."],
    [p("TITLE_INVALID", "title"), "This title can't be used. Use at most 255 characters, with no line breaks or control characters."],
    [p("TITLE_TAKEN", "title"), "Another page in this space already has this title."],
    [p("VALIDATION", "title"), "This title can't be used. Use at most 255 characters, with no line breaks or control characters."],
    [p("VALIDATION", "message"), "Keep the change note to 500 characters or fewer."],
    [p("VALIDATION", "content"), "This page can't be published because some of the content isn't valid."],
    [p("VALIDATION"), "This page can't be published because some of the content isn't valid."],
    [p("TOO_LARGE", null, 2.5 * MIB), "This page is too large to publish. The limit is 2.5 MiB."],
    [p("UNAUTHENTICATED"), "You've been signed out. Sign in again in another tab, then press Update."],
    [p("FORBIDDEN"), "You can no longer edit this page."],
    [p("NOT_FOUND"), "You can no longer edit this page."],
    [p("NETWORK"), "Couldn't publish this page. Try again."],
    [p("INTERNAL"), "Couldn't publish this page. Try again."],
  ])("%o says %s", (problem, text) => {
    expect(messageText(publishProblemMessage(problem))).toBe(text);
  });

  it("the field of a VALIDATION refusal comes from the error paths; title wins, then message", () => {
    expect(publishFieldOf(["content.content.0.attrs.src"])).toBe("content");
    expect(publishFieldOf(["message"])).toBe("message");
    expect(publishFieldOf(["content.0", "title"])).toBe("title");
    expect(publishFieldOf(["content.0", "message"])).toBe("message");
    expect(publishFieldOf(["baseVersion"])).toBeNull();
    expect(publishFieldOf([])).toBeNull();
    expect(publishFieldOf(["titles"])).toBeNull();
  });

  it("publishProblemOf maps an ApiError", () => {
    expect(publishProblemOf(new ApiError("TITLE_TAKEN", 409))).toEqual({ code: "TITLE_TAKEN", field: "title", limit: null });
    expect(publishProblemOf(new ApiError("VALIDATION", 422, [{ path: "message", message: "too long" }]))).toEqual({
      code: "VALIDATION",
      field: "message",
      limit: null,
    });
    expect(publishProblemOf(new ApiError("TOO_LARGE", 413, [], null, 5 * MIB))).toEqual({ code: "TOO_LARGE", field: null, limit: 5 * MIB });
    expect(publishProblemOf(new ApiError("NETWORK", 0))).toEqual({ code: "NETWORK", field: null, limit: null });
  });

  it("title problems are the title's", () => {
    expect(isTitleProblem(p("TITLE_EMPTY", "title"))).toBe(true);
    expect(isTitleProblem(p("TITLE_TAKEN", "title"))).toBe(true);
    expect(isTitleProblem(p("VALIDATION", "title"))).toBe(true);
    expect(isTitleProblem(p("VALIDATION", "message"))).toBe(false);
    expect(isTitleProblem(null)).toBe(false);
  });
});

describe("discard problems", () => {
  it("name the action that failed", () => {
    expect(messageText(discardProblemMessage({ action: "revert", code: "NETWORK" }))).toBe(
      "Couldn't revert to the last published version. Try again.",
    );
    expect(messageText(discardProblemMessage({ action: "reload", code: "NETWORK" }))).toBe("Couldn't load the latest version. Try again.");
  });
});

describe("where messages go", () => {
  const state = (patch: Partial<SaveState>): SaveState => ({ ...INITIAL_SAVE_STATE, ...patch });

  it("nothing wrong, nothing shown", () => {
    expect(footerMessages(INITIAL_SAVE_STATE)).toEqual([]);
    expect(titleMessage(INITIAL_SAVE_STATE)).toBeNull();
  });

  it("publish, then discard, then save problems, in the footer", () => {
    const lines = footerMessages(
      state({
        publishProblem: { code: "INTERNAL", field: null, limit: null },
        discardProblem: { action: "reload", code: "NETWORK" },
        saveProblem: { code: "NETWORK", retrying: true, limit: null },
      }),
    );
    expect(lines.map((m) => m.id)).toEqual(["editor.publish.failed", "editor.reload.failed", "editor.save.retrying"]);
  });

  it("a title problem goes under the title, not in the footer", () => {
    const s = state({ publishProblem: { code: "TITLE_TAKEN", field: "title", limit: null } });
    expect(footerMessages(s)).toEqual([]);
    expect(titleMessage(s)?.id).toBe("editor.title.taken");
  });
});

describe("mibOf", () => {
  it("shows a byte limit in MiB, falling back to the content limit", () => {
    expect(mibOf(5 * MIB)).toBe("5");
    expect(mibOf(10 * MIB)).toBe("10");
    expect(mibOf(1.25 * MIB)).toBe("1.3");
    expect(mibOf(null)).toBe("5");
    expect(mibOf(-1)).toBe("5");
  });
});
