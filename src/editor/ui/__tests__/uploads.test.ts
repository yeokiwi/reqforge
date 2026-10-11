// @vitest-environment jsdom
// Uploads (RD-058, RD-071): the browser's own checks, the copy each problem code shows, the name a
// nameless pasted image gets, and the placeholder that holds an upload's place while the user
// keeps editing — mapped through edits, never content, never an undo step.
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/domain/documents/limits";
import { addUploadPlaceholder, findUploadPlaceholder, precheckUpload, removeUploadPlaceholder, uploadFailureText, uploadName } from "../uploads";
import { doc, newEditor, p, text } from "./editor-harness";

describe("precheckUpload", () => {
  it("refuses an empty file and one over 10 MiB before sending it; lets the rest through to the server", () => {
    expect(precheckUpload({ size: 0 })).toBe("EMPTY");
    expect(precheckUpload({ size: LIMITS.attachmentMaxBytes + 1 })).toBe("CLIENT_TOO_LARGE");
    expect(precheckUpload({ size: LIMITS.attachmentMaxBytes })).toBeNull();
    expect(precheckUpload({ size: 1 })).toBeNull();
  });
});

describe("uploadFailureText: one copy-deck string per problem (08 §3.2)", () => {
  it("names the file and the limit", () => {
    expect(uploadFailureText("TOO_LARGE", "big.zip", 10 * 1024 * 1024)).toBe('"big.zip" is too large to attach. A file can be at most 10 MiB.');
    expect(uploadFailureText("CLIENT_TOO_LARGE", "big.zip")).toBe('"big.zip" is too large to attach. A file can be at most 10 MiB.');
    expect(uploadFailureText("UNSUPPORTED_MEDIA", "logo.svg")).toBe('"logo.svg" can\'t be attached: this type of file is not allowed.');
    expect(uploadFailureText("EMPTY", "e.txt")).toBe('"e.txt" is empty, so it was not attached.');
    expect(uploadFailureText("UNAUTHENTICATED", "a.png")).toContain("signed out");
    expect(uploadFailureText("FORBIDDEN", "a.png")).toBe("You can no longer add files to this page.");
    expect(uploadFailureText("NOT_FOUND", "a.png")).toBe("You can no longer add files to this page.");
    for (const code of ["NETWORK", "INTERNAL", "VALIDATION", "UNEXPECTED_RESPONSE", "NOT_INSERTED"] as const) {
      expect(uploadFailureText(code, "a.png")).toBe('Couldn\'t attach "a.png". Try again.');
    }
  });

  it("reports the server's limit when it sends one", () => {
    expect(uploadFailureText("TOO_LARGE", "x", 5 * 1024 * 1024)).toContain("5 MiB");
  });
});

describe("uploadName", () => {
  it("keeps a file's name, and names a pasted screenshot after its type", () => {
    expect(uploadName({ name: "plan.pdf", type: "application/pdf" })).toBe("plan.pdf");
    expect(uploadName({ name: "", type: "image/png" })).toBe("image.png");
    expect(uploadName({ name: "  ", type: "image/jpeg" })).toBe("image.jpg");
    expect(uploadName({ name: "", type: "application/octet-stream" })).toBe("file");
  });
});

describe("the upload placeholder", () => {
  it("marks a place that follows edits made before it, and shows `Uploading …` without being content", () => {
    const editor = newEditor(doc(p(text("abc"))));
    editor.view.dispatch(addUploadPlaceholder(editor.state.tr, "u1", 3, "a.png"));
    expect(findUploadPlaceholder(editor.state, "u1")).toBe(3);
    expect(editor.view.dom.querySelector(".rf-upload-placeholder")?.textContent).toBe('Uploading "a.png"…');
    editor.commands.insertContentAt(1, "12345");
    expect(findUploadPlaceholder(editor.state, "u1")).toBe(8);
    expect(JSON.stringify(editor.getJSON())).not.toContain("Uploading");
  });

  it("is not an undo step, and is gone when removed or when its text is deleted", () => {
    const editor = newEditor(doc(p(text("abc")), p(text("def"))));
    editor.view.dispatch(addUploadPlaceholder(editor.state.tr, "u1", 2, "a.png"));
    expect(editor.can().undo()).toBe(false);
    editor.view.dispatch(removeUploadPlaceholder(editor.state.tr, "u1"));
    expect(findUploadPlaceholder(editor.state, "u1")).toBeNull();
    editor.view.dispatch(addUploadPlaceholder(editor.state.tr, "u2", 7, "b.png"));
    editor.commands.deleteRange({ from: 5, to: 10 });
    expect(findUploadPlaceholder(editor.state, "u2")).toBeNull();
  });

  it("keeps several uploads apart", () => {
    const editor = newEditor(doc(p(text("abcdef"))));
    editor.view.dispatch(addUploadPlaceholder(editor.state.tr, "u1", 2, "a"));
    editor.view.dispatch(addUploadPlaceholder(editor.state.tr, "u2", 5, "b"));
    expect(findUploadPlaceholder(editor.state, "u1")).toBe(2);
    expect(findUploadPlaceholder(editor.state, "u2")).toBe(5);
    editor.view.dispatch(removeUploadPlaceholder(editor.state.tr, "u1"));
    expect(findUploadPlaceholder(editor.state, "u2")).toBe(5);
  });
});
