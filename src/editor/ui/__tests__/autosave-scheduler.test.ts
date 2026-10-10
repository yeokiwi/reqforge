// When the draft is saved (RD-055): 1.5 s after the last change, at most 10 s after the first
// unsaved one while changes keep coming, at once on a flush; one save in flight at a time; an
// edit made during a save is saved by the next one; a failure is retried with capped
// exponential backoff. The events the scheduler emits are fed through the real reducer, so the
// footer string each scenario would show is checked too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftResponse } from "@/domain/documents/api-types";
import { AUTOSAVE_CONFIG, AutosaveScheduler, type ErrorClassification, type SaveReason, retryDelay } from "../autosave-scheduler";
import { INITIAL_SAVE_STATE, type SaveEvent, saveLabel, saveReducer } from "../save-state";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OK: DraftResponse = { savedAt: "2026-10-10T00:00:00.000Z", stale: false, currentVersion: 3 };
const RETRYABLE: ErrorClassification = { code: "NETWORK", retryable: true, limit: null };
const FINAL: ErrorClassification = { code: "VALIDATION", retryable: false, limit: null };

function harness(classification: ErrorClassification = RETRYABLE) {
  const calls: { reason: SaveReason; result: Deferred<DraftResponse> }[] = [];
  const events: SaveEvent[] = [];
  const scheduler = new AutosaveScheduler({
    save: (reason) => {
      const result = deferred<DraftResponse>();
      calls.push({ reason, result });
      return result.promise;
    },
    emit: (event) => events.push(event),
    classify: () => classification,
  });
  const last = () => {
    const call = calls[calls.length - 1];
    if (!call) throw new Error("no save was started");
    return call.result;
  };
  return {
    scheduler,
    calls,
    events,
    last,
    label: () => saveLabel(events.reduce(saveReducer, INITIAL_SAVE_STATE)),
  };
}

/** Lets settled promises run their continuations. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the configuration", () => {
  it("is 1.5 s debounce, 10 s max wait, retries from 2 s doubling to 30 s", () => {
    expect(AUTOSAVE_CONFIG).toEqual({ debounceMs: 1500, maxWaitMs: 10000, retryBaseMs: 2000, retryMaxMs: 30000 });
  });

  it("retryDelay doubles per consecutive failure and is capped", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map((n) => retryDelay(n))).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
    expect(retryDelay(0)).toBe(2000);
  });
});

describe("debounce", () => {
  it("saves 1.5 s after the last change, not before", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1499);
    expect(h.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.map((c) => c.reason)).toEqual(["debounce"]);
  });

  it("restarts the wait on every change", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1000);
    h.scheduler.change("title");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.calls).toHaveLength(1);
  });

  it("goes Ready to go → Saving changes → Changes saved", async () => {
    const h = harness();
    expect(h.label()).toBe("ready");
    h.scheduler.change("content");
    expect(h.label()).toBe("saving");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.label()).toBe("saving");
    h.last().resolve(OK);
    await settle();
    expect(h.label()).toBe("saved");
    expect(h.scheduler.dirty).toBe(false);
  });
});

describe("max wait", () => {
  it("saves at 10 s while changes keep coming every second", async () => {
    const h = harness();
    for (let i = 0; i < 9; i++) {
      h.scheduler.change("content");
      await vi.advanceTimersByTimeAsync(1000);
    }
    h.scheduler.change("content");
    expect(h.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.calls.map((c) => c.reason)).toEqual(["maxWait"]);
  });

  it("starts a new max-wait window after a save", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.last().resolve(OK);
    await settle();
    for (let i = 0; i < 10; i++) {
      h.scheduler.change("content");
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(h.calls.map((c) => c.reason)).toEqual(["debounce", "maxWait"]);
  });
});

describe("flush", () => {
  it("saves at once, bypassing the debounce, and resolves true when saved", async () => {
    const h = harness();
    h.scheduler.change("content");
    const flushed = h.scheduler.flush("shortcut");
    expect(h.calls.map((c) => c.reason)).toEqual(["shortcut"]);
    h.last().resolve(OK);
    await expect(flushed).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.calls).toHaveLength(1); // the debounce was cancelled
  });

  it("resolves true without saving when nothing is unsaved", async () => {
    const h = harness();
    await expect(h.scheduler.flush("blur")).resolves.toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("resolves false when the save fails", async () => {
    const h = harness();
    h.scheduler.change("content");
    const flushed = h.scheduler.flush("close");
    h.last().reject(new Error("offline"));
    await expect(flushed).resolves.toBe(false);
    expect(h.scheduler.dirty).toBe(true);
  });

  it("waits for a save in flight, then saves the edits made during it", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.scheduler.change("content"); // revision 2, during the save of revision 1
    const flushed = h.scheduler.flush("close");
    expect(h.calls).toHaveLength(1); // never two in flight
    h.calls[0]?.result.resolve(OK);
    await settle();
    expect(h.calls).toHaveLength(2);
    h.calls[1]?.result.resolve(OK);
    await expect(flushed).resolves.toBe(true);
    expect(h.label()).toBe("saved");
  });

  it("saves at once during a retry backoff", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.last().reject(new Error("offline"));
    await settle();
    expect(h.scheduler.backingOff).toBe(true);
    const flushed = h.scheduler.flush("hidden");
    expect(h.calls.map((c) => c.reason)).toEqual(["debounce", "hidden"]);
    h.last().resolve(OK);
    await expect(flushed).resolves.toBe(true);
    expect(h.scheduler.backingOff).toBe(false);
  });
});

describe("edits during an in-flight save", () => {
  it("are saved by the next save, never by a second concurrent one", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.calls).toHaveLength(1);
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500); // the debounce fires while revision 1 is in flight
    expect(h.calls).toHaveLength(1);
    expect(h.label()).toBe("saving");
    h.calls[0]?.result.resolve(OK);
    await settle();
    // Revision 1 is saved but revision 2 is not: still Saving changes, and the next save starts at once.
    expect(h.calls).toHaveLength(2);
    expect(h.label()).toBe("saving");
    h.calls[1]?.result.resolve(OK);
    await settle();
    expect(h.label()).toBe("saved");
  });

  it("are not reported as saved when the in-flight save of an older revision succeeds", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.scheduler.change("title"); // debounce still pending when the save returns
    h.calls[0]?.result.resolve(OK);
    await settle();
    expect(h.label()).toBe("saving");
    expect(h.scheduler.dirty).toBe(true);
    expect(h.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.calls).toHaveLength(2);
  });

  it("each save reports the revision it carried", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.scheduler.change("content");
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.calls[0]?.result.resolve(OK);
    await settle();
    h.calls[1]?.result.resolve(OK);
    await settle();
    const started = h.events.filter((e) => e.type === "saveStarted").map((e) => (e.type === "saveStarted" ? e.revision : 0));
    expect(started).toEqual([1, 3]);
  });
});

describe("retry with capped exponential backoff", () => {
  it("retries a retryable failure after 2 s, 4 s, 8 s, 16 s, then every 30 s", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    const expected = [2000, 4000, 8000, 16000, 30000, 30000];
    for (const delay of expected) {
      const before = h.calls.length;
      h.last().reject(new Error("offline"));
      await settle();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.calls.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.calls.length).toBe(before + 1);
      expect(h.last()).toBeDefined();
      expect(h.calls[h.calls.length - 1]?.reason).toBe("retry");
    }
  });

  it("keeps Saving changes while failing, with the problem marked retrying", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.last().reject(new Error("offline"));
    await settle();
    const state = h.events.reduce(saveReducer, INITIAL_SAVE_STATE);
    expect(saveLabel(state)).toBe("saving");
    expect(state.saveProblem).toEqual({ code: "NETWORK", retrying: true, limit: null });
  });

  it("an edit during the backoff waits for the retry, which saves the newest state", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.last().reject(new Error("offline"));
    await settle();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.calls).toHaveLength(1); // no early save while backing off
    await vi.advanceTimersByTimeAsync(500);
    expect(h.calls.map((c) => c.reason)).toEqual(["debounce", "retry"]);
    h.last().resolve(OK);
    await settle();
    expect(h.label()).toBe("saved");
  });

  it("does not retry a failure that is not worth retrying; the next edit saves again", async () => {
    const h = harness(FINAL);
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.last().reject(new Error("422"));
    await settle();
    expect(h.scheduler.backingOff).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.calls).toHaveLength(1);
    expect(h.events.filter((e) => e.type === "saveFailed")).toEqual([
      { type: "saveFailed", revision: 1, code: "VALIDATION", retrying: false, limit: null },
    ]);
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.calls).toHaveLength(2);
  });

  it("the failure count resets after a success", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.last().reject(new Error("offline"));
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    h.last().resolve(OK);
    await settle();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.last().reject(new Error("offline"));
    await settle();
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls).toHaveLength(4); // back to the first delay, 2 s
  });
});

describe("pause, resume and reset (Update, Revert, Reload latest)", () => {
  it("pause waits for the save in flight and stops saving; resume saves what changed meanwhile", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    let paused = false;
    const pausing = h.scheduler.pause().then(() => {
      paused = true;
    });
    await settle();
    expect(paused).toBe(false);
    h.last().resolve(OK);
    await pausing;
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.calls).toHaveLength(1);
    h.scheduler.resume();
    expect(h.calls.map((c) => c.reason)).toEqual(["debounce", "resume"]);
  });

  it("a failure while pausing is not retried", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    const pausing = h.scheduler.pause();
    h.last().reject(new Error("offline"));
    await pausing;
    expect(h.scheduler.backingOff).toBe(false);
  });

  it("flush while paused saves nothing and reports whether anything is unsaved", async () => {
    const h = harness();
    await h.scheduler.pause();
    h.scheduler.change("content");
    await expect(h.scheduler.flush("close")).resolves.toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it("reset forgets every unsaved change, emits reset, and refuses to run unpaused", async () => {
    const h = harness();
    h.scheduler.change("content");
    expect(() => h.scheduler.reset()).toThrow();
    await h.scheduler.pause();
    h.scheduler.reset();
    expect(h.scheduler.dirty).toBe(false);
    expect(h.events[h.events.length - 1]).toEqual({ type: "reset" });
    expect(h.label()).toBe("ready");
    h.scheduler.resume();
    expect(h.calls).toHaveLength(0);
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.events.find((e) => e.type === "saveStarted" && e.revision === 1)).toBeDefined();
  });
});

describe("dispose (the editor unmounts)", () => {
  it("saves an unsaved change one last time", async () => {
    const h = harness();
    h.scheduler.change("content");
    h.scheduler.dispose();
    expect(h.calls.map((c) => c.reason)).toEqual(["dispose"]);
    h.last().reject(new Error("offline"));
    await settle();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.calls).toHaveLength(1); // no retries after dispose
  });

  it("waits for a save in flight, then saves what changed during it", async () => {
    const h = harness();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(1500);
    h.scheduler.change("content");
    h.scheduler.dispose();
    expect(h.calls).toHaveLength(1);
    h.calls[0]?.result.resolve(OK);
    await settle();
    expect(h.calls.map((c) => c.reason)).toEqual(["debounce", "dispose"]);
  });

  it("saves nothing after a publish or a discard paused it", async () => {
    const h = harness();
    await h.scheduler.pause();
    h.scheduler.change("content");
    h.scheduler.dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.calls).toHaveLength(0);
  });

  it("ignores changes after dispose", async () => {
    const h = harness();
    h.scheduler.dispose();
    h.scheduler.change("content");
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.calls).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });
});
