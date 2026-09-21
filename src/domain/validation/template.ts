import { analyseTable, childrenOf, plainText, WITHOUT_MARKERS, type PMNode } from '@/domain/doc';

/**
 * Templates: a type's columns, scaffolded into an empty table.
 * spec: 03-authoring-and-indexing.md §6 and 06-requirement-types.md §3 — "Inserting a
 * typed key into an **empty** table scaffolds the type's required and optional columns,
 * in `ordinal` order, with the required ones first. It does nothing once the table has
 * content" (research §2.4), because rewriting a table the author has filled is hostile.
 */

export type TemplateColumn = { name: string; required: boolean; ordinal: number };

export function parseTemplateColumns(rows: unknown): TemplateColumn[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (name.length === 0) return [];
    return [
      {
        name,
        required: record.required === true,
        ordinal: typeof record.ordinal === 'number' && Number.isFinite(record.ordinal) ? record.ordinal : 0,
      },
    ];
  });
}

/** Required first, then by the author's ordinal, then by name so the order is stable. */
export function orderedColumns(columns: readonly TemplateColumn[]): TemplateColumn[] {
  return [...columns].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
    return a.name.localeCompare(b.name);
  });
}

/**
 * "Empty" means: every cell is blank, and the table holds no requirement marker, link,
 * report or embedded matrix. A table with one stray space in a cell is still empty; a
 * table someone has started filling is not.
 */
export function tableIsEmpty(table: PMNode): boolean {
  const shape = analyseTable(table);
  for (const cells of shape.rows) {
    for (const cell of cells) {
      if (plainText(cell.node, WITHOUT_MARKERS).trim().length > 0) return false;
      if (containsAnyNode(cell.node, NON_EMPTY_TYPES)) return false;
    }
  }
  return true;
}

const NON_EMPTY_TYPES = new Set(['requirement', 'requirementLink', 'report', 'savedMatrix', 'image']);

function containsAnyNode(node: PMNode, types: ReadonlySet<string>): boolean {
  if (types.has(node.type)) return true;
  return childrenOf(node).some((child) => containsAnyNode(child, types));
}

/**
 * The header row a type's template scaffolds, plus one empty body row.
 * Returned as document JSON so the same shape serves the editor's scaffold and the
 * "new document from type" skeleton (spec 06 §3) — "one correctly-shaped table" is
 * defined once.
 */
export function templateTable(columns: readonly TemplateColumn[]): PMNode | null {
  const ordered = orderedColumns(columns);
  if (ordered.length === 0) return null;

  const headerCell = (name: string): PMNode => ({
    type: 'tableHeader',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: name }] }],
  });
  const bodyCell = (): PMNode => ({ type: 'tableCell', content: [{ type: 'paragraph' }] });

  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: ordered.map((column) => headerCell(column.name)) },
      { type: 'tableRow', content: ordered.map(() => bodyCell()) },
    ],
  };
}

/** A document skeleton holding one correctly-shaped table (spec 06 §3). */
export function templateDocument(columns: readonly TemplateColumn[]): PMNode {
  const table = templateTable(columns);
  return {
    type: 'doc',
    content: table ? [{ type: 'paragraph' }, table, { type: 'paragraph' }] : [{ type: 'paragraph' }],
  };
}
