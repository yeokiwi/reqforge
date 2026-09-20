'use client';

import type { Editor } from '@tiptap/react';
import { PropertyConfigControl } from './property-config-control';

type Command = { label: string; title: string; run: () => void; active?: boolean };

function Button({ command }: { command: Command }) {
  return (
    <button
      type="button"
      title={command.title}
      onClick={command.run}
      className={`rounded px-2 py-1 text-xs ${
        command.active ? 'bg-[var(--rf-accent)] text-white' : 'bg-[var(--rf-bg)] text-[var(--rf-ink)]'
      }`}
    >
      {command.label}
    </button>
  );
}

export function EditorToolbar({ editor, extra }: { editor: Editor; extra?: React.ReactNode }) {
  const commands: Command[] = [
    { label: 'B', title: 'Bold', run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { label: 'I', title: 'Italic', run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { label: 'H2', title: 'Heading 2', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
    { label: 'H3', title: 'Heading 3', run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
    { label: '• List', title: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { label: '1. List', title: 'Ordered list', run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    { label: 'Code', title: 'Code block', run: () => editor.chain().focus().toggleCodeBlock().run(), active: editor.isActive('codeBlock') },
    {
      label: 'Table',
      title: 'Insert a table with a header row',
      run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { label: '+Row', title: 'Add a row below', run: () => editor.chain().focus().addRowAfter().run() },
    { label: '+Col', title: 'Add a column after', run: () => editor.chain().focus().addColumnAfter().run() },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[var(--rf-line)] px-3 py-2">
      {commands.map((command) => (
        <Button key={command.label} command={command} />
      ))}
      <PropertyConfigControl editor={editor} />
      {extra}
    </div>
  );
}
