// Every refusal of Restore and Delete maps to a copy-deck string by its problem `code` (08 section
// 3.2), with what the screen must do next.
import { describe, expect, it } from "vitest";
import { t } from "@/copy";
import { ApiError } from "@/ui/api-client";
import { deleteFailure, restoreFailure } from "../messages";

const err = (code: ConstructorParameters<typeof ApiError>[0], status: number) => new ApiError(code, status);

describe("restoreFailure", () => {
  it.each([
    ["UNAUTHENTICATED", 401, t("history.signedOut"), false, false],
    ["FORBIDDEN", 403, t("history.restore.forbidden"), true, false],
    ["NOT_FOUND", 404, t("history.gone", { n: 4 }), true, true],
    ["TITLE_TAKEN", 409, t("history.restore.titleTaken", { n: 4 }), false, false],
    ["INTERNAL", 500, t("history.restore.failed", { n: 4 }), false, false],
    ["ORIGIN_MISMATCH", 403, t("history.restore.failed", { n: 4 }), false, false],
    ["NETWORK", 0, t("history.restore.failed", { n: 4 }), false, false],
    ["UNEXPECTED_RESPONSE", 502, t("history.restore.failed", { n: 4 }), false, false],
  ] as const)("%s → its own message", (code, status, text, refresh, drop) => {
    expect(restoreFailure(err(code, status), 4)).toEqual({ text, refresh, drop });
  });

  it("treats a thrown non-ApiError as 'try again'", () => {
    expect(restoreFailure(new Error("boom"), 2).text).toBe("Couldn't restore v. 2. Try again.");
  });
});

describe("deleteFailure", () => {
  it.each([
    ["UNAUTHENTICATED", 401, t("history.signedOut"), false, false],
    ["FORBIDDEN", 403, t("history.delete.forbidden"), true, false],
    ["NOT_FOUND", 404, t("history.gone", { n: 6 }), true, true],
    ["CURRENT_VERSION", 409, t("history.delete.current", { n: 6 }), true, false],
    ["PINNED_VERSION", 409, t("history.delete.pinned", { n: 6 }), true, false],
    ["INTERNAL", 500, t("history.delete.failed", { n: 6 }), false, false],
    ["NETWORK", 0, t("history.delete.failed", { n: 6 }), false, false],
  ] as const)("%s → its own message", (code, status, text, refresh, drop) => {
    expect(deleteFailure(err(code, status), 6)).toEqual({ text, refresh, drop });
  });

  it("names the version in the messages that are about it", () => {
    expect(deleteFailure(err("PINNED_VERSION", 409), 6).text).toBe("v. 6 is pinned by a baseline, so it can't be deleted.");
    expect(deleteFailure(err("NOT_FOUND", 404), 6).text).toBe("v. 6 no longer exists. The page history has been refreshed.");
  });
});
