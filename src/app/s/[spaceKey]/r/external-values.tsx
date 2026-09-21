'use client';

import { useState, useTransition } from 'react';
import type { ExternalDefinition } from '@/domain/properties/external';
import { setRequirementValueAction } from './actions';

export type ValueRow = { definition: ExternalDefinition; value: string };

/**
 * External values on the requirement itself — the reader's fields, marked `*` as they are
 * everywhere else (spec 03 §6). Editing needs EDIT on the space (spec 07 §2.1).
 */
export function ExternalValues({
  spaceKey,
  requirementId,
  rows,
  canEdit,
}: {
  spaceKey: string;
  requirementId: string;
  rows: ValueRow[];
  canEdit: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--rf-muted)]">No external properties are defined yet.</p>;
  }

  return (
    <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 text-sm" data-testid="external-values">
      {rows.map((row) => (
        <div key={row.definition.id} className="contents">
          <dt className="text-[var(--rf-muted)]">
            {row.definition.name}*
            {row.definition.description ? (
              <span className="block text-xs">{row.definition.description}</span>
            ) : null}
          </dt>
          <dd>
            {canEdit ? (
              <ValueEditor spaceKey={spaceKey} requirementId={requirementId} row={row} />
            ) : (
              row.value || <span className="text-[var(--rf-muted)]">—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ValueEditor({
  spaceKey,
  requirementId,
  row,
}: {
  spaceKey: string;
  requirementId: string;
  row: ValueRow;
}) {
  const [draft, setDraft] = useState(row.value);
  const [saved, setSaved] = useState(row.value);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const save = (next: string) => {
    if (next === saved) return;
    startSaving(async () => {
      const outcome = await setRequirementValueAction(spaceKey, requirementId, row.definition.id, next);
      if (outcome.error) {
        setError(outcome.error);
        setDraft(saved);
        return;
      }
      setError(null);
      setSaved(outcome.value ?? '');
      setDraft(outcome.value ?? '');
    });
  };

  const label = `${row.definition.name} value`;
  const shared = 'rounded border border-[var(--rf-line)] px-2 py-1 text-sm';

  return (
    <div className="flex flex-col gap-1">
      {row.definition.dataType === 'ENUM' || row.definition.dataType === 'BOOLEAN' ? (
        <select
          aria-label={label}
          value={draft}
          disabled={saving}
          onChange={(event) => {
            setDraft(event.target.value);
            save(event.target.value);
          }}
          className={shared}
        >
          <option value="">—</option>
          {(row.definition.dataType === 'BOOLEAN' ? ['true', 'false'] : row.definition.enumValues).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label={label}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => save(event.target.value)}
          className={shared}
        />
      )}
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}
