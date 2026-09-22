'use client';

import { JobProgress } from '@/app/_components/job-progress';
import { useActionState, useState, useTransition } from 'react';
import {
  baselineJobStatusAction,
  cancelBaselineJobAction,
  createBaselineAction,
  deleteBaselineAction,
  freezeAction,
  previewAction,
  refreezeAction,
  type BaselineState,
  type PreviewResponse,
} from './actions';

const initial: BaselineState = { message: null, error: null };
const field = 'rounded border border-[var(--rf-line)] px-2 py-1 text-sm';

/**
 * Creating a draft, with the live preview of what it would hold.
 * spec: 05-baselines-and-diff.md §2 — "members are computed live from the query, so the
 * draft preview changes as the documents change. That is the point: you assemble the
 * scope, then freeze when it is agreed."
 */
export function CreateBaselineForm({ spaceKey }: { spaceKey: string }) {
  const [state, formAction, pending] = useActionState(createBaselineAction.bind(null, spaceKey), initial);
  const [query, setQuery] = useState("key ~ '%'");
  const [closure, setClosure] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, startPreview] = useTransition();

  const runPreview = () => {
    startPreview(async () => setPreview(await previewAction(spaceKey, query, closure)));
  };

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="create-baseline">
      <div className="flex flex-wrap items-center gap-2">
        <input name="name" placeholder="Release 1.0" aria-label="Baseline name" required className={`${field} w-48`} />
        <input
          name="query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Baseline query"
          placeholder="key ~ 'FN-%'"
          required
          className={`${field} flex-1 min-w-64 font-mono`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--rf-muted)]">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="includeParentDependencies"
            checked={closure}
            onChange={(event) => setClosure(event.target.checked)}
          />
          Pull in the requirements these depend on
        </label>
        <label className="flex items-center gap-2">
          {/* RD-010 — RY never baselines external properties; we make it an option. */}
          <input type="checkbox" name="includedExternal" />
          Freeze external property values too
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="withReportDocument" defaultChecked />
          Create a report document
        </label>

        <button type="button" onClick={runPreview} disabled={previewing} className="rounded bg-[var(--rf-bg)] px-2 py-1">
          {previewing ? 'Counting…' : 'Preview'}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[var(--rf-accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create draft'}
        </button>
      </div>

      {preview ? <Preview response={preview} /> : null}
      {state.message ? <p className="text-xs text-emerald-700">{state.message}</p> : null}
      {state.error ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function Preview({ response }: { response: PreviewResponse }) {
  if ('refused' in response) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {response.refused}
      </p>
    );
  }
  if (!response.ok) {
    return (
      <p role="alert" data-testid="preview-errors" className="text-xs text-red-600">
        {response.errors[0]?.message}
      </p>
    );
  }

  const { preview } = response;
  return (
    <p data-testid="baseline-preview" className="text-xs text-[var(--rf-muted)]">
      {preview.keys.length} {preview.keys.length === 1 ? 'requirement' : 'requirements'}
      {preview.addedByClosure > 0 ? `, ${preview.addedByClosure} pulled in as dependencies` : ''}
      {preview.danglingCount > 0 ? `; ${preview.danglingCount} dependencies point outside the baseline` : ''}
      {preview.truncated ? ' — the dependency closure stopped at its depth limit' : ''}.
    </p>
  );
}

/** Freezing, with the job progress the other long operations use. */
export function FreezeForm({ spaceKey, id }: { spaceKey: string; id: string }) {
  const [state, formAction, pending] = useActionState(freezeAction.bind(null, spaceKey, id), initial);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[var(--rf-accent)] px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Freezing…' : 'Freeze'}
      </button>
      <Outcome spaceKey={spaceKey} state={state} />
    </form>
  );
}

/** spec 05 §3.4 — the reason is mandatory, and is what an auditor reads. */
export function RefreezeForm({ spaceKey, id }: { spaceKey: string; id: string }) {
  const [state, formAction, pending] = useActionState(refreezeAction.bind(null, spaceKey, id), initial);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2" data-testid="refreeze">
      <input
        name="reason"
        required
        placeholder="Why is this baseline being revised?"
        aria-label="Reason for the revision"
        className={`${field} w-80`}
      />
      <button type="submit" disabled={pending} className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs disabled:opacity-60">
        {pending ? 'Revising…' : 'Refreeze'}
      </button>
      <Outcome spaceKey={spaceKey} state={state} />
    </form>
  );
}

export function DeleteBaselineForm({ spaceKey, id }: { spaceKey: string; id: string }) {
  const [state, formAction, pending] = useActionState(deleteBaselineAction.bind(null, spaceKey, id), initial);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs">
        Delete
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2 text-xs">
      <span>Delete it and its frozen rows? Its number is never reissued.</span>
      <button type="submit" disabled={pending} className="rounded bg-red-600 px-2 py-1 text-white disabled:opacity-60">
        {pending ? 'Deleting…' : 'Yes, delete'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded bg-[var(--rf-bg)] px-2 py-1">
        Cancel
      </button>
      {state.error ? (
        <span role="alert" className="text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function Outcome({ spaceKey, state }: { spaceKey: string; state: BaselineState }) {
  return (
    <>
      {state.jobId ? (
        <JobProgress
          jobId={state.jobId}
          testId="freeze-job"
          poll={(id) => baselineJobStatusAction(spaceKey, id)}
          onCancel={(id) => cancelBaselineJobAction(spaceKey, id)}
        />
      ) : null}
      {state.message && !state.jobId ? <span className="text-xs text-emerald-700">{state.message}</span> : null}
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </>
  );
}

