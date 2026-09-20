import { Node, mergeAttributes } from '@tiptap/core';

export type RequirementAttributes = { key: string; uid: string | null; typeId: string | null };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    requirement: {
      /** Inserts a requirement marker at the cursor. */
      insertRequirement: (attributes: { key: string; typeId?: string | null }) => ReturnType;
      /** Inserts one marker per selected table row (spec 03 §6). */
      insertRequirementPerRow: (keys: string[]) => ReturnType;
    };
  }
}

export type RequirementOptions = {
  /** Invoked by Alt+Shift+R (Option+Shift+R on a Mac) so the UI can ask for a key. */
  onRequestInsert: (() => void) | null;
};

function randomUid(): string {
  return `r-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * The requirement marker. spec: 03-authoring-and-indexing.md §1.1 — an inline node with
 * `key`, `typeId` and a stable `uid` that survives key renames.
 *
 * The node carries no scope information: what a requirement covers is decided by the
 * indexer from placement (spec 03 §2), so the editor cannot disagree with the index.
 */
export const Requirement = Node.create<RequirementOptions>({
  name: 'requirement',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { onRequestInsert: null };
  },

  addAttributes() {
    return {
      key: { default: '' },
      uid: { default: null },
      typeId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-requirement]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-requirement': '', class: 'rf-req' }),
      String(node.attrs.key ?? ''),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.key ?? '');
  },

  addCommands() {
    return {
      insertRequirement:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { key: attributes.key, uid: randomUid(), typeId: attributes.typeId ?? null },
          }),

      insertRequirementPerRow:
        (keys) =>
        ({ editor, state, chain }) => {
          // spec 03 §6: "on a selected table it inserts one key per row".
          const { $from } = state.selection;
          let tableDepth = -1;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === 'table') {
              tableDepth = depth;
              break;
            }
          }
          if (tableDepth < 0) return false;

          const tableStart = $from.start(tableDepth);
          const table = $from.node(tableDepth);
          const insertions: Array<{ position: number; key: string }> = [];
          let keyIndex = 0;

          table.forEach((rowNode, rowOffset) => {
            if (rowNode.type.name !== 'tableRow') return;
            const isHeaderRow = rowNode.firstChild?.type.name === 'tableHeader';
            if (isHeaderRow) return;
            const key = keys[keyIndex];
            if (key === undefined) return;
            keyIndex += 1;

            const lastCell = rowNode.lastChild;
            if (!lastCell) return;
            // End of the row's last cell, inside its final block.
            const rowStart = tableStart + rowOffset + 1;
            const cellEnd = rowStart + rowNode.nodeSize - 2;
            insertions.push({ position: cellEnd - 1, key });
          });

          if (insertions.length === 0) return false;

          const command = chain().focus();
          // Apply back-to-front so earlier positions stay valid.
          for (const insertion of [...insertions].reverse()) {
            command.insertContentAt(insertion.position, {
              type: this.name,
              attrs: { key: insertion.key, uid: randomUid(), typeId: null },
            });
          }
          return command.run() && editor.isEditable;
        },
    };
  },

  addKeyboardShortcuts() {
    const request = () => {
      this.options.onRequestInsert?.();
      return this.options.onRequestInsert !== null;
    };
    // Mac reports Option+Shift+R as Alt+Shift+R too (spec 03 §6).
    return { 'Alt-Shift-r': request, 'Alt-Shift-R': request };
  },
});
