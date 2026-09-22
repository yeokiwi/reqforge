'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { runSearchAction, selectAllMatchingAction, type SearchResponse } from './actions';
import { QueryUnderline } from './query-underline';

const PAGE_SIZE = 100;

export function SearchClient({
  spaceKey,
  initialQuery,
  isolated,
  canRename,
}: {
  spaceKey: string;
  initialQuery: string;
  isolated: boolean;
  /** spec 07 §2.1 / RD-053 — renaming needs ADMIN. */
  canRename: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [crossSpace, setCrossSpace] = useState(false);
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionNote, setSelectionNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (text: string, nextOffset: number) => {
      setSubmitted(text);
      setOffset(nextOffset);
      startTransition(async () => {
        setResponse(await runSearchAction(spaceKey, text, { crossSpace, limit: PAGE_SIZE, offset: nextOffset }));
      });
    },
    [crossSpace, spaceKey],
  );

  // Arriving from a saved search, or from a coverage figure, means the query is already
  // chosen: run it rather than making the reader press Search again (spec 04 §4.1).
  const ranInitial = useRef(false);
  useEffect(() => {
    if (ranInitial.current || initialQuery.trim().length === 0) return;
    ranInitial.current = true;
    run(initialQuery, 0);
  }, [initialQuery, run]);

  const toggle = (key: string) => {
    setSelectionNote(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllMatching = () => {
    startTransition(async () => {
      const result = await selectAllMatchingAction(spaceKey, submitted, { crossSpace });
      if ('error' in result) {
        setSelectionNote(result.error);
        return;
      }
      setSelected(new Set(result.keys));
      setSelectionNote(`${result.keys.length} requirements selected across every page of this query.`);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(query, 0);
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Query"
            placeholder="key ~ 'FN-%' AND @Category = 'Safety'"
            className="flex-1 rounded border border-[var(--rf-line)] px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-[var(--rf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Searching…' : 'Search'}
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--rf-muted)]">
          <input
            type="checkbox"
            checked={crossSpace}
            disabled={isolated}
            onChange={(event) => setCrossSpace(event.target.checked)}
          />
          Search across spaces
          {isolated ? <span>— this space is isolated, so cross-space search is refused (spec 07 §3).</span> : null}
        </label>
      </form>

      {response && !response.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="search-errors">
          {response.errors.map((diagnostic, index) => (
            <QueryUnderline key={index} query={submitted} diagnostic={diagnostic} />
          ))}
        </div>
      ) : null}

      {response?.ok ? (
        <>
          {response.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="search-warnings">
              {response.warnings.map((diagnostic, index) => (
                <QueryUnderline key={index} query={submitted} diagnostic={diagnostic} />
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--rf-muted)]">
            <span data-testid="result-count">
              {response.total} {response.total === 1 ? 'requirement' : 'requirements'}
            </span>
            <span className="font-mono">read as: {response.reading}</span>
            {response.injected.length > 0 ? <span>scope: {response.injected.join(' AND ')}</span> : null}
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span>{selected.size} selected</span>
            <button type="button" onClick={selectAllMatching} className="text-[var(--rf-accent)]">
              Select all matching this query
            </button>
            {selected.size > 0 ? (
              <button type="button" onClick={() => { setSelected(new Set()); setSelectionNote(null); }} className="text-[var(--rf-muted)]">
                Clear selection
              </button>
            ) : null}
            {canRename && selected.size > 0 ? (
              <Link
                href={`/s/${spaceKey}/rename?keys=${encodeURIComponent([...selected].join(','))}`}
                data-testid="rename-selected"
                className="rounded border border-[var(--rf-line)] px-2 py-1 text-[var(--rf-accent)]"
              >
                Rename {selected.size === 1 ? 'this' : `these ${selected.size}`}
              </Link>
            ) : null}
            {selectionNote ? <span data-testid="selection-note">{selectionNote}</span> : null}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
                <th className="w-8 pb-2" />
                <th className="w-40 pb-2">Key</th>
                <th className="pb-2">Title</th>
                <th className="w-28 pb-2">Status</th>
              </tr>
            </thead>
            <tbody data-testid="search-results">
              {response.rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--rf-line)]">
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      data-testid="select-row"
                      aria-label={`Select ${row.key}`}
                      checked={selected.has(row.key)}
                      onChange={() => toggle(row.key)}
                    />
                  </td>
                  <td className="py-1.5">
                    <Link href={`/s/${spaceKey}/r/${encodeURIComponent(row.key)}`} className="rf-req">
                      {row.key}
                    </Link>
                  </td>
                  <td className="py-1.5">{row.title}</td>
                  <td className="py-1.5 text-xs text-[var(--rf-muted)]">{row.status}</td>
                </tr>
              ))}
              {response.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-[var(--rf-muted)]">
                    Nothing matches that query.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {response.total > PAGE_SIZE ? (
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                disabled={offset === 0 || pending}
                onClick={() => run(submitted, Math.max(offset - PAGE_SIZE, 0))}
                className="rounded bg-[var(--rf-bg)] px-2 py-1 disabled:opacity-50"
              >
                Previous
              </button>
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, response.total)} of {response.total}
              </span>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= response.total || pending}
                onClick={() => run(submitted, offset + PAGE_SIZE)}
                className="rounded bg-[var(--rf-bg)] px-2 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
