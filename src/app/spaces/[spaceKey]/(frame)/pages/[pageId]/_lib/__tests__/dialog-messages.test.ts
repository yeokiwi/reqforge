// What the `···` menu's dialogs say: every mapped problem code, the copy budget's limit in MiB,
// the delete confirmation's count, the upload prechecks and the size format.
import { describe, expect, it } from "vitest";
import { t } from "@/copy";
import { LIMITS } from "@/domain/documents/limits";
import { ApiError } from "@/ui/api-client";
import {
  copyFailure,
  countFailureMessage,
  deleteConfirmation,
  deleteFailureMessage,
  failureCode,
  formatFileSize,
  hideFailureMessage,
  mibText,
  moveFailureMessage,
  precheckUpload,
  titleProblemMessage,
  uploadFailureMessage,
  uploadRefusalMessage,
} from "../dialog-messages";

const problem = (code: ApiError["code"], extras: { limit?: number; errors?: { path: string; message: string }[] } = {}) =>
  new ApiError(code, 400, extras.errors ?? [], null, extras.limit ?? null);

describe("failureCode", () => {
  it("is the ApiError's code, and UNEXPECTED_RESPONSE for anything else", () => {
    expect(failureCode(problem("CYCLE"))).toBe("CYCLE");
    expect(failureCode(new Error("boom"))).toBe("UNEXPECTED_RESPONSE");
    expect(failureCode("x")).toBe("UNEXPECTED_RESPONSE");
  });
});

describe("sizes", () => {
  it("formats bytes, KiB and MiB in binary units", () => {
    expect(formatFileSize(0)).toBe(t("pageAttachments.size.bytes", { n: "0" }));
    expect(formatFileSize(1023)).toBe(t("pageAttachments.size.bytes", { n: "1,023" }));
    expect(formatFileSize(1024)).toBe(t("pageAttachments.size.kib", { n: "1" }));
    expect(formatFileSize(1536)).toBe(t("pageAttachments.size.kib", { n: "1.5" }));
    expect(formatFileSize(10 * 1024 * 1024)).toBe(t("pageAttachments.size.mib", { n: "10" }));
    expect(formatFileSize(NaN)).toBe(t("pageAttachments.size.bytes", { n: "0" }));
  });

  it("mibText names limits as the decision log states them", () => {
    expect(mibText(LIMITS.attachmentMaxBytes)).toBe("10");
    expect(mibText(52_428_800)).toBe("50");
    expect(mibText(512 * 1024)).toBe("0.5");
  });
});

describe("uploads (RD-058, RD-071)", () => {
  it("refuses empty files and files over 10 MiB before sending; exactly 10 MiB is fine", () => {
    expect(precheckUpload({ size: 0 })).toBe("EMPTY");
    expect(precheckUpload({ size: LIMITS.attachmentMaxBytes + 1 })).toBe("TOO_LARGE");
    expect(precheckUpload({ size: LIMITS.attachmentMaxBytes })).toBeNull();
    expect(precheckUpload({ size: 1 })).toBeNull();
  });

  it("words the browser's refusals", () => {
    expect(uploadRefusalMessage("EMPTY", "a.txt")).toBe(t("pageAttachments.upload.empty", { name: "a.txt" }));
    expect(uploadRefusalMessage("TOO_LARGE", "big.bin")).toBe(t("pageAttachments.upload.tooLarge", { name: "big.bin", mib: "10" }));
  });

  it.each([
    ["TOO_LARGE", t("pageAttachments.upload.tooLarge", { name: "f", mib: "10" })],
    ["UNSUPPORTED_MEDIA", t("pageAttachments.upload.unsupported", { name: "f" })],
    ["VALIDATION", t("pageAttachments.upload.empty", { name: "f" })],
    ["FORBIDDEN", t("pageAttachments.upload.forbidden")],
    ["NOT_FOUND", t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", t("pageView.dialog.signedOut")],
    ["INTERNAL", t("pageAttachments.upload.failed", { name: "f" })],
    ["NETWORK", t("pageAttachments.upload.failed", { name: "f" })],
  ] as const)("server %s", (code, message) => {
    expect(uploadFailureMessage(problem(code), "f")).toBe(message);
  });

  it("TOO_LARGE names the server's limit when it sends one", () => {
    expect(uploadFailureMessage(problem("TOO_LARGE", { limit: 5 * 1024 * 1024 }), "f")).toBe(
      t("pageAttachments.upload.tooLarge", { name: "f", mib: "5" }),
    );
  });

  it.each([
    ["FORBIDDEN", t("pageAttachments.hide.forbidden")],
    ["NOT_FOUND", t("pageAttachments.hide.gone", { name: "f" })],
    ["UNAUTHENTICATED", t("pageView.dialog.signedOut")],
    ["INTERNAL", t("pageAttachments.hide.failed", { name: "f" })],
  ] as const)("hide %s", (code, message) => {
    expect(hideFailureMessage(problem(code), "f")).toBe(message);
  });
});

describe("copy (RD-056, RD-067, RD-074)", () => {
  it("title problems from checkTitle", () => {
    expect(titleProblemMessage("EMPTY")).toBe(t("pageCopy.field.empty"));
    expect(titleProblemMessage("TOO_LONG")).toBe(t("pageCopy.field.invalid", { max: 255 }));
    expect(titleProblemMessage("CONTROL_CHARACTERS")).toBe(t("pageCopy.field.invalid", { max: 255 }));
  });

  it("TITLE_TAKEN and a title VALIDATION go under the field", () => {
    expect(copyFailure(problem("TITLE_TAKEN"))).toEqual({ where: "field", message: t("pageCopy.field.taken") });
    expect(copyFailure(problem("VALIDATION", { errors: [{ path: "title", message: "too long" }] }))).toEqual({
      where: "field",
      message: t("pageCopy.field.invalid", { max: 255 }),
    });
    expect(copyFailure(problem("VALIDATION"))).toMatchObject({ where: "field" });
  });

  it("a VALIDATION about something else is a general failure", () => {
    expect(copyFailure(problem("VALIDATION", { errors: [{ path: "content.content.0", message: "x" }] }))).toEqual({
      where: "alert",
      message: t("pageCopy.failed"),
    });
  });

  it("TOO_LARGE is the copy budget, named in MiB from the error's limit — not the 5 MiB content limit", () => {
    expect(copyFailure(problem("TOO_LARGE", { limit: 52_428_800 }))).toEqual({ where: "alert", message: t("pageCopy.tooLarge", { mib: "50" }) });
    expect(copyFailure(problem("TOO_LARGE"))).toEqual({ where: "alert", message: t("pageCopy.tooLarge.unknown") });
  });

  it.each([
    ["FORBIDDEN", t("pageCopy.forbidden")],
    ["NOT_FOUND", t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", t("pageView.dialog.signedOut")],
    ["INTERNAL", t("pageCopy.failed")],
    ["ORIGIN_MISMATCH", t("pageCopy.failed")],
  ] as const)("%s", (code, message) => {
    expect(copyFailure(problem(code))).toEqual({ where: "alert", message });
  });
});

describe("move (RD-056, RD-070)", () => {
  it.each([
    ["CYCLE", t("pageMove.cycle")],
    ["VALIDATION", t("pageMove.invalid")],
    ["FORBIDDEN", t("pageMove.forbidden")],
    ["NOT_FOUND", t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", t("pageView.dialog.signedOut")],
    ["NETWORK", t("pageMove.failed")],
  ] as const)("%s", (code, message) => {
    expect(moveFailureMessage(problem(code))).toBe(message);
  });
});

describe("delete (RD-056)", () => {
  it("names how many pages will go: the page and every page under it", () => {
    expect(deleteConfirmation(0)).toBe(t("pageDelete.body.leaf"));
    expect(deleteConfirmation(1)).toBe(t("pageDelete.body.oneChild"));
    expect(deleteConfirmation(4)).toBe(t("pageDelete.body.children", { d: "4", n: "5" }));
    expect(deleteConfirmation(1499)).toBe(t("pageDelete.body.children", { d: "1,499", n: "1,500" }));
    expect(deleteConfirmation(4)).toContain("5 pages");
  });

  it("treats a nonsense count as none", () => {
    expect(deleteConfirmation(-3)).toBe(t("pageDelete.body.leaf"));
    expect(deleteConfirmation(NaN)).toBe(t("pageDelete.body.leaf"));
  });

  it.each([
    ["FORBIDDEN", t("pageDelete.forbidden")],
    ["NOT_FOUND", t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", t("pageView.dialog.signedOut")],
    ["INTERNAL", t("pageDelete.failed")],
  ] as const)("%s", (code, message) => {
    expect(deleteFailureMessage(problem(code))).toBe(message);
  });

  it.each([
    ["NOT_FOUND", t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", t("pageView.dialog.signedOut")],
    ["INTERNAL", t("pageDelete.countFailed")],
    ["UNEXPECTED_RESPONSE", t("pageDelete.countFailed")],
  ] as const)("the count could not be read: %s", (code, message) => {
    expect(countFailureMessage(problem(code))).toBe(message);
  });

  it("a count failure that is not an ApiError is the generic count failure", () => {
    expect(countFailureMessage(new TypeError("boom"))).toBe(t("pageDelete.countFailed"));
  });
});
