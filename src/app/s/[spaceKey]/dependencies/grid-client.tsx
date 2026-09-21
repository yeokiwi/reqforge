'use client';

import { useCallback, useState, useTransition } from 'react';
import { cellKey } from '@/domain/traceability/dependency-matrix';
import { QueryUnderline } from '../search/query-underline';
import type { JobView } from '../traceability/actions';
import { exportDependencyMatrixAction, runDependencyMatrixAction, type GridResponse } from './actions';

export function GridClient({ spaceKey }: { spaceKey: string }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [response, setResponse] = useState<GridResponse | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(() => {
    setSubmitted(query);
    setJob(null);
    startTransition(async () => {
      setResponse(await runDependencyMatrixAction(spaceKey, query));
    });
  }, [query, spaceKey]);

  const exportGrid = () => {
    setJobError(null);
    startTransition(async () => {
      const result = await exportDependencyMatrixAction(spaceKey, submitted || query);
      if (!('id' in result)) {
        setJobError(result.error);
        return;
      }
      setJob(result);
    });
  };

  const cells = response?.ok ? new Map(response.cells) : new Map<string, string[]>();
  const initialsOfCell = (from: string, to: string) => {
    const names = cells.get(cellKey(from, to)) ?? [];
    if (!response?.ok || names.length === 0) return { text: '', title: '' };
    const byName = new Map(response.legend.map((entry) => [entry.relationship, entry.initials]));
    return {
      text: names.map((name) => byName.get(name) ?? name.slice(0, 2).toUpperCase()).join(' '),
      title: names.join(', '),
    };
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Grid query"
          placeholder="key ~ 'FN-%'"
          className="flex-1 rounded border border-[var(--rf-line)] px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[var(--rf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Building…' : 'Run'}
        </button>
      </form>

      {response && !response.ok && 'refusal' in response ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="grid-refusal">
          <p className="text-sm text-amber-900">{response.refusal.message}</p>
          {response.refusal.reason === 'over-cap' ? (
            <button
              type="button"
              onClick={exportGrid}
              className="mt-2 rounded bg-[var(--rf-accent)] px-3 py-1 text-xs font-medium text-white"
            >
              Export the full matrix instead
            </button>
          ) : null}
        </div>
      ) : null}

      {response && !response.ok && 'errors' in response ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="grid-errors">
          {response.errors.map((diagnostic, index) => (
            <QueryUnderline
              key={index}
              query={submitted}
              diagnostic={{
                code: diagnostic.code as never,
                message: diagnostic.message,
                offset: diagnostic.offset,
                length: diagnostic.length,
                severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
                ...(diagnostic.hint ? { hint: diagnostic.hint } : {}),
              }}
            />
          ))}
        </div>
      ) : null}

      {job ? (
        <p className="text-xs text-[var(--rf-muted)]" data-testid="grid-export-job">
          Export {job.state.toLowerCase()} — {job.progress}%
          {job.downloadHref ? (
            <>
              {' '}
              <a href={job.downloadHref} className="text-[var(--rf-accent)]">
                Download
              </a>
            </>
          ) : null}
          {job.error ? <span className="text-red-600"> {job.error}</span> : null}
        </p>
      ) : null}
      {jobError ? (
        <p role="alert" className="text-xs text-red-600">
          {jobError}
        </p>
      ) : null}

      {response?.ok ? (
        <>
          <div className="flex items-center gap-3 text-xs text-[var(--rf-muted)]">
            <span data-testid="grid-population">
              {response.population} × {response.population} — rows depend on columns
            </span>
            <button type="button" onClick={exportGrid} className="rounded bg-[var(--rf-bg)] px-2 py-1">
              Export to xlsx
            </button>
          </div>

          <div className="overflow-auto">
            <table className="border-collapse text-xs" data-testid="dependency-grid">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-[var(--rf-line)] bg-[var(--rf-panel)] p-1" />
                  {response.axis.map((column) => (
                    <th
                      key={column.key}
                      title={column.title}
                      className="border border-[var(--rf-line)] bg-[var(--rf-bg)] p-1 font-mono font-normal"
                    >
                      {column.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {response.axis.map((row) => (
                  <tr key={row.key}>
                    <th
                      title={row.title}
                      className="sticky left-0 z-10 border border-[var(--rf-line)] bg-[var(--rf-bg)] p-1 text-left font-mono font-normal"
                    >
                      {row.key}
                    </th>
                    {response.axis.map((column) => {
                      const cell = initialsOfCell(row.key, column.key);
                      return (
                        <td
                          key={column.key}
                          title={cell.title}
                          className={`border border-[var(--rf-line)] p-1 text-center ${
                            cell.text ? 'bg-[#e7ecfd] font-medium text-[#21316e]' : ''
                          }`}
                        >
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {response.legend.length > 0 ? (
            <ul className="flex flex-wrap gap-3 text-xs text-[var(--rf-muted)]" data-testid="grid-legend">
              {response.legend.map((entry) => (
                <li key={entry.initials}>
                  <span className="font-medium text-[var(--rf-ink)]">{entry.initials}</span> — {entry.relationship}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
