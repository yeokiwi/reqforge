'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { checkKey } from '@/domain/keys/validate';

export type RequirementCandidate = { key: string; title: string; spaceKey: string | null };
export type RequirementFinder = (term: string) => Promise<RequirementCandidate[] | { error: string }>;

/**
 * "Link to existing": a typeahead over requirements the caller may see.
 * spec: 03-authoring-and-indexing.md §6 — cross-space results only when the space is not
 * isolated, which the server action decides, not this component.
 */
export function RequirementLinkInsert({ editor, find }: { editor: Editor; find: RequirementFinder }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [candidates, setCandidates] = useState<RequirementCandidate[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || term.trim().length === 0) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await find(term.trim());
      if (cancelled) return;
      if ('error' in result) {
        setProblem(result.error);
        setCandidates([]);
        return;
      }
      setProblem(null);
      setCandidates(result);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [find, open, term]);

  const typed = term.trim();
  const typedIsAKey = checkKey(typed).ok;
  const exactMatch = candidates.some((candidate) => candidate.key.toUpperCase() === typed.toUpperCase());

  const insert = (candidate: RequirementCandidate) => {
    editor
      .chain()
      .focus()
      .insertRequirementLink({ key: candidate.key, spaceKey: candidate.spaceKey })
      .run();
    setTerm('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Link to an existing requirement"
        className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
      >
        + Link
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-40 w-72 rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)] p-3 shadow-lg">
          <input
            ref={input}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && candidates[0]) {
                event.preventDefault();
                insert(candidates[0]);
              }
              if (event.key === 'Escape') setOpen(false);
            }}
            placeholder="Key or start of a key"
            aria-label="Find a requirement to link"
            className="w-full rounded border border-[var(--rf-line)] px-2 py-1 text-xs"
          />

          <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto" data-testid="link-candidates">
            {candidates.map((candidate) => (
              <li key={`${candidate.spaceKey ?? ''}${candidate.key}`}>
                <button
                  type="button"
                  onClick={() => insert(candidate)}
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-[var(--rf-bg)]"
                >
                  <span className="rf-req">{candidate.key}</span>
                  <span className="truncate text-[var(--rf-muted)]">{candidate.title}</span>
                </button>
              </li>
            ))}
            {typedIsAKey && !exactMatch ? (
              <li>
                {/* Writing the child before the parent is the common case: the edge is
                    kept as unresolved and promoted when the key appears (RD-029). */}
                <button
                  type="button"
                  onClick={() => insert({ key: typed, title: '', spaceKey: null })}
                  className="w-full rounded px-1 py-0.5 text-left text-xs text-[var(--rf-accent)] hover:bg-[var(--rf-bg)]"
                >
                  Link to {typed} — not defined yet
                </button>
              </li>
            ) : null}
            {typed.length > 0 && candidates.length === 0 && !typedIsAKey && !problem ? (
              <li className="text-xs text-[var(--rf-muted)]">Nothing matches that key.</li>
            ) : null}
            {problem ? (
              <li role="alert" className="text-xs text-red-600">
                {problem}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
