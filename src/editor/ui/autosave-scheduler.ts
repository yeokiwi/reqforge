// When to autosave the draft (RD-055): 1.5 s after the last change, and at least every 10 s
// while changes keep coming; immediately on a flush (blur, tab hidden, Ctrl/Cmd+S, Close).
// At most one save is in flight, so saves cannot arrive out of order and an older draft can
// never overwrite a newer one; an edit made during a save is saved by the next one. A failed
// save is retried with capped exponential backoff while it is worth retrying.
//
// Framework-free with injectable timers, so the rules are unit-tested with fake timers; the
// React hook in use-autosave.ts wires it to the editor and the browser.
// spec: docs/specs/09-decision-log.md section RD-055 (autosaved drafts); docs/specs/10-ui-reference.md section 5.1
import type { DraftResponse } from "@/domain/documents/api-types";
import { AppError } from "@/domain/errors";
import type { ClientErrorCode } from "./api";
import type { SaveEvent } from "./save-state";

/** Why a save was started; the save callback uses it to choose `keepalive` on the way out. */
export type SaveReason = "debounce" | "maxWait" | "retry" | "resume" | "blur" | "hidden" | "shortcut" | "close" | "dispose";

export interface SchedulerTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ErrorClassification {
  readonly code: ClientErrorCode;
  readonly retryable: boolean;
  readonly limit: number | null;
}

export interface AutosaveConfig {
  /** Quiet time after the last change before saving. */
  readonly debounceMs: number;
  /** Longest a change waits while changes keep coming. */
  readonly maxWaitMs: number;
  /** First retry delay after a failure; doubles per consecutive failure. */
  readonly retryBaseMs: number;
  /** Cap on the retry delay. */
  readonly retryMaxMs: number;
}

// spec: docs/specs/09-decision-log.md section RD-055 (autosave). RD-055 names no timings: 1.5 s,
// 10 s and the 2 s → 30 s backoff are this slice's choice, reported for a decision-log entry.
export const AUTOSAVE_CONFIG: AutosaveConfig = Object.freeze({
  debounceMs: 1_500,
  maxWaitMs: 10_000,
  retryBaseMs: 2_000,
  retryMaxMs: 30_000,
});

export interface AutosaveSchedulerOptions {
  /** Saves the editor's state as it is NOW (title, content, base version). */
  readonly save: (reason: SaveReason) => Promise<DraftResponse>;
  /** Receives `edited`, `saveStarted`, `saveSucceeded`, `saveFailed` and `reset` (save-state.ts). */
  readonly emit: (event: SaveEvent) => void;
  readonly classify: (error: unknown) => ErrorClassification;
  readonly timers?: SchedulerTimers;
  readonly config?: Partial<AutosaveConfig>;
}

/** Delay before retry number `failures` (1-based): base, 2×base, 4×base, … capped. */
// spec: docs/specs/09-decision-log.md section RD-055 (autosave; the backoff itself is this slice's choice)
export function retryDelay(failures: number, config: Pick<AutosaveConfig, "retryBaseMs" | "retryMaxMs"> = AUTOSAVE_CONFIG): number {
  const exponent = Math.min(Math.max(0, failures - 1), 30);
  return Math.min(config.retryMaxMs, config.retryBaseMs * 2 ** exponent);
}

const GLOBAL_TIMERS: SchedulerTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

type TimerName = "debounce" | "maxWait" | "retry";

// spec: docs/specs/09-decision-log.md section RD-055 (autosave); docs/specs/10-ui-reference.md section 5.1 (save state)
export class AutosaveScheduler {
  private readonly config: AutosaveConfig;
  private readonly timers: SchedulerTimers;
  private readonly handles: Record<TimerName, unknown> = { debounce: null, maxWait: null, retry: null };

  private revision = 0;
  private savedRevision = 0;
  private failures = 0;
  private inFlight: Promise<void> | null = null;
  /** A save was asked for while one was in flight. */
  private requested = false;
  private paused = false;
  private disposed = false;
  /** Disposed while a save was in flight: save once more afterwards if still dirty. */
  private finalSave = false;

  constructor(private readonly options: AutosaveSchedulerOptions) {
    this.config = { ...AUTOSAVE_CONFIG, ...options.config };
    this.timers = options.timers ?? GLOBAL_TIMERS;
  }

  /** Some edit is not yet confirmed by the server (pending, failed or in flight). */
  get dirty(): boolean {
    return this.revision > this.savedRevision || this.inFlight !== null;
  }

  /** A retry is waiting for its backoff. */
  get backingOff(): boolean {
    return this.handles.retry !== null;
  }

  /** The title or the content changed. */
  change(field: "title" | "content"): void {
    if (this.disposed) return;
    this.revision += 1;
    this.options.emit({ type: "edited", revision: this.revision, field });
    if (this.paused) return;
    this.clearTimer("debounce");
    this.setTimer("debounce", this.config.debounceMs, () => this.trigger("debounce"));
    if (this.handles.maxWait === null) {
      this.setTimer("maxWait", this.config.maxWaitMs, () => this.trigger("maxWait"));
    }
  }

  /**
   * Saves now, bypassing the debounce and any backoff, and waits until every change made so
   * far is saved. Resolves true when nothing is left unsaved, false when a save failed (a
   * retry may then be scheduled) or the scheduler is paused or disposed.
   */
  async flush(reason: SaveReason): Promise<boolean> {
    if (this.disposed || this.paused) return !this.dirty;
    this.clearTimer("debounce");
    this.clearTimer("maxWait");
    while (!this.paused && !this.disposed) {
      if (this.inFlight) {
        await this.inFlight;
        continue;
      }
      if (this.revision <= this.savedRevision) return true;
      this.clearTimer("retry");
      const failuresBefore = this.failures;
      await this.start(reason);
      if (this.failures > failuresBefore) return false;
    }
    return !this.dirty;
  }

  /**
   * Stops saving (Update, Revert and Reload must not race a draft save) and waits for a save
   * already in flight to settle. Changes made while paused are counted and saved on resume.
   */
  async pause(): Promise<void> {
    this.paused = true;
    this.clearAll();
    while (this.inFlight) await this.inFlight;
  }

  /**
   * The editor was reloaded from the server (Revert, Reload latest): everything it now holds is
   * what the server has, so nothing is unsaved. Only while paused, after pause() resolved (so no
   * save is in flight); emits `reset` so the footer returns to `Ready to go`.
   */
  // spec: docs/specs/09-decision-log.md section RD-055 (Revert to last published deletes the draft)
  reset(): void {
    if (this.disposed) return;
    if (!this.paused || this.inFlight) {
      throw new AppError("AUTOSAVE_RESET", "reset() needs the scheduler paused with no save in flight");
    }
    this.clearAll();
    this.revision = 0;
    this.savedRevision = 0;
    this.failures = 0;
    this.requested = false;
    this.finalSave = false;
    this.options.emit({ type: "reset" });
  }

  /** Saving again after pause(); saves at once if anything is unsaved. */
  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    if (this.revision > this.savedRevision) this.trigger("resume");
  }

  /**
   * The editor is going away. Unless paused (after a publish or a discard), a pending change
   * is saved one last time, without retries.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearAll();
    if (this.paused) return;
    if (this.inFlight) this.finalSave = true;
    else if (this.revision > this.savedRevision) void this.start("dispose");
  }

  // ------------------------------------------------------------------------------ internals

  private trigger(reason: SaveReason): void {
    this.clearTimer("debounce");
    this.clearTimer("maxWait");
    if (this.paused || this.disposed) return;
    if (this.inFlight) {
      this.requested = true;
      return;
    }
    if (reason !== "retry" && this.handles.retry !== null) return; // backing off: the retry saves the latest
    void this.start(reason);
  }

  private start(reason: SaveReason): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.revision <= this.savedRevision) return Promise.resolve();
    const revision = this.revision;
    this.requested = false;
    this.options.emit({ type: "saveStarted", revision });
    const attempt = (async () => {
      try {
        const response = await this.options.save(reason);
        this.savedRevision = Math.max(this.savedRevision, revision);
        this.failures = 0;
        this.options.emit({ type: "saveSucceeded", revision, stale: response.stale, currentVersion: response.currentVersion });
      } catch (error) {
        this.failures += 1;
        const failure = this.options.classify(error);
        const retrying = failure.retryable && !this.paused && !this.disposed;
        this.options.emit({ type: "saveFailed", revision, code: failure.code, retrying, limit: failure.limit });
        if (retrying) this.setTimer("retry", retryDelay(this.failures, this.config), () => this.trigger("retry"));
      }
    })();
    const settled = attempt.finally(() => {
      this.inFlight = null;
      this.afterFlight();
    });
    this.inFlight = settled;
    return settled;
  }

  private afterFlight(): void {
    const unsaved = this.revision > this.savedRevision;
    if (this.finalSave) {
      this.finalSave = false;
      if (unsaved) void this.start("dispose");
      return;
    }
    if (this.paused || this.disposed) return;
    if (this.requested && unsaved && this.handles.retry === null) void this.start("debounce");
    this.requested = false;
  }

  private setTimer(name: TimerName, ms: number, callback: () => void): void {
    this.handles[name] = this.timers.setTimeout(() => {
      this.handles[name] = null;
      callback();
    }, ms);
  }

  private clearTimer(name: TimerName): void {
    const handle = this.handles[name];
    if (handle !== null) {
      this.timers.clearTimeout(handle);
      this.handles[name] = null;
    }
  }

  private clearAll(): void {
    this.clearTimer("debounce");
    this.clearTimer("maxWait");
    this.clearTimer("retry");
  }
}
