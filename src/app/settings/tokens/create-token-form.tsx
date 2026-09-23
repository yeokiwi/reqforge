'use client';

import { useActionState } from 'react';
import { API_SCOPES } from '@/domain/api-scopes';
import { createTokenAction, type CreateTokenState } from './actions';

const IDLE: CreateTokenState = { message: null, error: null, token: null };

export function CreateTokenForm() {
  const [state, action, pending] = useActionState(createTokenAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="create-token">
      <div className="flex flex-wrap items-center gap-3">
        <input name="name" placeholder="e.g. CI pipeline" aria-label="Token name" className="w-56 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
        {API_SCOPES.map((scope) => (
          <label key={scope} className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="scopes" value={scope} defaultChecked={scope === 'read'} />
            {scope}
          </label>
        ))}
        <input name="spaceKeys" placeholder="Spaces, e.g. SJ,ISO (blank: all)" aria-label="Spaces" className="w-64 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
        <button type="submit" disabled={pending} className="rounded bg-[var(--rf-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? 'Creating…' : 'Create token'}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
      {state.token ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">{state.message}</p>
          <code data-testid="new-token" className="mt-1 block break-all font-mono text-xs">
            {state.token}
          </code>
        </div>
      ) : null}
    </form>
  );
}
