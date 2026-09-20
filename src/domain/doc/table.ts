import { childPath, childrenOf, numericAttr, type AnchorPath, type PMNode } from './types';

export type TableCell = {
  node: PMNode;
  path: AnchorPath;
  /** Grid coordinates after colspan/rowspan expansion. */
  row: number;
  column: number;
  colspan: number;
  rowspan: number;
  isHeader: boolean;
};

export type TableShape = {
  /** Cells in document order, grouped by grid row. Spanned cells appear once, at their origin. */
  rows: TableCell[][];
  columnCount: number;
  /** spec: 03-authoring-and-indexing.md §2 — horizontal layout needs a header row. */
  hasHeaderRow: boolean;
  /** spec: 03 §2 — vertical layout needs a header *column* (the first column). */
  hasHeaderColumn: boolean;
};

const CELL_TYPES = new Set(['tableCell', 'tableHeader']);

/**
 * Builds a grid view of a `table` node, resolving colspan and rowspan so that
 * "the cell above column 3" is answerable.
 * spec: 03-authoring-and-indexing.md §2 (scope rules), rule S4 (no header at all)
 */
export function analyseTable(table: PMNode, tablePath: AnchorPath = ''): TableShape {
  const rowNodes = childrenOf(table)
    .map((node, index) => ({ node, path: childPath(tablePath, index) }))
    .filter((entry) => entry.node.type === 'tableRow');

  const occupied = new Map<string, true>();
  const rows: TableCell[][] = [];

  rowNodes.forEach((rowEntry, rowIndex) => {
    const cells: TableCell[] = [];
    let column = 0;

    childrenOf(rowEntry.node).forEach((cellNode, cellIndex) => {
      if (!CELL_TYPES.has(cellNode.type)) return;
      while (occupied.has(`${rowIndex}:${column}`)) column += 1;

      const colspan = Math.max(numericAttr(cellNode, 'colspan') ?? 1, 1);
      const rowspan = Math.max(numericAttr(cellNode, 'rowspan') ?? 1, 1);

      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
        for (let c = column; c < column + colspan; c += 1) {
          occupied.set(`${r}:${c}`, true);
        }
      }

      cells.push({
        node: cellNode,
        path: childPath(rowEntry.path, cellIndex),
        row: rowIndex,
        column,
        colspan,
        rowspan,
        isHeader: cellNode.type === 'tableHeader',
      });

      column += colspan;
    });

    rows.push(cells);
  });

  const columnCount = rows.reduce(
    (max, cells) => Math.max(max, cells.reduce((acc, cell) => Math.max(acc, cell.column + cell.colspan), 0)),
    0,
  );

  const firstRow = rows[0] ?? [];
  const hasHeaderRow = firstRow.length > 0 && firstRow.every((cell) => cell.isHeader);
  const hasHeaderColumn =
    rows.length > 0 &&
    rows.every((cells) => {
      const first = cells.find((cell) => cell.column === 0);
      return first !== undefined && first.isHeader;
    });

  return { rows, columnCount, hasHeaderRow, hasHeaderColumn };
}

/** The cell occupying a grid coordinate, following spans back to the origin cell. */
export function cellAt(shape: TableShape, row: number, column: number): TableCell | undefined {
  for (const cells of shape.rows) {
    for (const cell of cells) {
      if (
        row >= cell.row &&
        row < cell.row + cell.rowspan &&
        column >= cell.column &&
        column < cell.column + cell.colspan
      ) {
        return cell;
      }
    }
  }
  return undefined;
}
