import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

export type PropertyConfigAttributes = {
  name: string | null;
  isTitle: boolean;
  ignored: boolean;
  relationship: string | null;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    propertyConfig: {
      /** Sets (or clears) the configuration of the header cell holding the cursor. */
      setPropertyConfig: (attributes: Partial<PropertyConfigAttributes> | null) => ReturnType;
    };
  }
}

/**
 * Reqforge's equivalent of Requirement Yogi's "RY Properties" macro.
 * spec: 03-authoring-and-indexing.md §1.3 — a block node inside a table header cell
 * carrying `name`, `isTitle`, `ignored` and `relationship`.
 */
export const PropertyConfig = Node.create({
  name: 'propertyConfig',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      name: { default: null },
      isTitle: { default: false },
      ignored: { default: false },
      relationship: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-property-config]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const flags = [
      node.attrs.isTitle ? 'title column' : null,
      node.attrs.ignored ? 'ignored' : null,
      node.attrs.relationship ? `relationship: ${String(node.attrs.relationship)}` : null,
    ].filter(Boolean);

    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-property-config': '', class: 'rf-property-config' }),
      `${node.attrs.name ? String(node.attrs.name) : 'column'}${flags.length ? ` · ${flags.join(' · ')}` : ''}`,
    ];
  },

  addCommands() {
    return {
      setPropertyConfig:
        (attributes) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;

          let headerDepth = -1;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === 'tableHeader') {
              headerDepth = depth;
              break;
            }
          }
          if (headerDepth < 0) return false;

          const header = $from.node(headerDepth);
          const headerStart = $from.start(headerDepth);

          let found: { position: number; node: PMNode } | undefined;
          header.forEach((child, offset) => {
            if (child.type.name === this.name && found === undefined) {
              found = { position: headerStart + offset, node: child };
            }
          });

          if (!dispatch) return true;

          if (attributes === null) {
            if (found) tr.delete(found.position, found.position + found.node.nodeSize);
            return true;
          }

          const merged = { ...(found?.node.attrs ?? {}), ...attributes };
          if (found) {
            tr.setNodeMarkup(found.position, undefined, merged);
          } else {
            tr.insert(headerStart, this.type.create(merged));
          }
          return true;
        },
    };
  },
});
