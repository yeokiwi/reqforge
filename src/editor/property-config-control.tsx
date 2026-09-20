'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Configures the header cell holding the cursor.
 * spec: 03-authoring-and-indexing.md §1.3
 */
export function PropertyConfigControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const inHeader = editor.isActive('tableHeader');
  const current = editor.getAttributes('propertyConfig');

  if (!inHeader) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Configure this column: property name, title column, ignore"
        className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
      >
        Column…
      </button>
      {open ? (
        <div className="absolute left-0 top-8 z-40 w-64 rounded-lg border border-[var(--rf-line)] bg-[var(--rf-panel)] p-3 shadow-lg">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Property name</span>
            <input
              defaultValue={typeof current.name === 'string' ? current.name : ''}
              placeholder="defaults to the header text"
              aria-label="Property name"
              onBlur={(event) =>
                editor.chain().focus().setPropertyConfig({ name: event.target.value || null }).run()
              }
              className="rounded border border-[var(--rf-line)] px-2 py-1"
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              defaultChecked={current.isTitle === true}
              onChange={(event) => editor.chain().focus().setPropertyConfig({ isTitle: event.target.checked }).run()}
            />
            This column is the title
          </label>
          <label className="mt-1 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              defaultChecked={current.ignored === true}
              onChange={(event) => editor.chain().focus().setPropertyConfig({ ignored: event.target.checked }).run()}
            />
            Do not index this column
          </label>
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().setPropertyConfig(null).run();
              setOpen(false);
            }}
            className="mt-3 text-xs text-[var(--rf-accent)]"
          >
            Clear configuration
          </button>
        </div>
      ) : null}
    </div>
  );
}
