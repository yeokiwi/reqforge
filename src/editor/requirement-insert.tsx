'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Key entry for `Alt+Shift+R`. Slice 3 replaces the free-text field with suggestion from
 * the space's key patterns; the insertion path itself does not change.
 * spec: 03-authoring-and-indexing.md §6
 */
export function RequirementInsert({ editor, focusSignal }: { editor: Editor; focusSignal: number }) {
  const [key, setKey] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal > 0) input.current?.focus();
  }, [focusSignal]);

  const insert = () => {
    const trimmed = key.trim();
    if (trimmed.length === 0) return;
    editor.chain().focus().insertRequirement({ key: trimmed }).run();
    setKey('');
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={input}
        value={key}
        onChange={(event) => setKey(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            insert();
          }
        }}
        placeholder="FN-001"
        aria-label="Requirement key"
        className="w-28 rounded border border-[var(--rf-line)] px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={insert}
        title="Insert a requirement marker (Alt+Shift+R)"
        className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
      >
        + Requirement
      </button>
    </div>
  );
}
