'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PMDocNode } from '@tiptap/pm/model';
import { matchesPattern, parsePattern } from '@/domain/keys/pattern';
import { tableIsEmpty, templateTable, type TemplateColumn } from '@/domain/validation';

/**
 * Key entry for `Alt+Shift+R`. Slice 3 replaces the free-text field with suggestion from
 * the space's key patterns; the insertion path itself does not change.
 * spec: 03-authoring-and-indexing.md §6
 */
export type KeySuggester = () => Promise<{ key: string } | { error: string }>;

/** A type as the editor needs it: its pattern, and the columns its template scaffolds. */
export type EditorType = {
  id: string;
  name: string | null;
  keyPattern: string;
  colour: string;
  templateColumns: TemplateColumn[];
};

export function RequirementInsert({
  editor,
  focusSignal,
  suggestKey,
  types,
}: {
  editor: Editor;
  focusSignal: number;
  suggestKey?: KeySuggester;
  types?: EditorType[];
}) {
  const [key, setKey] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal > 0) input.current?.focus();
  }, [focusSignal]);

  const suggest = async () => {
    if (!suggestKey) return;
    const result = await suggestKey();
    if ('error' in result) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    setKey(result.key);
    input.current?.focus();
  };

  const insert = () => {
    const trimmed = key.trim();
    if (trimmed.length === 0) return;

    // spec 03 §6 / 06 §3 — inserting a typed key into an *empty* table scaffolds that
    // type's columns. Once the table has content it does nothing, because rewriting a
    // table the author has filled is hostile (research §2.4).
    scaffoldTemplate(editor, types ?? [], trimmed);

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
      {suggestKey ? (
        <button
          type="button"
          onClick={() => void suggest()}
          title="Suggest the next key from this space's patterns"
          className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
        >
          Suggest
        </button>
      ) : null}
      <button
        type="button"
        onClick={insert}
        title="Insert a requirement marker (Alt+Shift+R)"
        className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs"
      >
        + Requirement
      </button>
      {problem ? (
        <span role="alert" className="text-xs text-red-600">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/** The type whose key pattern this key matches, if any (spec 06 §1). */
function typeFor(types: readonly EditorType[], key: string): EditorType | null {
  for (const type of types) {
    const parsed = parsePattern(type.keyPattern);
    if (parsed.ok && matchesPattern(parsed.pattern, key)) return type;
  }
  return null;
}

/**
 * Replaces the empty table the cursor is in with the type's scaffolded one.
 * Returns silently when there is no type, no template, or no *empty* table — all three
 * are ordinary, and none of them is an error the author should be told about.
 */
function scaffoldTemplate(editor: Editor, types: readonly EditorType[], key: string): void {
  const type = typeFor(types, key);
  if (!type || type.templateColumns.length === 0) return;

  const table = findEnclosingTable(editor);
  if (!table) return;

  if (!tableIsEmpty(table.node.toJSON())) return;

  const scaffold = templateTable(type.templateColumns);
  if (!scaffold) return;

  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      tr.replaceWith(table.pos, table.pos + table.node.nodeSize, state.schema.nodeFromJSON(scaffold));
      return true;
    })
    .run();
}

function findEnclosingTable(editor: Editor): { node: PMDocNode; pos: number } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return { node, pos: $from.before(depth) };
  }
  return null;
}
