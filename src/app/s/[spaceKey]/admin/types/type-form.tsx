'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  describeRule,
  MAX_RULES_PER_TYPE,
  RULE_KINDS,
  RULE_LABELS,
  type Rule,
  type RuleKind,
  type TemplateColumn,
} from '@/domain/validation';
import type { TypeView } from '@/server/usecases/requirement-types';
import {
  createTypeAction,
  deleteTypeAction,
  runValidationAction,
  updateTypeAction,
  validationJobStatusAction,
  type TypeState,
} from './actions';

const initial: TypeState = { message: null, error: null };
const field = 'rounded border border-[var(--rf-line)] px-2 py-1 text-sm';

/**
 * One requirement type: its pattern, its rules, its template columns.
 * spec: 06-requirement-types.md §1 — "We model exactly one entity": a named type and a
 * bare key suggestion differ only by having a name (research §2.3).
 */
export function TypeForm({
  spaceKey,
  type,
  canAdmin,
}: {
  spaceKey: string;
  type?: TypeView;
  canAdmin: boolean;
}) {
  const action = type ? updateTypeAction.bind(null, spaceKey, type.id) : createTypeAction.bind(null, spaceKey);
  const [state, formAction, pending] = useActionState(action, initial);
  const [rules, setRules] = useState<Rule[]>(type?.rules ?? []);
  const [columns, setColumns] = useState<TemplateColumn[]>(type?.templateColumns ?? []);

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid={type ? `type-${type.id}` : 'new-type'}>
      <input type="hidden" name="rules" value={JSON.stringify(rules)} />
      <input type="hidden" name="templateColumns" value={JSON.stringify(columns)} />

      <div className="flex flex-wrap items-center gap-2">
        <input
          name="keyPattern"
          defaultValue={type?.keyPattern ?? ''}
          placeholder="FN-###"
          aria-label="Key pattern"
          required
          disabled={!canAdmin}
          className={`${field} w-32 font-mono`}
        />
        <input
          name="name"
          defaultValue={type?.name ?? ''}
          placeholder="Name (optional — a bare key suggestion has none)"
          aria-label="Type name"
          disabled={!canAdmin}
          className={`${field} flex-1 min-w-48`}
        />
        <input
          type="color"
          name="colour"
          defaultValue={type?.colour ?? '#4a5568'}
          aria-label="Colour"
          disabled={!canAdmin}
          className="h-8 w-10 rounded border border-[var(--rf-line)]"
        />
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="locked" defaultChecked={type?.locked ?? false} disabled={!canAdmin} />
          locked — refuse keys matching no pattern
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            name="preventReusingDeletedKeys"
            defaultChecked={type?.preventReusingDeletedKeys ?? true}
            disabled={!canAdmin}
          />
          never reuse a deleted key
        </label>
        {canAdmin ? (
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-[var(--rf-accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Saving…' : type ? 'Save' : 'Create type'}
          </button>
        ) : null}
      </div>

      <RuleEditor rules={rules} onChange={setRules} canEdit={canAdmin} />
      <TemplateEditor columns={columns} onChange={setColumns} canEdit={canAdmin} />

      {state.message ? <p className="text-xs text-emerald-700">{state.message}</p> : null}
      {state.error ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
      {state.jobId ? <JobProgress spaceKey={spaceKey} jobId={state.jobId} /> : null}
    </form>
  );
}

/** The rule list. spec 06 §1 — five kinds, and `PROPERTY_*` are ours (`RD-015`). */
function RuleEditor({
  rules,
  onChange,
  canEdit,
}: {
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
  canEdit: boolean;
}) {
  const [kind, setKind] = useState<RuleKind>('REQUIRED_PROPERTY');
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [direction, setDirection] = useState<'to' | 'from'>('to');
  const [pattern, setPattern] = useState('');
  const [values, setValues] = useState('');

  const add = () => {
    const rule = build(kind, { name, relationship, direction, pattern, values });
    if (!rule) return;
    onChange([...rules, rule]);
    setName('');
    setRelationship('');
    setPattern('');
    setValues('');
  };

  const full = rules.length >= MAX_RULES_PER_TYPE;

  return (
    <div className="flex flex-col gap-1 rounded border border-[var(--rf-line)] p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
        Rules ({rules.length}/{MAX_RULES_PER_TYPE})
      </p>
      <ul className="flex flex-wrap gap-1" data-testid="rule-list">
        {rules.map((rule, index) => (
          <li key={index} className="flex items-center gap-1 rounded bg-[var(--rf-bg)] px-2 py-1 text-xs">
            <span>{describeRule(rule)}</span>
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove rule ${index + 1}`}
                className="text-red-600"
                onClick={() => onChange(rules.filter((_, position) => position !== index))}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
        {rules.length === 0 ? <li className="text-xs text-[var(--rf-muted)]">No rules yet.</li> : null}
      </ul>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Rule kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as RuleKind)}
            className={field}
          >
            {RULE_KINDS.map((option) => (
              <option key={option} value={option}>
                {RULE_LABELS[option]}
              </option>
            ))}
          </select>

          {kind === 'REQUIRED_DEPENDENCY' ? (
            <>
              <select
                aria-label="Rule direction"
                value={direction}
                onChange={(event) => setDirection(event.target.value as 'to' | 'from')}
                className={field}
              >
                <option value="to">on (this depends on something)</option>
                <option value="from">from (something depends on this)</option>
              </select>
              <input
                aria-label="Rule relationship"
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
                placeholder="verifies"
                className={`${field} w-32`}
              />
            </>
          ) : (
            <input
              aria-label="Rule property"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Priority"
              className={`${field} w-32`}
            />
          )}

          {kind === 'PROPERTY_MATCHES' ? (
            <input
              aria-label="Rule pattern"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="^[A-Z]{2}-\d+$"
              className={`${field} w-40 font-mono`}
            />
          ) : null}

          {kind === 'PROPERTY_IN' ? (
            <input
              aria-label="Rule values"
              value={values}
              onChange={(event) => setValues(event.target.value)}
              placeholder="Draft, Reviewed, Approved"
              className={`${field} w-56`}
            />
          ) : null}

          <button type="button" onClick={add} disabled={full} className="rounded bg-[var(--rf-bg)] px-2 py-1">
            Add rule
          </button>
          {full ? <span className="text-red-600">A type may have at most {MAX_RULES_PER_TYPE} rules.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function build(
  kind: RuleKind,
  input: { name: string; relationship: string; direction: 'to' | 'from'; pattern: string; values: string },
): Rule | null {
  const name = input.name.trim();
  switch (kind) {
    case 'REQUIRED_PROPERTY':
    case 'OPTIONAL_PROPERTY':
      return name ? { kind, name } : null;
    case 'REQUIRED_DEPENDENCY': {
      const relationship = input.relationship.trim();
      return relationship ? { kind, relationship, direction: input.direction } : null;
    }
    case 'PROPERTY_MATCHES': {
      const pattern = input.pattern.trim();
      return name && pattern ? { kind, name, pattern } : null;
    }
    case 'PROPERTY_IN': {
      const values = input.values
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return name && values.length > 0 ? { kind, name, values } : null;
    }
  }
}

/** spec 06 §3 — the columns a typed key scaffolds into an empty table. */
function TemplateEditor({
  columns,
  onChange,
  canEdit,
}: {
  columns: TemplateColumn[];
  onChange: (columns: TemplateColumn[]) => void;
  canEdit: boolean;
}) {
  const [name, setName] = useState('');
  const [required, setRequired] = useState(true);

  return (
    <div className="flex flex-col gap-1 rounded border border-[var(--rf-line)] p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Template columns</p>
      <ul className="flex flex-wrap gap-1" data-testid="template-list">
        {columns.map((column, index) => (
          <li key={index} className="flex items-center gap-1 rounded bg-[var(--rf-bg)] px-2 py-1 text-xs">
            <span>
              {column.name}
              {column.required ? ' *' : ''}
            </span>
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove column ${column.name}`}
                className="text-red-600"
                onClick={() => onChange(columns.filter((_, position) => position !== index))}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
        {columns.length === 0 ? <li className="text-xs text-[var(--rf-muted)]">None.</li> : null}
      </ul>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            aria-label="Template column"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Priority"
            className={`${field} w-32`}
          />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />
            required
          </label>
          <button
            type="button"
            onClick={() => {
              if (name.trim().length === 0) return;
              onChange([...columns, { name: name.trim(), required, ordinal: columns.length }]);
              setName('');
            }}
            className="rounded bg-[var(--rf-bg)] px-2 py-1"
          >
            Add column
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The revalidation job's progress (spec 06 §2.2 trigger 2). */
function JobProgress({ spaceKey, jobId }: { spaceKey: string; jobId: string }) {
  const [status, setStatus] = useState<{ state: string; progress: number; message: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await validationJobStatusAction(spaceKey, jobId);
        if (cancelled) return;
        if ('error' in result) return;
        setStatus(result);
        if (result.state === 'DONE' || result.state === 'FAILED' || result.state === 'CANCELLED') return;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, spaceKey]);

  if (!status) return null;
  return (
    <p data-testid="validation-job" className="text-xs text-[var(--rf-muted)]">
      Validation {status.state.toLowerCase()} — {status.progress}% {status.message ?? ''}
    </p>
  );
}

/** Delete and "run validation" sit outside the form, so they do not submit it. */
export function TypeActions({
  spaceKey,
  type,
  canAdmin,
  canEdit,
}: {
  spaceKey: string;
  type: TypeView;
  canAdmin: boolean;
  canEdit: boolean;
}) {
  const [runState, runAction, running] = useActionState(runValidationAction.bind(null, spaceKey, type.id), initial);
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteTypeAction.bind(null, spaceKey, type.id),
    initial,
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {canEdit ? (
        <form action={runAction}>
          <button type="submit" disabled={running} className="rounded bg-[var(--rf-bg)] px-2 py-1 disabled:opacity-50">
            {running ? 'Validating…' : 'Run validation'}
          </button>
        </form>
      ) : null}
      {canAdmin ? (
        <form action={deleteAction}>
          <button
            type="submit"
            disabled={deleting}
            title="The requirements keep their rows and lose their type."
            className="rounded bg-[var(--rf-bg)] px-2 py-1 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </form>
      ) : null}
      {runState.jobId ? <JobProgress spaceKey={spaceKey} jobId={runState.jobId} /> : null}
      {runState.error ? (
        <span role="alert" className="text-red-600">
          {runState.error}
        </span>
      ) : null}
      {deleteState.error ? (
        <span role="alert" className="text-red-600">
          {deleteState.error}
        </span>
      ) : null}
    </div>
  );
}
