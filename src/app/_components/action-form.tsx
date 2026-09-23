'use client';

import { useActionState, type ReactNode } from 'react';

/** What every admin form action returns: one line of outcome, or one line of refusal. */
export type FormState = { message: string | null; error: string | null };

export const IDLE: FormState = { message: null, error: null };

/**
 * A form bound to a server action, showing the action's outcome beside it. The refusal is
 * rendered as returned rather than thrown, because a production build redacts a thrown
 * message and "that would lock you out" is exactly what the reader needs to see.
 */
export function ActionForm({
  action,
  children,
  className,
  testId,
  submitLabel,
  danger,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  className?: string;
  testId?: string;
  submitLabel: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} className={className ?? 'flex flex-wrap items-center gap-2'} data-testid={testId}>
      {children}
      <button
        type="submit"
        disabled={pending}
        className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-60 ${
          danger ? 'bg-red-50 text-red-700' : 'bg-[var(--rf-accent)] text-white'
        }`}
      >
        {pending ? 'Working…' : submitLabel}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
      {state.message ? <span className="text-xs text-[var(--rf-muted)]">{state.message}</span> : null}
    </form>
  );
}
