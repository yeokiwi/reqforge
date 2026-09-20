import {
  analyseTable,
  cellAt,
  childPath,
  childrenOf,
  plainText,
  WITHOUT_MARKERS,
  type AnchorPath,
  type PMNode,
  type TableShape,
} from '@/domain/doc';
import type { RequirementLayout } from './types';

export type Ancestor = { node: PMNode; path: AnchorPath };

export type Marker = { node: PMNode; path: AnchorPath; ancestors: Ancestor[] };

const CELL_TYPES = new Set(['tableCell', 'tableHeader']);
const BLOCK_SCOPE_TYPES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock']);

/** Every `requirement` and `requirementLink` node, in document order, with its ancestry. */
export function findNodes(root: PMNode, types: ReadonlySet<string>): Marker[] {
  const found: Marker[] = [];

  const visit = (node: PMNode, path: AnchorPath, ancestors: Ancestor[]): void => {
    if (types.has(node.type)) {
      found.push({ node, path, ancestors: [...ancestors] });
      return;
    }
    const children = childrenOf(node);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child) visit(child, childPath(path, index), [...ancestors, { node, path }]);
    }
  };

  visit(root, '', []);
  return found;
}

export type Scope = {
  layout: RequirementLayout;
  /** Identity of the scope within the document; two markers sharing it break rule S1. */
  id: string;
  /** The nodes the requirement's body is built from. */
  body: PMNode;
  /** Plain-text title, before any propertyConfig override (slice 4). */
  title: string;
  /** True when a table has neither a header row nor a header column — rule S4. */
  headerless: boolean;
  table?: { node: PMNode; path: AnchorPath; shape: TableShape; row: number; column: number };
};

/**
 * Decides what a marker's requirement covers.
 * spec: 03-authoring-and-indexing.md §2 — the three layouts.
 *
 * Layout precedence when a table has both a header row and a header column is RD-023:
 * the header row wins, because that is Requirement Yogi's common case and the column
 * headers still name the properties.
 */
export function resolveScope(marker: Marker): Scope {
  const cellIndex = findLastIndex(marker.ancestors, (ancestor) => CELL_TYPES.has(ancestor.node.type));

  if (cellIndex >= 0) {
    const cell = marker.ancestors[cellIndex]!;
    const table = findLastIndex(marker.ancestors, (ancestor) => ancestor.node.type === 'table');
    if (table >= 0) {
      const tableAncestor = marker.ancestors[table]!;
      const shape = analyseTable(tableAncestor.node, tableAncestor.path);
      const located = [...shape.rows].flat().find((entry) => entry.path === cell.path);
      if (located) {
        const headerless = !shape.hasHeaderRow && !shape.hasHeaderColumn;
        const layout: RequirementLayout =
          shape.hasHeaderRow || headerless ? 'HORIZONTAL_TABLE' : 'VERTICAL_TABLE';

        return layout === 'HORIZONTAL_TABLE'
          ? horizontalScope(tableAncestor, shape, located.row, located.column, headerless)
          : verticalScope(tableAncestor, shape, located.row, located.column);
      }
    }
  }

  const blockIndex = findLastIndex(marker.ancestors, (ancestor) => BLOCK_SCOPE_TYPES.has(ancestor.node.type));
  const block = blockIndex >= 0 ? marker.ancestors[blockIndex]! : { node: marker.node, path: marker.path };

  return {
    layout: 'PARAGRAPH',
    id: `block:${block.path}`,
    body: block.node,
    title: plainText(block.node, WITHOUT_MARKERS),
    headerless: false,
  };
}

/** spec: 03 §2 — horizontal table: the scope is the whole **row**. */
function horizontalScope(
  table: Ancestor,
  shape: TableShape,
  row: number,
  column: number,
  headerless: boolean,
): Scope {
  const headerRow = headerless ? undefined : shape.rows[0];
  const cells = shape.rows[row] ?? [];

  const body: PMNode = {
    type: 'table',
    content: [
      ...(headerRow && row !== 0 ? [{ type: 'tableRow', content: headerRow.map((cell) => cell.node) }] : []),
      { type: 'tableRow', content: cells.map((cell) => cell.node) },
    ],
  };

  return {
    layout: 'HORIZONTAL_TABLE',
    id: `table:${table.path}:row:${row}`,
    body,
    title: titleFromHorizontal(shape, row, column),
    headerless,
    table: { node: table.node, path: table.path, shape, row, column },
  };
}

/** spec: 03 §2 — vertical table: the scope is the whole **column**. */
function verticalScope(table: Ancestor, shape: TableShape, row: number, column: number): Scope {
  const rows: PMNode[] = shape.rows.map((_, rowIndex) => {
    const header = cellAt(shape, rowIndex, 0);
    const value = cellAt(shape, rowIndex, column);
    return {
      type: 'tableRow',
      content: [header?.node, value?.node].filter((node): node is PMNode => node !== undefined),
    };
  });

  const titleCell = cellAt(shape, 0, column);

  return {
    layout: 'VERTICAL_TABLE',
    id: `table:${table.path}:col:${column}`,
    body: { type: 'table', content: rows },
    title: titleCell ? plainText(titleCell.node, WITHOUT_MARKERS) : '',
    headerless: false,
    table: { node: table.node, path: table.path, shape, row, column },
  };
}

/**
 * Default title column: the first column.
 * spec: 03 §1.3 — "the first non-ignored column is the title" (research §2.5).
 * Slice 4's `propertyConfig` overrides this.
 */
function titleFromHorizontal(shape: TableShape, row: number, markerColumn: number): string {
  const first = cellAt(shape, row, 0);
  const title = first ? plainText(first.node, WITHOUT_MARKERS) : '';
  if (title.length > 0) return title;

  const own = cellAt(shape, row, markerColumn);
  return own ? plainText(own.node, WITHOUT_MARKERS) : '';
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return index;
  }
  return -1;
}
