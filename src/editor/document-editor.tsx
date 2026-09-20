'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useState } from 'react';
import type { PMNode } from '@/domain/doc';
import type { Diagnostic } from '@/domain/indexer';
import { baseExtensions } from './extensions';
import { RequirementInsert, type KeySuggester } from './requirement-insert';
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
}) {
  const [status, setStatus] = useState<string>(`Version ${currentVersion}`);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>(initialDiagnostics);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  const editor = useEditor({
    extensions: baseExtensions({ onRequestInsert: () => setFocusSignal((value) => value + 1) }),
    content: initialContent,
    editable: canEdit,
    immediatelyRender: false,
    onUpdate: () => setDirty(true),
    editorProps: { attributes: { class: 'rf-prose min-h-[24rem] px-4 py-3 outline-none' } },
  });

  const save = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    const result = await onSave(documentId, JSON.stringify(editor.getJSON()));
    setSaving(false);
    if ('error' in result) {
      setStatus(result.error);
      return;
    }
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
                <RequirementInsert editor={editor} focusSignal={focusSignal} suggestKey={suggestKey} />
                <span data-testid="editor-status" className="text-xs text-[var(--rf-muted)]">
                  {dirty ? 'Unsaved changes' : status}
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
                className={`text-sm ${diagnostic.severity === 'error' ? 'text-red-600' : 'text-amber-700'}`}
              >
                <span className="font-mono text-xs">{diagnostic.code}</span>
                {diagnostic.key ? <span className="font-mono text-xs"> [{diagnostic.key}]</span> : null}{' '}
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
