import type { Editor } from '@tiptap/react';
import type { Node as PMDocNode } from '@tiptap/pm/model';
import type { DiagnosticFix } from '@/domain/validation';

/**
 * Quick fixes, applied to the document.
 * spec: 06-requirement-types.md §4 — "Fixes are ProseMirror transactions and must be
 * individually undoable." Each function here is exactly one transaction, so one undo
 * takes the document back.
 *
 * *What* the repair is was decided in `src/domain/validation/fixes.ts` (`RD-042`); this
 * file only performs it.
 */

/**
 * An `AnchorPath` is a dot-separated run of child indices from the document root, which
 * is what the indexer records. ProseMirror needs a position, so resolve one to the other.
 */
export function resolveAnchorPath(doc: PMDocNode, path: string): { node: PMDocNode; pos: number } | null {
  if (path.length === 0) return null;
  const indices = path.split('.').map(Number);
  if (indices.some((index) => !Number.isInteger(index) || index < 0)) return null;

  let node = doc;
  let contentStart = 0;
  let pos = 0;

  for (const index of indices) {
    if (index >= node.childCount) return null;
    let offset = contentStart;
    for (let child = 0; child < index; child += 1) offset += node.child(child).nodeSize;
    node = node.child(index);
    pos = offset;
    contentStart = pos + 1;
  }

  return { node, pos };
}

const CELL_TYPES = new Set(['tableCell', 'tableHeader']);

function paragraph(editor: Editor, text?: string): PMDocNode {
  const para = editor.schema.nodes.paragraph!;
  return para.create(null, text && text.length > 0 ? editor.schema.text(text) : null);
}

function cell(editor: Editor, header: boolean, text?: string): PMDocNode {
  const type = header ? editor.schema.nodes.tableHeader : editor.schema.nodes.tableCell;
  return type!.create(null, paragraph(editor, text));
}

/**
 * Adds a column named for a missing property — or, in a vertical layout, a row, because
 * there the header runs down the first column (spec 03 §2).
 *
 * The whole table is rebuilt and replaced in one step rather than patched cell by cell:
 * one transaction, one undo, and no position arithmetic to get wrong.
 */
export function applyAddColumn(editor: Editor, fix: Extract<DiagnosticFix, { kind: 'addColumn' }>): boolean {
  const found = resolveAnchorPath(editor.state.doc, fix.tablePath);
  if (!found || found.node.type.name !== 'table') return false;

  const rows: PMDocNode[] = [];
  found.node.forEach((row) => rows.push(row));
  if (rows.length === 0) return false;

  const rowType = editor.schema.nodes.tableRow!;
  let rebuilt: PMDocNode;

  if (fix.layout === 'VERTICAL_TABLE') {
    // A new row: its first cell names the property, the rest are empty.
    const width = Math.max(...rows.map((row) => row.childCount));
    const cells = [cell(editor, true, fix.name), ...Array.from({ length: Math.max(width - 1, 1) }, () => cell(editor, false))];
    rebuilt = found.node.type.create(found.node.attrs, [...rows, rowType.create(null, cells)]);
  } else {
    // A new column: a header cell on the header row, an empty cell on every other.
    const nextRows = rows.map((row, index) => {
      const cells: PMDocNode[] = [];
      row.forEach((existing) => cells.push(existing));
      const isHeaderRow = index === 0 && cells.every((existing) => existing.type.name === 'tableHeader');
      cells.push(cell(editor, isHeaderRow, isHeaderRow ? fix.name : undefined));
      return rowType.create(row.attrs, cells);
    });
    rebuilt = found.node.type.create(found.node.attrs, nextRows);
  }

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(found.pos, found.pos + found.node.nodeSize, rebuilt);
      return true;
    })
    .run();
}

/** Rule S4's repair: the first row becomes a header row (spec 06 §4). */
export function applyPromoteHeader(
  editor: Editor,
  fix: Extract<DiagnosticFix, { kind: 'promoteHeader' }>,
): boolean {
  const found = resolveAnchorPath(editor.state.doc, fix.tablePath);
  if (!found || found.node.type.name !== 'table') return false;

  const rows: PMDocNode[] = [];
  found.node.forEach((row) => rows.push(row));
  const first = rows[0];
  if (!first) return false;

  const headerCells: PMDocNode[] = [];
  first.forEach((existing) => {
    if (existing.type.name === 'tableHeader') {
      headerCells.push(existing);
      return;
    }
    headerCells.push(editor.schema.nodes.tableHeader!.create(existing.attrs, existing.content));
  });

  const rebuilt = found.node.type.create(found.node.attrs, [
    editor.schema.nodes.tableRow!.create(first.attrs, headerCells),
    ...rows.slice(1),
  ]);

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(found.pos, found.pos + found.node.nodeSize, rebuilt);
      return true;
    })
    .run();
}

/** `PROPERTY_NOT_IN_VALUES`: replace the cell's contents with a value from the list. */
export function applySetCellValue(
  editor: Editor,
  fix: Extract<DiagnosticFix, { kind: 'setCellValue' }>,
  value: string,
): boolean {
  const found = resolveAnchorPath(editor.state.doc, fix.cellPath);
  if (!found || !CELL_TYPES.has(found.node.type.name)) return false;
  if (!fix.values.includes(value)) return false;

  const rebuilt = found.node.type.create(found.node.attrs, paragraph(editor, value));
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(found.pos, found.pos + found.node.nodeSize, rebuilt);
      return true;
    })
    .run();
}

/** `KEY_NOT_ALLOWED`: put an allowed key on the marker, keeping its stable `uid`. */
export function applyReplaceKey(
  editor: Editor,
  fix: Extract<DiagnosticFix, { kind: 'replaceKey' }>,
  key: string,
): boolean {
  const found = resolveAnchorPath(editor.state.doc, fix.anchorPath);
  if (!found || found.node.type.name !== 'requirement') return false;

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      // The uid survives a key change by design (spec 03 §1.1), so only `key` moves.
      tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, key });
      return true;
    })
    .run();
}

/** Puts the cursor on the requirement a diagnostic names, so its pill is in view. */
export function focusDiagnostic(editor: Editor, anchorPath: string): boolean {
  const found = resolveAnchorPath(editor.state.doc, anchorPath);
  if (!found) return false;
  return editor.chain().focus().setTextSelection(found.pos + found.node.nodeSize).scrollIntoView().run();
}
