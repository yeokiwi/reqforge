'use client';

import { useActionState } from 'react';
import { pruneHistoryAction, saveHistorySettingsAction, type HistorySettingsState } from './actions';

const initial: HistorySettingsState = { message: null, error: null };

export function HistorySettingsForm({
  spaceKey,
  historyEnabled,
  retentionDays,
}: {
  spaceKey: string;
  historyEnabled: boolean;
  retentionDays: number | null;
}) {
  const [state, formAction, pending] = useActionState(saveHistorySettingsAction.bind(null, spaceKey), initial);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-4 text-sm" data-testid="history-settings">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="historyEnabled" defaultChecked={historyEnabled} aria-label="Record history" />
        Record a change log for this space
      </label>
      <label className="flex items-center gap-2 text-xs text-[var(--rf-muted)]">
        Keep for
        <input
          type="number"
          name="retentionDays"
          min={1}
          defaultValue={retentionDays ?? ''}
          placeholder="for ever"
          aria-label="Retention days"
          className="w-24 rounded border border-[var(--rf-line)] px-2 py-1"
        />
        days
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[var(--rf-accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {state.message ? <span className="text-xs text-emerald-700">{state.message}</span> : null}
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function PruneForm({ spaceKey }: { spaceKey: string }) {
  const [state, formAction, pending] = useActionState(pruneHistoryAction.bind(null, spaceKey), initial);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-xs">
      <button type="submit" disabled={pending} className="rounded bg-[var(--rf-bg)] px-2 py-1 disabled:opacity-60">
        {pending ? 'Pruning…' : 'Prune now'}
      </button>
      <span className="text-[var(--rf-muted)]">
        A row dated at or before the freeze of a baseline holding that requirement is never removed.
      </span>
      {state.message ? <span data-testid="prune-outcome" className="text-emerald-700">{state.message}</span> : null}
      {state.error ? (
        <span role="alert" className="text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
