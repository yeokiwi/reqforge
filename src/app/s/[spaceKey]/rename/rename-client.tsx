'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { JobProgress } from '@/app/_components/job-progress';
import { applyTransform, decompose, PREVIEW_LIMIT, type RenameRow } from '@/domain/keys/rename';
import {
  acknowledgeRenameAction,
  cancelRenameAction,
  previewRenameAction,
  renameJobStatusAction,
  startRenameAction,
} from './actions';

/**
 * Batch rename. spec: 03-authoring-and-indexing.md §5 —
 * "decompose selected keys into common prefix + variable middle + common suffix. The user
 * edits the first line; the rest transform live. The preview lists at most 50 with a count
 * of the remainder."
 *
 * The transform itself is pure and lives in `domain/keys/rename.ts`, so it runs here
 * without a round trip and is the same code the server validates with.
 */
export function RenameClient({ spaceKey, keys }: { spaceKey: string; keys: string[] }) {
  const decomposition = useMemo(() => decompose(keys), [keys]);
  const original = `${decomposition.prefix}${decomposition.middles[0] ?? ''}${decomposition.suffix}`;

  const [firstLine, setFirstLine] = useState(original);
  const [rows, setRows] = useState<RenameRow[] | null>(null);
  const [remainder, setRemainder] = useState(0);
  const [problems, setProblems] = useState(0);
  const [runnable, setRunnable] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const transform = useMemo(() => applyTransform(firstLine, decomposition), [firstLine, decomposition]);

  const pairs = useMemo(() => {
    if (!transform.anchored) return keys.map((key, index) => ({ from: key, to: index === 0 ? firstLine : key }));
    return keys.map((key, index) => ({ from: key, to: transform.keys[index] ?? key }));
  }, [firstLine, keys, transform]);

  // The preview is the server's verdict, not the client's: it is the one that knows which
  // keys are already taken and which a locked space forbids.
  const refresh = useCallback(() => {
    startTransition(async () => {
      const result = await previewRenameAction(spaceKey, pairs);
      if (!result.ok) {
        setError(result.error);
        setRows(null);
        return;
      }
      setError(null);
      setRows(result.rows);
      setRemainder(result.remainder);
      setProblems(result.problems);
      setRunnable(result.runnable);
    });
  }, [pairs, spaceKey]);

  useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  const run = () => {
    startTransition(async () => {
      const result = await startRenameAction(spaceKey, pairs);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setDone(null);
      setJobId(result.jobId);
    });
  };

  const unchanged = firstLine === original;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--rf-muted)]">
        {keys.length === 1
          ? 'Renaming one requirement.'
          : `Renaming ${keys.length} requirements. Edit the first line; the rest follow.`}
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New key for {keys[0]}</span>
        <input
          value={firstLine}
          onChange={(event) => setFirstLine(event.target.value)}
          aria-label="New key"
          data-testid="rename-first-line"
          className="w-80 rounded border border-[var(--rf-line)] px-3 py-2 font-mono text-sm"
        />
      </label>

      {!transform.anchored ? (
        <p role="alert" data-testid="rename-not-anchored" className="text-xs text-amber-700">
          {transform.message}
        </p>
      ) : null}

      {error ? (
        <p role="alert" data-testid="rename-error" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
            <th className="w-1/3 pb-2">Now</th>
            <th className="w-1/3 pb-2">Becomes</th>
            <th className="pb-2">Problem</th>
          </tr>
        </thead>
        <tbody data-testid="rename-preview">
          {(rows ?? []).map((row) => (
            <tr key={row.from} className="border-t border-[var(--rf-line)]">
              <td className="py-1.5 font-mono text-xs">{row.from}</td>
              <td className="py-1.5 font-mono text-xs">{row.problem === 'UNCHANGED' ? '—' : row.to}</td>
              <td className="py-1.5 text-xs text-red-600">{row.problem === 'UNCHANGED' ? '' : row.message ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {remainder > 0 ? (
        <p className="text-xs text-[var(--rf-muted)]" data-testid="rename-remainder">
          The first {PREVIEW_LIMIT} are shown; {remainder} more will be renamed the same way.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={run}
          disabled={pending || unchanged || problems > 0 || runnable === 0 || jobId !== null}
          data-testid="rename-run"
          className="rounded bg-[var(--rf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Checking…' : `Rename ${runnable}`}
        </button>
        {problems > 0 ? (
          <span className="text-red-600" data-testid="rename-problems">
            {problems} {problems === 1 ? 'key cannot be used' : 'keys cannot be used'}; fix them before running.
          </span>
        ) : null}
        <Link href={`/s/${spaceKey}/search`} className="text-[var(--rf-muted)]">
          Back to search
        </Link>
      </div>

      {jobId ? (
        <JobProgress
          jobId={jobId}
          testId="rename-job"
          poll={(id) => renameJobStatusAction(spaceKey, id)}
          onCancel={(id) => cancelRenameAction(spaceKey, id)}
          onAcknowledge={async (id) => {
            const result = await acknowledgeRenameAction(spaceKey, id);
            if (result && 'failed' in result) return result;
            setJobId(null);
          }}
          onFinished={(status) => setDone(status.message ?? status.state.toLowerCase())}
        />
      ) : null}

      {done ? (
        <p className="text-xs text-[var(--rf-muted)]" data-testid="rename-outcome">
          {done}
        </p>
      ) : null}
    </div>
  );
}
