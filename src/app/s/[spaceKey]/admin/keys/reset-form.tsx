'use client';

import { useActionState } from 'react';
import { resetSequenceAction, type ResetState } from './actions';

const initialState: ResetState = { message: null, error: null };

export function ResetSequenceForm({
  spaceKey,
  typeId,
  disabled,
}: {
  spaceKey: string;
  typeId: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(resetSequenceAction.bind(null, spaceKey), initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="typeId" value={typeId} />
      <button
        type="submit"
        disabled={pending || disabled}
        title={
          disabled
            ? 'This pattern prevents reusing deleted keys, so its sequence cannot be rewound (spec 03 §4.2).'
            : 'Rewind to the highest live key plus one'
        }
        className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs disabled:opacity-50"
      >
        {pending ? 'Resetting…' : 'Reset sequence'}
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
