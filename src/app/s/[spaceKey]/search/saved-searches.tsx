'use client';

import { useActionState } from 'react';
import { deleteSavedSearchAction, saveSearchAction, type SaveState } from './actions';

const initialState: SaveState = { message: null, error: null };

export function SavedSearches({
  spaceKey,
  canEdit,
  searches,
}: {
  spaceKey: string;
  canEdit: boolean;
  searches: Array<{ id: string; name: string; query: string; visibility: string }>;
}) {
  const [state, formAction, pending] = useActionState(saveSearchAction.bind(null, spaceKey), initialState);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Saved searches</h2>

      <ul className="flex flex-col gap-1 text-sm">
        {searches.map((search) => (
          <li key={search.id} className="flex items-center gap-2">
            <a href={`/s/${spaceKey}/search?q=${encodeURIComponent(search.query)}`} className="text-[var(--rf-accent)]">
              {search.name}
            </a>
            <span className="truncate font-mono text-xs text-[var(--rf-muted)]">{search.query}</span>
            {canEdit ? (
              <form action={deleteSavedSearchAction.bind(null, spaceKey)} className="ml-auto">
                <input type="hidden" name="id" value={search.id} />
                <button type="submit" className="text-xs text-[var(--rf-muted)] hover:text-red-600">
                  Delete
                </button>
              </form>
            ) : null}
          </li>
        ))}
        {searches.length === 0 ? <li className="text-[var(--rf-muted)]">None yet.</li> : null}
      </ul>

      {canEdit ? (
        <form action={formAction} className="flex flex-col gap-2 border-t border-[var(--rf-line)] pt-3">
          <input
            name="name"
            placeholder="Name"
            required
            className="rounded border border-[var(--rf-line)] px-2 py-1 text-sm"
            aria-label="Saved search name"
          />
          <input
            name="query"
            placeholder="key ~ 'FN-%'"
            required
            className="rounded border border-[var(--rf-line)] px-2 py-1 font-mono text-xs"
            aria-label="Saved search query"
          />
          <select name="visibility" aria-label="Visibility" className="rounded border border-[var(--rf-line)] px-2 py-1 text-xs">
            <option value="space">Everyone in this space</option>
            <option value="private">Only me</option>
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save this query'}
          </button>
          {state.message ? <span className="text-xs text-emerald-700">{state.message}</span> : null}
          {state.error ? (
            <span role="alert" className="text-xs text-red-600">
              {state.error}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
