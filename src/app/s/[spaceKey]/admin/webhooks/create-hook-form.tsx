'use client';

import { useActionState } from 'react';
import { WEBHOOK_EVENTS } from '@/domain/webhooks';
import { createHookAction, type CreateHookState } from './actions';

const IDLE: CreateHookState = { message: null, error: null, secret: null };

export function CreateHookForm({ spaceKey }: { spaceKey: string }) {
  const [state, action, pending] = useActionState(createHookAction.bind(null, spaceKey), IDLE);
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="create-webhook">
      <div className="flex flex-wrap items-center gap-2">
        <input name="url" placeholder="https://ci.example.org/reqforge" aria-label="Webhook URL" className="w-96 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
        <button type="submit" disabled={pending} className="rounded bg-[var(--rf-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      <fieldset className="flex flex-wrap gap-3 text-xs">
        <legend className="mb-1 text-[var(--rf-muted)]">Events (none ticked: all of them)</legend>
        {WEBHOOK_EVENTS.map((event) => (
          <label key={event} className="flex items-center gap-1">
            <input type="checkbox" name="events" value={event} />
            {event}
          </label>
        ))}
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
      {state.secret ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">{state.message}</p>
          <code data-testid="webhook-secret" className="mt-1 block break-all font-mono text-xs">
            {state.secret}
          </code>
        </div>
      ) : null}
    </form>
  );
}
