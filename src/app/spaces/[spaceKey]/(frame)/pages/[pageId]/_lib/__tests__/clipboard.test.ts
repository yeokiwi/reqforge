// @vitest-environment jsdom
// `⇪ Share` copies the link (RD-061): the Clipboard API when there is one, else select-and-copy
// (plain http has no navigator.clipboard), and false only when both fail.
import { afterEach, describe, expect, it, vi } from "vitest";
import { absoluteUrl, copyText, copyWithSelection } from "../clipboard";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** jsdom has no execCommand: give the document one for the test. */
function stubExecCommand(result: boolean | Error) {
  const spy = vi.fn((command: string) => {
    if (result instanceof Error) throw result;
    return command === "copy" && result;
  });
  Object.defineProperty(document, "execCommand", { value: spy, configurable: true, writable: true });
  return spy;
}

describe("copyText", () => {
  it("uses the Clipboard API when it is there", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const exec = stubExecCommand(true);
    await expect(copyText("https://x.test/spaces/TEAM/pages/p1", { clipboard: { writeText }, document })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://x.test/spaces/TEAM/pages/p1");
    expect(exec).not.toHaveBeenCalled();
  });

  it("falls back to select-and-copy when there is no Clipboard API (plain http)", async () => {
    const exec = stubExecCommand(true);
    let selected = "";
    exec.mockImplementation((command: string) => {
      const area = document.querySelector("textarea");
      selected = area ? area.value.slice(area.selectionStart, area.selectionEnd) : "";
      return command === "copy";
    });
    await expect(copyText("https://x.test/p", { clipboard: undefined, document })).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(selected).toBe("https://x.test/p");
    expect(document.querySelector("textarea")).toBeNull(); // cleaned up
  });

  it("falls back when the Clipboard API refuses", async () => {
    const exec = stubExecCommand(true);
    const writeText = vi.fn(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    await expect(copyText("u", { clipboard: { writeText }, document })).resolves.toBe(true);
    expect(exec).toHaveBeenCalledOnce();
  });

  it("is false when both ways fail", async () => {
    stubExecCommand(false);
    const writeText = vi.fn(() => Promise.reject(new Error("no")));
    await expect(copyText("u", { clipboard: { writeText }, document })).resolves.toBe(false);
  });

  it("is false when the fallback throws", async () => {
    stubExecCommand(new Error("SecurityError"));
    await expect(copyText("u", { clipboard: undefined, document })).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("copyWithSelection", () => {
  it("gives focus back to where it was", () => {
    stubExecCommand(true);
    document.body.innerHTML = "<button>Share</button>";
    const share = document.querySelector("button") as HTMLButtonElement;
    share.focus();
    expect(copyWithSelection("u", document)).toBe(true);
    expect(document.activeElement).toBe(share);
  });

  it("is false where the document has no execCommand", () => {
    Object.defineProperty(document, "execCommand", { value: undefined, configurable: true, writable: true });
    expect(copyWithSelection("u", document)).toBe(false);
  });
});

describe("absoluteUrl", () => {
  it("is the page's path on this origin", () => {
    expect(absoluteUrl("/spaces/TEAM/pages/p1", "http://reqforge.lan:3000")).toBe("http://reqforge.lan:3000/spaces/TEAM/pages/p1");
  });
});
