'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';
import type { ReportColumn, ReportConfig, ReportProblem, ReportRow } from '@/domain/traceability/report';

export type RenderedReport = {
  ok: boolean;
  columns: ReportColumn[];
  rows: ReportRow[];
  total: number;
  countOnly: boolean;
  problems: ReportProblem[];
  resolvedKey: string | null;
  errors: Array<{ message: string; hint?: string }>;
};

export type ReportRenderer = (reportId: string, config: ReportConfig) => Promise<RenderedReport>;

/**
 * An embedded report, rendering live rows where it sits.
 * spec: 04-traceability-and-coverage.md §5
 */
export function ReportView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const render = (extension.options as { render: ReportRenderer | null }).render;

  const config: ReportConfig = {
    query: String(node.attrs.query ?? ''),
    columns: String(node.attrs.columns ?? ''),
    countOnly: node.attrs.countOnly === true,
    useLastRequirement: node.attrs.useLastRequirement === true,
    useLastRequirementDefinition: node.attrs.useLastRequirementDefinition === true,
  };
  const id = String(node.attrs.id ?? '');

  const [state, setState] = useState<RenderedReport | null>(null);
  const [open, setOpen] = useState(config.query.trim().length === 0 && !config.useLastRequirement);

  const key = JSON.stringify(config);
  const run = useCallback(async () => {
    if (!render || id.length === 0) return;
    setState(await render(id, JSON.parse(key) as ReportConfig));
  }, [id, key, render]);

  useEffect(() => {
    void run();
  }, [run]);

  const usesLast = config.useLastRequirement || config.useLastRequirementDefinition;

  return (
    <NodeViewWrapper className="rf-embed" data-testid="report">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium text-[var(--rf-ink)]">
          Report
          {usesLast ? ' — the last requirement' : config.query ? ` — ${config.query}` : ''}
          {state?.resolvedKey ? ` (${state.resolvedKey})` : ''}
        </span>
        {editor.isEditable ? (
          <button type="button" onClick={() => setOpen((value) => !value)} className="text-xs text-[var(--rf-accent)]">
            {open ? 'Done' : 'Configure'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mb-2 flex flex-col gap-2 rounded border border-[var(--rf-line)] bg-[var(--rf-panel)] p-2 text-xs">
          <label className="flex flex-col gap-1">
            Query
            <input
              value={config.query}
              onChange={(event) => updateAttributes({ query: event.target.value })}
              disabled={usesLast}
              aria-label="Report query"
              placeholder="key ~ 'FN-%'"
              className="rounded border border-[var(--rf-line)] px-2 py-1 font-mono disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1">
            Columns
            <input
              value={config.columns}
              onChange={(event) => updateAttributes({ columns: event.target.value })}
              aria-label="Report columns"
              placeholder="key, description+properties, links"
              className="rounded border border-[var(--rf-line)] px-2 py-1 font-mono"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.countOnly}
              onChange={(event) => updateAttributes({ countOnly: event.target.checked })}
            />
            Count only
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.useLastRequirement}
              onChange={(event) => updateAttributes({ useLastRequirement: event.target.checked })}
            />
            Use the last requirement
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.useLastRequirementDefinition}
              onChange={(event) => updateAttributes({ useLastRequirementDefinition: event.target.checked })}
            />
            Use the last requirement definition
          </label>
        </div>
      ) : null}

      {state === null ? <p>Loading the report…</p> : null}

      {state?.errors.length ? (
        <p className="text-red-600" data-testid="report-error">
          {state.errors[0]!.message}
        </p>
      ) : null}

      {state?.problems.length ? (
        <ul className="mb-1 text-xs text-amber-700" data-testid="report-problems">
          {state.problems.map((problem) => (
            <li key={problem.source}>
              {problem.source}: {problem.message}
            </li>
          ))}
        </ul>
      ) : null}

      {state?.ok && state.countOnly ? (
        <p className="text-2xl font-semibold text-[var(--rf-ink)]" data-testid="report-count">
          {state.total}
        </p>
      ) : null}

      {state?.ok && !state.countOnly ? (
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide">
              {state.columns.map((column, index) => (
                <th key={index} className="pb-1">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.key} className="border-t border-[var(--rf-line)] align-top">
                {row.cells.map((cell, index) => (
                  <td key={index} className="py-1 text-[var(--rf-ink)]">
                    {cell.li === 'true' ? (
                      <ul className="list-disc pl-4">
                        {cell.values.map((value, position) => (
                          <li key={position}>{value.text}</li>
                        ))}
                      </ul>
                    ) : (
                      cell.values.map((value) => value.text).join(', ')
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {state.rows.length === 0 ? (
              <tr>
                <td colSpan={state.columns.length} className="py-1 text-[var(--rf-muted)]">
                  Nothing matches.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </NodeViewWrapper>
  );
}
