'use client';

import { useActionState } from 'react';
import { createDocumentAction, type ActionState } from './actions';

const initialState: ActionState = { error: null };

export function CreateDocumentForm({ spaceKey, parentId }: { spaceKey: string; parentId?: string }) {
  const action = createDocumentAction.bind(null, spaceKey);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      <input
        name="title"
        placeholder="New document title"
        required
        className="flex-1 rounded border border-[var(--rf-line)] px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[var(--rf-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create'}
      </button>
      {state.error ? (
        <span role="alert" className="text-sm text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
