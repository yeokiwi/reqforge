import { Node, mergeAttributes } from '@tiptap/core';

export type RequirementLinkAttributes = {
  spaceKey: string | null;
  key: string;
  baselineNumber: number | null;
  displayProperty: string | null;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    requirementLink: {
      /** Inserts a reference to an existing requirement at the cursor. */
      insertRequirementLink: (attributes: {
        key: string;
        spaceKey?: string | null;
        baselineNumber?: number | null;
        displayProperty?: string | null;
      }) => ReturnType;
    };
  }
}

/**
 * A reference to an existing requirement.
 * spec: 03-authoring-and-indexing.md §1.2 — "Inside a requirement's scope it becomes a
 * **dependency**; elsewhere it is a plain citation recorded as a `DocumentLink`." The node
 * itself carries no relationship: that comes from the column or row header holding it
 * (research §4.1), so the editor cannot disagree with the index.
 */
export const RequirementLink = Node.create({
  name: 'requirementLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: { default: '' },
      spaceKey: { default: null },
      /** Pin to a baseline of the target (research §4.1). */
      baselineNumber: { default: null },
      /** Which property of the target to render live. Stored now, rendered from slice 8. */
      displayProperty: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-requirement-link]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const key = String(node.attrs.key ?? '');
    const space = node.attrs.spaceKey ? `${String(node.attrs.spaceKey)}/` : '';
    const baseline = node.attrs.baselineNumber === null ? '' : `@${String(node.attrs.baselineNumber)}`;

    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-requirement-link': '', class: 'rf-req-link' }),
      `${space}${key}${baseline}`,
    ];
  },

  renderText({ node }) {
    return String(node.attrs.key ?? '');
  },

  addCommands() {
    return {
      insertRequirementLink:
        (attributes) =>
        ({ chain, state }) =>
          // At the end of the selection, never over it — see the note on insertRequirement.
          chain()
            .focus()
            .insertContentAt(state.selection.to, {
              type: this.name,
              attrs: {
                key: attributes.key,
                spaceKey: attributes.spaceKey ?? null,
                baselineNumber: attributes.baselineNumber ?? null,
                displayProperty: attributes.displayProperty ?? null,
              },
            })
            .run(),
    };
  },
});
