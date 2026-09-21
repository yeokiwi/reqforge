import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    report: {
      /** Inserts a report, which renders live rows where it sits. */
      insertReport: (attributes?: { query?: string; columns?: string }) => ReturnType;
    };
  }
}

function randomId(): string {
  return `rep-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * An embedded report — Reqforge's equivalent of RY's RY Report macro.
 * spec: 04-traceability-and-coverage.md §5 (research §4.5)
 *
 * The `id` is stable and is how "use the last requirement" finds the report's place in
 * the document without depending on a ProseMirror position (`RD-035`).
 */
export const ReportNode = Node.create({
  name: 'report',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: null },
      query: { default: '' },
      columns: { default: '' },
      countOnly: { default: false },
      useLastRequirement: { default: false },
      useLastRequirementDefinition: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-report]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = node.attrs.useLastRequirement || node.attrs.useLastRequirementDefinition
      ? 'the last requirement'
      : String(node.attrs.query ?? '');

    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-report': '', class: 'rf-embed' }),
      `Report: ${label}`,
    ];
  },

  addCommands() {
    return {
      insertReport:
        (attributes = {}) =>
        ({ chain, state }) =>
          // Inserted *after* the selection, never over it: a block atom leaves the
          // selection on itself, so plain insertContent would replace the report you just
          // added instead of adding another. The trailing paragraph gives the cursor
          // somewhere to land, so you can keep typing after a report.
          chain()
            .focus()
            .insertContentAt(state.selection.to, [
              {
                type: this.name,
                attrs: {
                  id: randomId(),
                  query: attributes.query ?? '',
                  columns: attributes.columns ?? '',
                  countOnly: false,
                  useLastRequirement: false,
                  useLastRequirementDefinition: false,
                },
              },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
