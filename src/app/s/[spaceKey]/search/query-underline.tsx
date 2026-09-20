'use client';

import type { RqlDiagnostic } from '@/domain/ryql';

/**
 * Renders the query with the failing span underlined.
 * spec: 02-query-language.md §9 — every diagnostic carries an offset and a length so the
 * editor can point at the problem.
 */
export function QueryUnderline({ query, diagnostic }: { query: string; diagnostic: RqlDiagnostic }) {
  const start = Math.max(0, Math.min(diagnostic.offset, query.length));
  const end = Math.max(start, Math.min(start + Math.max(diagnostic.length, 1), query.length));

  return (
    <div className="font-mono text-xs leading-5" data-testid="query-underline">
      <div className="whitespace-pre-wrap">
        {query.slice(0, start)}
        <span className={diagnostic.severity === 'error' ? 'bg-red-100 underline decoration-red-500 decoration-wavy' : 'bg-amber-100 underline decoration-amber-500 decoration-wavy'}>
          {query.slice(start, end) || ' '}
        </span>
        {query.slice(end)}
      </div>
      <p className={`mt-1 ${diagnostic.severity === 'error' ? 'text-red-600' : 'text-amber-700'}`}>
        <span className="font-semibold">{diagnostic.code}</span> — {diagnostic.message}
        {diagnostic.hint ? <span className="text-[var(--rf-muted)]"> {diagnostic.hint}</span> : null}
      </p>
    </div>
  );
}
