"use client";

// Wires the autosave scheduler to the browser: flush on window blur, when the tab is hidden
// and on Ctrl/Cmd+S (whose default, the browser's Save Page dialog, is prevented); warn before
// unloading while changes are unsaved; save one last time when the editor unmounts. The
// editor's own blur is wired by the caller (it knows the editor). Alt+Shift+R is never bound
// here: it belongs to the requirement macro (slice 2).
// spec: docs/specs/09-decision-log.md section RD-055 (autosave); docs/specs/10-ui-reference.md section 5.1
import { useEffect, useMemo, useRef } from "react";
import type { DraftResponse } from "@/domain/documents/api-types";
import { isRetryable, toApiError } from "./api";
import { AutosaveScheduler, type AutosaveConfig, type ErrorClassification, type SaveReason, type SchedulerTimers } from "./autosave-scheduler";
import type { SaveEvent } from "./save-state";

export interface UseAutosaveOptions {
  /** Saves the editor's current title and content as the draft. */
  readonly save: (reason: SaveReason) => Promise<DraftResponse>;
  readonly dispatch: (event: SaveEvent) => void;
  readonly timers?: SchedulerTimers;
  readonly config?: Partial<AutosaveConfig>;
}

export interface Autosave {
  /** Record an edit of the title or the content. */
  change(field: "title" | "content"): void;
  /** Save now; true when nothing is left unsaved. */
  flush(reason: SaveReason): Promise<boolean>;
  /** Stop saving and wait for an in-flight save (before Update, Revert, Reload). */
  pause(): Promise<void>;
  resume(): void;
  /** Some change is not yet confirmed by the server. */
  isDirty(): boolean;
}

/** How a failed draft save is reported and whether it is retried by itself. */
export function classifySaveError(error: unknown): ErrorClassification {
  const apiError = toApiError(error);
  return { code: apiError.code, retryable: isRetryable(apiError), limit: apiError.limit };
}

/** Ctrl+S or Cmd+S with no other modifier. */
export function isSaveShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
}

// spec: docs/specs/09-decision-log.md section RD-055 (autosave: debounce, max wait, flush, beforeunload)
export function useAutosave({ save, dispatch, timers, config }: UseAutosaveOptions): Autosave {
  const saveRef = useRef(save);
  const dispatchRef = useRef(dispatch);
  const schedulerRef = useRef<AutosaveScheduler | null>(null);
  const settingsRef = useRef({ timers, config });

  useEffect(() => {
    saveRef.current = save;
    dispatchRef.current = dispatch;
  });

  // One scheduler per mount. Created in the effect (not during render) so that React's
  // development double-mount disposes the first and builds a second, instead of reusing a
  // disposed one.
  useEffect(() => {
    const scheduler = new AutosaveScheduler({
      save: (reason) => saveRef.current(reason),
      emit: (event) => dispatchRef.current(event),
      classify: classifySaveError,
      timers: settingsRef.current.timers,
      config: settingsRef.current.config,
    });
    schedulerRef.current = scheduler;

    const flush = (reason: SaveReason) => void scheduler.flush(reason);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      flush("shortcut");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush("hidden");
    };
    const onWindowBlur = () => flush("blur");
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!scheduler.dirty) return;
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = "";
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, []);

  return useMemo<Autosave>(
    () => ({
      change: (field) => schedulerRef.current?.change(field),
      flush: (reason) => schedulerRef.current?.flush(reason) ?? Promise.resolve(true),
      pause: () => schedulerRef.current?.pause() ?? Promise.resolve(),
      resume: () => schedulerRef.current?.resume(),
      isDirty: () => schedulerRef.current?.dirty ?? false,
    }),
    [],
  );
}
