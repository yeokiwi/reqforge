'use client';

import { useActionState, useState } from 'react';
import { DATA_TYPE_LABELS, DATA_TYPES, type ExternalDefinition } from '@/domain/properties/external';
import {
  createDefinitionAction,
  deleteDefinitionAction,
  updateDefinitionAction,
  type DefinitionState,
} from './actions';

const initialState: DefinitionState = { message: null, error: null };

const field = 'rounded border border-[var(--rf-line)] px-2 py-1 text-sm';

/**
 * One definition, created or edited in place. A fixed list takes one value per line,
 * which is the shape people paste from a spreadsheet.
 */
export function DefinitionForm({
  definition,
  valueCount = 0,
}: {
  definition?: ExternalDefinition;
  valueCount?: number;
}) {
  const action = definition ? updateDefinitionAction.bind(null, definition.id) : createDefinitionAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [dataType, setDataType] = useState(definition?.dataType ?? 'STRING');

  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid={definition ? `definition-${definition.id}` : 'new-definition'}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          defaultValue={definition?.name ?? ''}
          placeholder="Property name"
          aria-label="Property name"
          required
          className={`${field} w-48`}
        />
        <select
          name="dataType"
          value={dataType}
          onChange={(event) => setDataType(event.target.value as ExternalDefinition['dataType'])}
          aria-label="Data type"
          className={field}
          // Changing the type of a property that holds values would leave them
          // uninterpretable, so the server refuses it and the control says so.
          disabled={valueCount > 0}
          title={valueCount > 0 ? `${valueCount} value(s) are filed against this property.` : undefined}
        >
          {DATA_TYPES.map((type) => (
            <option key={type} value={type}>
              {DATA_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <input
          name="description"
          defaultValue={definition?.description ?? ''}
          placeholder="What it means (optional)"
          aria-label="Description"
          className={`${field} flex-1 min-w-48`}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[var(--rf-accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Saving…' : definition ? 'Save' : 'Define'}
        </button>
      </div>

      {dataType === 'ENUM' ? (
        <textarea
          name="enumValues"
          defaultValue={(definition?.enumValues ?? []).join('\n')}
          placeholder={'One value per line\nPending\nSigned off'}
          aria-label="Allowed values"
          rows={3}
          className={`${field} font-mono`}
        />
      ) : (
        <input type="hidden" name="enumValues" value="" />
      )}

      {state.message ? <p className="text-xs text-emerald-700">{state.message}</p> : null}
      {state.error ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function DeleteDefinitionForm({ id, valueCount }: { id: string; valueCount: number }) {
  const [state, formAction, pending] = useActionState(deleteDefinitionAction.bind(null, id), initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending || valueCount > 0}
        title={
          valueCount > 0
            ? `${valueCount} value${valueCount === 1 ? '' : 's'} still filed against it. Clear them first.`
            : 'Delete this property'
        }
        className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs disabled:opacity-50"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
