'use client';

import { useActionState } from 'react';
import type { MatrixConfig } from '@/domain/traceability/matrix';
import { saveMatrixAction, type SaveMatrixState } from './actions';

const initialState: SaveMatrixState = { message: null, error: null };

export function SaveMatrixForm({ spaceKey, config }: { spaceKey: string; config: MatrixConfig }) {
  const [state, formAction, pending] = useActionState(
    saveMatrixAction.bind(null, spaceKey, config),
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="name"
        placeholder="Name this matrix"
        required
        aria-label="Matrix name"
        className="rounded border border-[var(--rf-line)] px-2 py-1 text-sm"
      />
      <select name="visibility" aria-label="Matrix visibility" className="rounded border border-[var(--rf-line)] px-2 py-1 text-xs">
        <option value="space">Everyone in this space</option>
        <option value="private">Only me</option>
      </select>
      <button type="submit" disabled={pending} className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs disabled:opacity-60">
        {pending ? 'Saving…' : 'Save matrix'}
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
