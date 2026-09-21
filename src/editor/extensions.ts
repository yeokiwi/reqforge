import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import StarterKit from '@tiptap/starter-kit';
import type { Extensions } from '@tiptap/react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PropertyConfig } from './nodes/property-config';
import { Requirement } from './nodes/requirement';
import { RequirementLink } from './nodes/requirement-link';
import { SavedMatrixNode } from './nodes/saved-matrix';
import { SavedMatrixView, type MatrixRenderer } from './saved-matrix-view';

/**
 * The document schema. spec: 03-authoring-and-indexing.md §1 — "standard rich text
 * (headings, paragraphs, lists, tables, code, images, links) plus three custom nodes".
 *
 * The custom nodes (`requirement`, `requirementLink`, `propertyConfig`) are appended by
 * slices 2–4; `src/domain/doc` renders the same node names server-side.
 */
export function baseExtensions(
  options: { onRequestInsert?: (() => void) | null; renderMatrix?: MatrixRenderer | null } = {},
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: { HTMLAttributes: { class: 'rf-code' } },
    }),
    Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
    Image.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    Requirement.configure({ onRequestInsert: options.onRequestInsert ?? null }),
    RequirementLink,
    PropertyConfig,
    // An embedded matrix renders live data through a node view (spec 04 §2.3).
    SavedMatrixNode.extend({
      addOptions() {
        return { render: options.renderMatrix ?? null };
      },
      addNodeView() {
        return ReactNodeViewRenderer(SavedMatrixView);
      },
    }),
  ];
}
