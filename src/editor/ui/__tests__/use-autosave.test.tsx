// @vitest-environment jsdom
// The browser wiring of autosave (RD-055): Ctrl/Cmd+S saves now and never opens the browser's
// Save dialog; the tab being hidden and the window losing focus save now; leaving with unsaved
// changes warns; unmounting saves one last time. Alt+Shift+R is never bound here (slice 2).
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftResponse } from "@/domain/documents/api-types";
import { ApiError } from "../api";
import type { SaveReason } from "../autosave-scheduler";
import type { SaveEvent } from "../save-state";
import { classifySaveError, isSaveShortcut, useAutosave } from "../use-autosave";

const OK: DraftResponse = { savedAt: "s", stale: false, currentVersion: 1 };

function setup(result: () => Promise<DraftResponse> = () => Promise.resolve(OK)) {
  const reasons: SaveReason[] = [];
  const events: SaveEvent[] = [];
  const hook = renderHook(() =>
    useAutosave({
      save: (reason) => {
        reasons.push(reason);
        return result();
      },
      dispatch: (event) => events.push(event),
    }),
  );
  return { hook, reasons, events, autosave: () => hook.result.current };
}

function key(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("isSaveShortcut", () => {
  it("is Ctrl+S or Cmd+S, either case, with no other modifier", () => {
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "S", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "s", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(false);
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false })).toBe(false);
    expect(isSaveShortcut({ key: "r", ctrlKey: false, metaKey: false, altKey: true, shiftKey: true })).toBe(false);
  });
});

describe("classifySaveError", () => {
  it("reports the code, whether to retry, and TOO_LARGE's limit", () => {
    expect(classifySaveError(new ApiError("NETWORK", 0))).toEqual({ code: "NETWORK", retryable: true, limit: null });
    expect(classifySaveError(new ApiError("TOO_LARGE", 413, [], null, 99))).toEqual({ code: "TOO_LARGE", retryable: false, limit: 99 });
    expect(classifySaveError(new Error("x"))).toEqual({ code: "UNEXPECTED_RESPONSE", retryable: true, limit: null });
  });
});

describe("useAutosave", () => {
  it("debounces edits into one save", async () => {
    const { reasons, autosave } = setup();
    act(() => {
      autosave().change("content");
      autosave().change("title");
    });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(reasons).toEqual(["debounce"]);
  });

  it("Ctrl+S saves now and prevents the browser's Save dialog", async () => {
    const { reasons, autosave } = setup();
    act(() => autosave().change("content"));
    let event: KeyboardEvent | undefined;
    await act(async () => {
      event = key({ key: "s", ctrlKey: true });
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(reasons).toEqual(["shortcut"]);
  });

  it("Cmd+S is prevented even when there is nothing to save", async () => {
    const { reasons } = setup();
    let event: KeyboardEvent | undefined;
    await act(async () => {
      event = key({ key: "s", metaKey: true });
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(reasons).toEqual([]);
  });

  it("Alt+Shift+R is not taken (slice 2 owns it)", async () => {
    setup();
    let event: KeyboardEvent | undefined;
    await act(async () => {
      event = key({ key: "R", altKey: true, shiftKey: true });
    });
    expect(event?.defaultPrevented).toBe(false);
  });

  it("the tab being hidden saves now", async () => {
    const { reasons, autosave } = setup();
    act(() => autosave().change("content"));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    expect(reasons).toEqual(["hidden"]);
  });

  it("the window losing focus saves now", async () => {
    const { reasons, autosave } = setup();
    act(() => autosave().change("content"));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(reasons).toEqual(["blur"]);
  });

  it("warns before unloading while a change is unsaved, and not otherwise", async () => {
    const { autosave } = setup();
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    act(() => autosave().change("content"));
    const warned = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(warned);
    expect(warned.defaultPrevented).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("unmounting saves an unsaved change one last time and removes the listeners", async () => {
    const { hook, reasons, autosave } = setup();
    act(() => autosave().change("content"));
    hook.unmount();
    expect(reasons).toEqual(["dispose"]);
    await act(async () => {
      key({ key: "s", ctrlKey: true });
    });
    expect(reasons).toEqual(["dispose"]);
  });

  it("pause, reset and resume reach the scheduler", async () => {
    const { reasons, events, autosave } = setup();
    act(() => autosave().change("content"));
    await act(() => autosave().pause());
    expect(autosave().isDirty()).toBe(true);
    act(() => autosave().reset());
    expect(autosave().isDirty()).toBe(false);
    expect(events[events.length - 1]).toEqual({ type: "reset" });
    act(() => autosave().resume());
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(reasons).toEqual([]);
  });

  it("returns the same object on every render", () => {
    const { hook } = setup();
    const before = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(before);
  });
});
