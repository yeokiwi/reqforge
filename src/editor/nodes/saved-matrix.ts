import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    savedMatrix: {
      /** Embeds a saved matrix, which renders live data at view time. */
      insertSavedMatrix: (attributes: { id: string; name?: string | null }) => ReturnType;
    };
  }
}

/**
 * An embedded saved matrix.
 * spec: 04-traceability-and-coverage.md §2.3 — "A saved matrix is embeddable in a document
 * via a `savedMatrix` block node referencing its id, and renders live data at view time."
 *
 * The node stores only the id (and the name, for a readable placeholder): the query and
 * the columns stay on the SavedMatrix row, so editing the matrix updates every embed.
 */
export const SavedMatrixNode = Node.create({
  name: 'savedMatrix',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: '' },
      name: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-saved-matrix]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-saved-matrix': '', class: 'rf-embed' }),
      `Traceability matrix: ${String(node.attrs.name ?? node.attrs.id ?? '')}`,
    ];
  },

  addCommands() {
    return {
      insertSavedMatrix:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { id: attributes.id, name: attributes.name ?? null },
          }),
    };
  },
});
