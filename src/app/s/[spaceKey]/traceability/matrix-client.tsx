'use client';

import Link from 'next/link';
import { useCallback, useState, useTransition } from 'react';
import { aggregateValues, type ExternalDefinition } from '@/domain/properties/external';
import {
  columnId,
  columnLabel,
  groupRowsByDocument,
  type MatrixColumn,
  type MatrixConfig,
  type MatrixPage,
  type MatrixRow,
} from '@/domain/traceability/matrix';
import { QueryUnderline } from '../search/query-underline';
import {
  exportMatrixAction,
  jobStatusAction,
  runMatrixAction,
  setExternalValueAction,
  setExternalValueInBulkAction,
  type JobView,
  type MatrixResponse,
} from './actions';
import { ColumnEditor } from './column-editor';
import { SaveMatrixForm } from './save-matrix-form';

export type SavedMatrixSummary = { id: string; name: string; query: string; columns: MatrixColumn[]; visibility: string };

export function MatrixClient({
  spaceKey,
  canEdit,
  canExport,
  saved,
}: {
  spaceKey: string;
  canEdit: boolean;
  canExport: boolean;
  saved: SavedMatrixSummary[];
}) {
  const [config, setConfig] = useState<MatrixConfig>({
    query: "key ~ '%'",
    columns: [{ kind: 'key' }, { kind: 'title' }, { kind: 'status' }],
    pageSize: 100,
    treeView: false,
  });
  const [response, setResponse] = useState<MatrixResponse | null>(null);
  const [submitted, setSubmitted] = useState(config.query);
  const [job, setJob] = useState<JobView | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // spec 04 §2.2 — a toggle at the top switches the matrix into edit mode.
  const [editing, setEditing] = useState(false);
  /**
   * Values edited since the page was fetched, keyed by row and definition. The cells the
   * server sent stay as they are, so the aggregate recomputes live without a re-run.
   */
  const [edited, setEdited] = useState<Record<string, string>>({});

  const run = useCallback(
    (next: MatrixConfig, offset: number) => {
      setSubmitted(next.query);
      startTransition(async () => {
        const fetched = await runMatrixAction(spaceKey, next, offset);
        setEdited({});
        setResponse(fetched);
      });
    },
    [spaceKey],
  );

  const load = (matrix: SavedMatrixSummary) => {
    const next: MatrixConfig = { ...config, query: matrix.query, columns: matrix.columns };
    setConfig(next);
    run(next, 0);
  };

  const startExport = () => {
    setJobError(null);
    startTransition(async () => {
      // JobView carries its own `error` field, so the failure shape is told apart by the
      // presence of an id, not by the presence of `error`.
      const result = await exportMatrixAction(spaceKey, 'Traceability matrix', config);
      if (!('id' in result)) {
        setJobError(result.error);
        return;
      }
      setJob(result);
      // The job may already be finished (the web process runs it), so poll only while it
      // is still going.
      for (let attempt = 0; attempt < 30 && result.state !== 'DONE'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const status = await jobStatusAction(spaceKey, result.id);
        if (!('id' in status)) {
          setJobError(status.error);
          return;
        }
        setJob(status);
        if (status.state === 'DONE' || status.state === 'FAILED' || status.state === 'CANCELLED') break;
      }
    });
  };

  const page: MatrixPage | null = response?.ok ? response.page : null;
  const definitions: ExternalDefinition[] = response?.ok ? response.definitions : [];
  const definitionFor = (name: string) =>
    definitions.find((definition) => definition.searchName === name.trim().toLowerCase()) ?? null;

  const table = (rows: MatrixRow[]) => (
    <MatrixTable
      spaceKey={spaceKey}
      columns={page!.config.columns}
      rows={rows}
      definitions={definitions}
      edited={edited}
      editing={editing && canEdit}
      onEdited={(rowId, definitionId, value) =>
        setEdited((current) => ({ ...current, [`${rowId}:${definitionId}`]: value }))
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(config, 0);
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex gap-2">
          <input
            value={config.query}
            onChange={(event) => setConfig({ ...config, query: event.target.value })}
            aria-label="Matrix query"
            placeholder="key ~ 'FN-%'"
            className="flex-1 rounded border border-[var(--rf-line)] px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-[var(--rf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Running…' : 'Run'}
          </button>
        </div>

        <ColumnEditor columns={config.columns} onChange={(columns) => setConfig({ ...config, columns })} />

        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--rf-muted)]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.treeView}
              onChange={(event) => setConfig({ ...config, treeView: event.target.checked })}
            />
            Tree view — group rows by their document
          </label>
          <label className="flex items-center gap-2">
            Page size
            <input
              type="number"
              min={1}
              max={600}
              value={config.pageSize}
              onChange={(event) => setConfig({ ...config, pageSize: Number(event.target.value) })}
              aria-label="Page size"
              className="w-20 rounded border border-[var(--rf-line)] px-2 py-1"
            />
          </label>
          {canEdit ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing}
                onChange={(event) => setEditing(event.target.checked)}
                aria-label="Edit values"
              />
              Edit values — external columns marked editable become inputs
            </label>
          ) : null}
          {canExport ? (
            <button type="button" onClick={startExport} className="rounded bg-[var(--rf-bg)] px-2 py-1">
              Export to xlsx
            </button>
          ) : null}
        </div>
      </form>

      {job ? (
        <p className="text-xs text-[var(--rf-muted)]" data-testid="export-job">
          Export {job.state.toLowerCase()} — {job.progress}% {job.message ?? ''}
          {job.downloadHref ? (
            <>
              {' '}
              <a href={job.downloadHref} className="text-[var(--rf-accent)]">
                Download
              </a>
            </>
          ) : null}
          {job.error ? <span className="text-red-600"> {job.error}</span> : null}
        </p>
      ) : null}
      {jobError ? (
        <p role="alert" className="text-xs text-red-600">
          {jobError}
        </p>
      ) : null}

      {response && !response.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="matrix-errors">
          {response.errors.map((diagnostic, index) => (
            <QueryUnderline key={index} query={submitted} diagnostic={diagnostic} />
          ))}
        </div>
      ) : null}

      {page ? (
        <>
          <p className="text-xs text-[var(--rf-muted)]" data-testid="matrix-count">
            {page.total} {page.total === 1 ? 'requirement' : 'requirements'}
          </p>

          {editing && canEdit && canExport ? (
            <BulkSetPanel
              spaceKey={spaceKey}
              query={page.config.query}
              total={page.total}
              columns={page.config.columns}
              definitionFor={definitionFor}
              onDone={() => run(config, page.offset)}
            />
          ) : null}
          {config.treeView ? (
            groupRowsByDocument(page.rows).map((group) => (
              <section key={group.documentId ?? 'none'} className="flex flex-col gap-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
                  {group.documentTitle}
                </h2>
                {table(group.rows)}
              </section>
            ))
          ) : (
            table(page.rows)
          )}

          {page.total > page.config.pageSize ? (
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                disabled={page.offset === 0 || pending}
                onClick={() => run(config, Math.max(page.offset - config.pageSize, 0))}
                className="rounded bg-[var(--rf-bg)] px-2 py-1 disabled:opacity-50"
              >
                Previous
              </button>
              <span>
                {page.offset + 1}–{Math.min(page.offset + config.pageSize, page.total)} of {page.total}
              </span>
              <button
                type="button"
                disabled={page.offset + config.pageSize >= page.total || pending}
                onClick={() => run(config, page.offset + config.pageSize)}
                className="rounded bg-[var(--rf-bg)] px-2 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-[var(--rf-line)] pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Saved matrices</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {saved.map((matrix) => (
            <li key={matrix.id} className="flex items-center gap-2">
              <button type="button" onClick={() => load(matrix)} className="text-[var(--rf-accent)]">
                {matrix.name}
              </button>
              <span className="truncate font-mono text-xs text-[var(--rf-muted)]">{matrix.query}</span>
            </li>
          ))}
          {saved.length === 0 ? <li className="text-[var(--rf-muted)]">None yet.</li> : null}
        </ul>
        {canEdit ? <SaveMatrixForm spaceKey={spaceKey} config={config} /> : null}
      </div>
    </div>
  );
}

type EditedValues = Record<string, string>;

function MatrixTable({
  spaceKey,
  columns,
  rows,
  definitions,
  edited,
  editing,
  onEdited,
}: {
  spaceKey: string;
  columns: MatrixColumn[];
  rows: MatrixPage['rows'];
  definitions: ExternalDefinition[];
  edited: EditedValues;
  editing: boolean;
  onEdited: (rowId: string, definitionId: string, value: string) => void;
}) {
  const definitionFor = (name: string) =>
    definitions.find((definition) => definition.searchName === name.trim().toLowerCase()) ?? null;

  /** What a cell currently shows: the edited value if there is one, else the fetched one. */
  const valueOf = (row: MatrixPage['rows'][number], column: MatrixColumn): string => {
    if (column.kind !== 'external') return row.cells[columnId(column)]?.text ?? '';
    const definition = definitionFor(column.name);
    const local = definition ? edited[`${row.id}:${definition.id}`] : undefined;
    return local ?? row.cells[columnId(column)]?.text ?? '';
  };

  const aggregates = columns.map((column) => {
    if (column.kind !== 'external' || !column.aggregate) return null;
    const definition = definitionFor(column.name);
    if (!definition) return null;
    // spec 04 §2.1 — "recomputed live as values are edited", so it reads the cells on
    // screen rather than asking the server again.
    const outcome = aggregateValues(column.aggregate, definition.dataType, rows.map((row) => valueOf(row, column)));
    return { label: column.aggregate, ...outcome };
  });

  return (
    <table className="w-full text-sm" data-testid="matrix-table">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
          {columns.map((column, index) => (
            <th key={`${column.kind}-${index}`} className="pb-2">
              {columnLabel(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-[var(--rf-line)] align-top">
            {columns.map((column, index) => {
              const definition = column.kind === 'external' ? definitionFor(column.name) : null;
              return (
                <td key={`${column.kind}-${index}`} className="py-1.5">
                  {column.kind === 'key' ? (
                    <Link href={`/s/${spaceKey}/r/${encodeURIComponent(row.key)}`} className="rf-req">
                      {row.key}
                    </Link>
                  ) : editing && column.kind === 'external' && column.editable && definition ? (
                    <ValueInput
                      spaceKey={spaceKey}
                      requirementId={row.id}
                      requirementKey={row.key}
                      definition={definition}
                      value={valueOf(row, column)}
                      onSaved={(next) => onEdited(row.id, definition.id, next)}
                    />
                  ) : (
                    valueOf(row, column)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="py-3 text-[var(--rf-muted)]">
              Nothing matches that query.
            </td>
          </tr>
        ) : null}
      </tbody>
      {aggregates.some((aggregate) => aggregate !== null) ? (
        <tfoot>
          <tr className="border-t border-[var(--rf-line)] text-xs text-[var(--rf-muted)]" data-testid="matrix-totals">
            {columns.map((column, index) => {
              const aggregate = aggregates[index];
              return (
                <td key={`total-${index}`} className="py-1.5">
                  {aggregate ? (
                    aggregate.ok ? (
                      <span data-testid={`total-${columnId(column)}`}>
                        {aggregate.label} {aggregate.text}
                      </span>
                    ) : (
                      <span className="text-red-600">{aggregate.message}</span>
                    )
                  ) : null}
                </td>
              );
            })}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/**
 * One editable external value. It saves on blur and rolls back to the stored value if the
 * server refuses the coercion, so a refusal never leaves a lie on screen.
 */
function ValueInput({
  spaceKey,
  requirementId,
  requirementKey,
  definition,
  value,
  onSaved,
}: {
  spaceKey: string;
  requirementId: string;
  requirementKey: string;
  definition: ExternalDefinition;
  value: string;
  onSaved: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const save = (next: string) => {
    if (next === value) return;
    startSaving(async () => {
      const outcome = await setExternalValueAction(spaceKey, requirementId, definition.id, next);
      if (outcome.error) {
        setError(outcome.error);
        setDraft(value);
        return;
      }
      setError(null);
      onSaved(outcome.value ?? '');
    });
  };

  const label = `${definition.name} of ${requirementKey}`;
  const shared = 'w-full rounded border border-[var(--rf-line)] px-1 py-0.5 text-sm';

  return (
    <div className="flex flex-col gap-0.5">
      {definition.dataType === 'ENUM' || definition.dataType === 'BOOLEAN' ? (
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
          {(definition.dataType === 'BOOLEAN' ? ['true', 'false'] : definition.enumValues).map((option) => (
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

/**
 * "Set value in bulk" across the whole result set, not just the visible page
 * (spec 04 §2.2). Shown only with EDIT and EXPORT (RD-039), and it names the row count
 * before it runs, because this is the one control here that changes rows you cannot see.
 */
function BulkSetPanel({
  spaceKey,
  query,
  total,
  columns,
  definitionFor,
  onDone,
}: {
  spaceKey: string;
  query: string;
  total: number;
  columns: MatrixColumn[];
  definitionFor: (name: string) => ExternalDefinition | null;
  onDone: () => void;
}) {
  const available = columns.flatMap((column) => {
    if (column.kind !== 'external') return [];
    const definition = definitionFor(column.name);
    return definition ? [definition] : [];
  });

  const [definitionId, setDefinitionId] = useState(available[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const [running, startRunning] = useTransition();

  if (available.length === 0) return null;
  const chosen = available.find((definition) => definition.id === definitionId) ?? available[0]!;

  const run = () => {
    setConfirming(false);
    startRunning(async () => {
      const outcome = await setExternalValueInBulkAction(spaceKey, query, chosen.id, value);
      setState(outcome);
      if (outcome.message) onDone();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--rf-line)] p-2 text-xs" data-testid="bulk-set">
      <span className="font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Set value in bulk</span>
      <select
        aria-label="Bulk property"
        value={chosen.id}
        onChange={(event) => setDefinitionId(event.target.value)}
        className="rounded border border-[var(--rf-line)] px-2 py-1"
      >
        {available.map((definition) => (
          <option key={definition.id} value={definition.id}>
            {definition.name}
          </option>
        ))}
      </select>

      {chosen.dataType === 'ENUM' || chosen.dataType === 'BOOLEAN' ? (
        <select
          aria-label="Bulk value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="rounded border border-[var(--rf-line)] px-2 py-1"
        >
          <option value="">clear the value</option>
          {(chosen.dataType === 'BOOLEAN' ? ['true', 'false'] : chosen.enumValues).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label="Bulk value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="leave blank to clear"
          className="rounded border border-[var(--rf-line)] px-2 py-1"
        />
      )}

      {confirming ? (
        <>
          <span data-testid="bulk-confirm">
            {value.trim().length === 0 ? 'Clear' : `Set ${chosen.name} to "${value}" on`} all {total} matching
            requirement{total === 1 ? '' : 's'}?
          </span>
          <button type="button" onClick={run} disabled={running} className="rounded bg-[var(--rf-accent)] px-2 py-1 text-white">
            {running ? 'Working…' : 'Yes, set them'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded bg-[var(--rf-bg)] px-2 py-1">
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="rounded bg-[var(--rf-bg)] px-2 py-1">
          Set for all {total}
        </button>
      )}

      {state.message ? <span className="text-emerald-700">{state.message}</span> : null}
      {state.error ? (
        <span role="alert" className="text-red-600">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
