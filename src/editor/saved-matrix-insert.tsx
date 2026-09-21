'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/react';

export type EmbeddableMatrix = { id: string; name: string };

/** "Insert as a macro" (research §4.2): embed a saved matrix into the document. */
export function SavedMatrixInsert({ editor, matrices }: { editor: Editor; matrices: EmbeddableMatrix[] }) {
  const [open, setOpen] = useState(false);

  if (matrices.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Embed a saved traceability matrix"
        className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
      >
        + Matrix
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-40 w-64 rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)] p-2 shadow-lg">
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto" data-testid="embeddable-matrices">
            {matrices.map((matrix) => (
              <li key={matrix.id}>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().insertSavedMatrix({ id: matrix.id, name: matrix.name }).run();
                    setOpen(false);
                  }}
                  className="w-full rounded px-1 py-0.5 text-left text-xs hover:bg-[var(--rf-bg)]"
                >
                  {matrix.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
