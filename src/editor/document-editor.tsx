'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useState } from 'react';
import type { PMNode } from '@/domain/doc';
import type { Diagnostic } from '@/domain/indexer';
import { DiagnosticFixButton, DiagnosticPill } from './diagnostic-fix';
import { baseExtensions } from './extensions';
import { focusDiagnostic } from './quick-fixes';
import { RequirementInsert, type EditorType, type KeySuggester } from './requirement-insert';
import { RequirementLinkInsert, type RequirementFinder } from './requirement-link-insert';
import { SavedMatrixInsert, type EmbeddableMatrix } from './saved-matrix-insert';
import type { MatrixRenderer } from './saved-matrix-view';
import type { ReportRenderer } from './report-view';
import { EditorToolbar } from './toolbar';

export type SaveResult =
  | { versionNumber: number; diagnostics: Diagnostic[]; requirements: { created: number; updated: number; deleted: number } }
  | { error: string };

export function DocumentEditor({
  documentId,
  initialContent,
  currentVersion,
  canEdit,
  initialDiagnostics,
  onSave,
  suggestKey,
  findRequirements,
  matrices,
  renderMatrix,
  renderReport,
  types,
}: {
  documentId: string;
  initialContent: PMNode;
  currentVersion: number;
  canEdit: boolean;
  initialDiagnostics: Diagnostic[];
  /** The body is sent as JSON text: ProseMirror's `attrs` objects have a null prototype,
   *  which a React server action cannot serialise. */
  onSave: (documentId: string, contentJson: string) => Promise<SaveResult>;
  suggestKey?: KeySuggester;
  findRequirements?: RequirementFinder;
  /** Saved matrices that can be embedded, and how to render an embed (spec 04 §2.3). */
  matrices?: EmbeddableMatrix[];
  renderMatrix?: MatrixRenderer;
  renderReport?: ReportRenderer;
  /** The space's types, for template scaffolding (spec 03 §6, 06 §3). */
  types?: EditorType[];
}) {
  const [status, setStatus] = useState<string>(`Version ${currentVersion}`);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>(initialDiagnostics);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  /** Bumped by a MISSING_REQUIRED_DEPENDENCY fix, which opens the link picker. */
  const [linkRequest, setLinkRequest] = useState<{ relationship: string; at: number } | null>(null);

  const editor = useEditor({
    extensions: baseExtensions({
      onRequestInsert: () => setFocusSignal((value) => value + 1),
      renderMatrix: renderMatrix ?? null,
      renderReport: renderReport ?? null,
    }),
    content: initialContent,
    editable: canEdit,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      setDirty(true);
      setSaveError(null);
      // spec 04 §5 — RY's docs name more than five reports on a page as a common cause
      // of slow pages, so the editor says so before the document gets there.
      let reports = 0;
      current.state.doc.descendants((node) => {
        if (node.type.name === 'report') reports += 1;
      });
      setReportCount(reports);
    },
    editorProps: { attributes: { class: 'rf-prose min-h-[24rem] px-4 py-3 outline-none' } },
  });

  const save = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    const result = await onSave(documentId, JSON.stringify(editor.getJSON()));
    setSaving(false);
    if ('error' in result) {
      // The document stays dirty — nothing was saved — so the refusal must outrank
      // "Unsaved changes" or it is never seen (spec 07 §4: a limit is named to the author).
      setSaveError(result.error);
      return;
    }
    setSaveError(null);
    setDirty(false);
    setDiagnostics(result.diagnostics);
    const { created, updated, deleted } = result.requirements;
    const counts = [
      created ? `${created} new` : null,
      updated ? `${updated} updated` : null,
      deleted ? `${deleted} removed` : null,
    ].filter(Boolean);
    setStatus(
      `Saved as version ${result.versionNumber}${counts.length ? ` — ${counts.join(', ')}` : ''}`,
    );
  }, [documentId, editor, onSave]);

  if (!editor) return <div className="p-4 text-sm text-[var(--rf-muted)]">Loading the editor…</div>;

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)]">
        {canEdit ? (
          <EditorToolbar
            editor={editor}
            extra={
              <div className="ml-auto flex items-center gap-3">
                <RequirementInsert
                  editor={editor}
                  focusSignal={focusSignal}
                  suggestKey={suggestKey}
                  types={types}
                />
                {findRequirements ? (
                  <RequirementLinkInsert editor={editor} find={findRequirements} request={linkRequest} />
                ) : null}
                {matrices && matrices.length > 0 ? <SavedMatrixInsert editor={editor} matrices={matrices} /> : null}
                {renderReport ? (
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().insertReport().run()}
                    title="Insert a report that renders live requirements here"
                    className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
                  >
                    + Report
                  </button>
                ) : null}
                <span
                  data-testid="editor-status"
                  role={saveError ? 'alert' : undefined}
                  className={saveError ? 'text-xs text-red-700' : 'text-xs text-[var(--rf-muted)]'}
                >
                  {saveError ?? (dirty ? 'Unsaved changes' : status)}
                </span>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty}
                  className="rounded bg-[var(--rf-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            }
          />
        ) : null}
        <EditorContent editor={editor} />
      </div>

      {reportCount > 5 ? (
        <p
          data-testid="report-warning"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          This document has {reportCount} reports. More than five is a common cause of slow documents — consider
          narrowing their queries or splitting the document.
        </p>
      ) : null}

      {diagnostics.length > 0 ? (
        // spec 03 §6 — "Validation appears as a byline warning".
        <div data-testid="diagnostics" className="rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)] p-4">
          <p className="text-sm font-medium">
            {errors.length} {errors.length === 1 ? 'error' : 'errors'}, {warnings.length}{' '}
            {warnings.length === 1 ? 'warning' : 'warnings'}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {diagnostics.map((diagnostic, position) => (
              <li
                key={`${diagnostic.code}-${diagnostic.path}-${position}`}
                className={`flex flex-wrap items-center gap-2 text-sm ${
                  diagnostic.severity === 'error' ? 'text-red-600' : 'text-amber-700'
                }`}
              >
                {/* spec 03 §6 — clicking a message reveals the requirement it is about. */}
                <button
                  type="button"
                  onClick={() => focusDiagnostic(editor, diagnostic.path)}
                  title="Show this requirement in the document"
                >
                  <DiagnosticPill diagnostic={diagnostic} />
                </button>
                <span className="font-mono text-xs">{diagnostic.code}</span>
                <span className="flex-1">{diagnostic.message}</span>
                {canEdit && diagnostic.fix ? (
                  <DiagnosticFixButton
                    editor={editor}
                    fix={diagnostic.fix}
                    suggestKey={suggestKey}
                    onLinkRequested={(relationship) => setLinkRequest({ relationship, at: Date.now() })}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
