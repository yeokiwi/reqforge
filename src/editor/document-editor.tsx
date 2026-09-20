'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useState } from 'react';
import type { PMNode } from '@/domain/doc';
import { baseExtensions } from './extensions';
import { EditorToolbar } from './toolbar';

export type SaveResult = { versionNumber: number } | { error: string };

export function DocumentEditor({
  documentId,
  initialContent,
  currentVersion,
  canEdit,
  onSave,
}: {
  documentId: string;
  initialContent: PMNode;
  currentVersion: number;
  canEdit: boolean;
  onSave: (documentId: string, content: PMNode) => Promise<SaveResult>;
}) {
  const [status, setStatus] = useState<string>(`Version ${currentVersion}`);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const editor = useEditor({
    extensions: baseExtensions(),
    content: initialContent,
    editable: canEdit,
    immediatelyRender: false,
    onUpdate: () => setDirty(true),
    editorProps: { attributes: { class: 'rf-prose min-h-[24rem] px-4 py-3 outline-none' } },
  });

  const save = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    const result = await onSave(documentId, editor.getJSON() as PMNode);
    setSaving(false);
    if ('error' in result) {
      setStatus(result.error);
      return;
    }
    setDirty(false);
    setStatus(`Saved as version ${result.versionNumber}`);
  }, [documentId, editor, onSave]);

  if (!editor) return <div className="p-4 text-sm text-[var(--rf-muted)]">Loading the editor…</div>;

  return (
    <div className="rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)]">
      {canEdit ? (
        <EditorToolbar
          editor={editor}
          extra={
            <div className="ml-auto flex items-center gap-3">
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
  );
}
