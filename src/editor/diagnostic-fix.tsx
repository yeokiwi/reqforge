'use client';

import { useState, useTransition } from 'react';
import type { Editor } from '@tiptap/react';
import type { Diagnostic } from '@/domain/indexer';
import { fixLabel, type DiagnosticFix } from '@/domain/validation';
import { applyAddColumn, applyPromoteHeader, applyReplaceKey, applySetCellValue, resolveAnchorPath } from './quick-fixes';
import type { KeySuggester } from './requirement-insert';

/**
 * The fix beside a diagnostic.
 * spec: 06-requirement-types.md §4 — every `FALSE` and `WARNING` that can be repaired
 * mechanically carries one, and each is a single undoable transaction.
 */
export function DiagnosticFixButton({
  editor,
  fix,
  suggestKey,
  onLinkRequested,
}: {
  editor: Editor;
  fix: DiagnosticFix;
  suggestKey?: KeySuggester;
  /** `addDependency` is not a document edit: it opens the link picker (spec 06 §4). */
  onLinkRequested?: (relationship: string) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  const complain = (applied: boolean) => {
    setProblem(applied ? null : 'That part of the document has changed. Save again to refresh this list.');
  };

  if (fix.kind === 'setCellValue') {
    return (
      <span className="inline-flex items-center gap-1">
        <select
          aria-label={fixLabel(fix)}
          defaultValue=""
          onChange={(event) => {
            if (event.target.value.length === 0) return;
            complain(applySetCellValue(editor, fix, event.target.value));
          }}
          className="rounded border border-[var(--rf-line)] px-1 py-0.5 text-xs"
        >
          <option value="">{fixLabel(fix)}…</option>
          {fix.values.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {problem ? <span className="text-xs text-[var(--rf-muted)]">{problem}</span> : null}
      </span>
    );
  }

  const run = () => {
    switch (fix.kind) {
      case 'addColumn':
        complain(applyAddColumn(editor, fix));
        return;
      case 'promoteHeader':
        complain(applyPromoteHeader(editor, fix));
        return;
      case 'addDependency': {
        // Put the cursor in the cell the link belongs in, so the indexer reads it as that
        // relationship (spec 03 §1.2, invariant P1), then open the picker.
        if (fix.cellPath) {
          const found = resolveAnchorPath(editor.state.doc, fix.cellPath);
          if (found) editor.chain().focus().setTextSelection(found.pos + 1).run();
        }
        onLinkRequested?.(fix.relationship);
        return;
      }
      case 'replaceKey': {
        if (!suggestKey) return;
        startPending(async () => {
          const suggestion = await suggestKey();
          if ('error' in suggestion) {
            setProblem(suggestion.error);
            return;
          }
          complain(applyReplaceKey(editor, fix, suggestion.key));
        });
        return;
      }
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        data-testid={`fix-${fix.kind}`}
        className="rounded bg-[var(--rf-bg)] px-2 py-0.5 text-xs disabled:opacity-50"
      >
        {pending ? 'Working…' : fixLabel(fix)}
      </button>
      {problem ? <span className="text-xs text-[var(--rf-muted)]">{problem}</span> : null}
    </span>
  );
}

/** Red for an error, yellow for a warning — spec 06 §2.1's editor rendering. */
export function DiagnosticPill({ diagnostic }: { diagnostic: Diagnostic }) {
  const error = diagnostic.severity === 'error';
  return (
    <span
      data-testid={error ? 'pill-error' : 'pill-warning'}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        error ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {diagnostic.key ?? diagnostic.code}
    </span>
  );
}
