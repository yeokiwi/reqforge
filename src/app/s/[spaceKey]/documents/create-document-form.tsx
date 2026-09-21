'use client';

import { useActionState } from 'react';
import { createDocumentAction, type ActionState } from './actions';

const initialState: ActionState = { error: null };

export type DocumentTemplate = { id: string; label: string };

export function CreateDocumentForm({
  spaceKey,
  parentId,
  templates = [],
}: {
  spaceKey: string;
  parentId?: string;
  /** Types with template columns — "new document from type" (spec 06 §3). */
  templates?: DocumentTemplate[];
}) {
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
      {templates.length > 0 ? (
        <select name="typeId" aria-label="Start from a type" defaultValue="" className="rounded border border-[var(--rf-line)] px-2 py-1.5 text-sm">
          <option value="">Empty document</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.label}
            </option>
          ))}
        </select>
      ) : null}
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
