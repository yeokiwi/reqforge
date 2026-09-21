'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { columnId, columnLabel, type MatrixColumn, type MatrixRow } from '@/domain/traceability/matrix';

export type EmbeddedMatrix = {
  name: string;
  columns: MatrixColumn[];
  rows: MatrixRow[];
  total: number;
};

export type MatrixRenderer = (matrixId: string) => Promise<EmbeddedMatrix | { error: string }>;

/**
 * Renders an embedded saved matrix with live data.
 * spec: 04-traceability-and-coverage.md §2.3
 */
export function SavedMatrixView({ node, extension }: NodeViewProps) {
  const id = String(node.attrs.id ?? '');
  const render = (extension.options as { render: MatrixRenderer | null }).render;
  const [state, setState] = useState<EmbeddedMatrix | { error: string } | null>(null);

  useEffect(() => {
    if (!render || id.length === 0) return;
    let cancelled = false;
    void render(id).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, render]);

  return (
    <NodeViewWrapper className="rf-embed" data-testid="embedded-matrix">
      {state === null ? (
        <span>Loading the matrix…</span>
      ) : 'error' in state ? (
        <span className="text-red-600">{state.error}</span>
      ) : (
        <>
          <p className="mb-1 font-medium text-[var(--rf-ink)]">
            {state.name} — {state.total} {state.total === 1 ? 'requirement' : 'requirements'}
          </p>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide">
                {state.columns.map((column, index) => (
                  <th key={index} className="pb-1">
                    {columnLabel(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--rf-line)]">
                  {state.columns.map((column, index) => (
                    <td key={index} className="py-1 text-[var(--rf-ink)]">
                      {row.cells[columnId(column)]?.text ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </NodeViewWrapper>
  );
}
