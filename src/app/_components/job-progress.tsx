'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

/**
 * A running job: progress, cancel, and — where the job asks for one — an explicit
 * acknowledgement before the outcome leaves the screen.
 *
 * spec: 03-authoring-and-indexing.md §5 ("job progress with cancel, and an explicit
 * acknowledge step"); 05-baselines-and-diff.md §3.2 (the freeze's progress and cancel).
 * Requirement Yogi's rename ends with an "Acknowledge" exit (research §2.8): a job whose
 * result is a batch of writes should not scroll away unread.
 */

export type JobStatus = {
  state: string;
  progress: number;
  message: string | null;
  error: string | null;
};

const FINISHED = new Set(['DONE', 'FAILED', 'CANCELLED']);

export function JobProgress({
  jobId,
  testId,
  poll,
  onCancel,
  onAcknowledge,
  onFinished,
}: {
  jobId: string;
  testId: string;
  poll: (jobId: string) => Promise<JobStatus | { failed: string }>;
  /** Omitted for a job that cannot be stopped once it has started. */
  onCancel?: (jobId: string) => Promise<{ failed: string } | void>;
  /** Omitted for a job whose outcome needs no acknowledgement. */
  onAcknowledge?: (jobId: string) => Promise<{ failed: string } | void>;
  onFinished?: (status: JobStatus) => void;
}) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, startTransition] = useTransition();

  // Held in a ref rather than read as a dependency: a caller that re-creates the callback
  // on every render would otherwise restart the poll on every tick.
  const notify = useRef(onFinished);
  notify.current = onFinished;

  useEffect(() => {
    let stopped = false;
    setStatus(null);
    setAcknowledged(false);
    setProblem(null);

    const run = async () => {
      // Bounded rather than open-ended: a job that has not moved in four minutes is one
      // the jobs screen should be read for, not one to keep a browser tab spinning on.
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const result = await poll(jobId);
        if (stopped) return;
        if ('failed' in result) {
          setProblem(result.failed);
          return;
        }
        setStatus(result);
        if (FINISHED.has(result.state)) {
          notify.current?.(result);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    };

    void run();
    return () => {
      stopped = true;
    };
  }, [jobId, poll]);

  const cancel = useCallback(() => {
    if (!onCancel) return;
    startTransition(async () => {
      const result = await onCancel(jobId);
      if (result && 'failed' in result) setProblem(result.failed);
    });
  }, [jobId, onCancel]);

  const acknowledge = useCallback(() => {
    if (!onAcknowledge) return;
    startTransition(async () => {
      const result = await onAcknowledge(jobId);
      if (result && 'failed' in result) setProblem(result.failed);
      else setAcknowledged(true);
    });
  }, [jobId, onAcknowledge]);

  if (problem) {
    return (
      <span role="alert" data-testid={`${testId}-error`} className="text-xs text-red-600">
        {problem}
      </span>
    );
  }
  if (!status || acknowledged) return null;

  const finished = FINISHED.has(status.state);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid={testId}>
      <span className="text-[var(--rf-muted)]">
        {status.state.toLowerCase()} — {status.progress}% {status.message ?? ''}
      </span>
      {status.error ? (
        <span role="alert" className="text-red-600">
          {status.error}
        </span>
      ) : null}

      {!finished && onCancel ? (
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          data-testid={`${testId}-cancel`}
          className="rounded border border-[var(--rf-line)] px-2 py-1 disabled:opacity-60"
        >
          Stop and cancel
        </button>
      ) : null}

      {finished && onAcknowledge ? (
        <button
          type="button"
          onClick={acknowledge}
          disabled={pending}
          data-testid={`${testId}-acknowledge`}
          className="rounded bg-[var(--rf-accent)] px-2 py-1 font-medium text-white disabled:opacity-60"
        >
          Acknowledge
        </button>
      ) : null}
    </div>
  );
}
