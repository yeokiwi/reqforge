// The editor's table node view. It renders a table the way the page view (DocumentView) does,
// so content.css draws both alike: a `rf-table-wrapper` around a `table.rf-table` carrying
// `rf-table--responsive` or `rf-table--fixed`, and `rf-table--numbered` with a leading 30 px
// `<col>` for the counter gutter when the numbered column is on (RD-057 `num`, RD-069). Stored
// column widths apply to the DATA columns; the gutter never takes one of them.
//
// prosemirror-tables' column resizing draws a drag in progress by rewriting the table's FIRST
// `<colgroup>` as if it held only data columns. With a gutter `<col>` first that would shift
// every width one column left and drop the last one, so the view watches its colgroup and puts
// the gutter back, keeping the widths prosemirror-tables wrote for the data columns.
// spec: docs/specs/09-decision-log.md sections RD-057 (`num`, `Responsive ▾`/`Fixed width ▾`) and RD-069 (numbered column)
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { CLASS, NUMBER_COLUMN_WIDTH, type TableWidthMode } from "@/editor/schema";

/** The narrowest a column without a stored width is assumed to be (TipTap's default). */
export const TABLE_CELL_MIN_WIDTH = 25;

export interface TableLayout {
  readonly mode: TableWidthMode;
  readonly numbered: boolean;
  /** `rf-table rf-table--<mode>` and `rf-table--numbered`, as DocumentView writes them. */
  readonly className: string;
  /** One entry per data column: its width in px, or null when none is stored. */
  readonly widths: readonly (number | null)[];
  /** Inline `width` in px, or null (a responsive table is 100 % wide by CSS). */
  readonly width: number | null;
  /** Inline `min-width` in px, or null. */
  readonly minWidth: number | null;
}

function positiveOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** The data-column widths of a table, from its first row's `colwidth`s, like DocumentView. */
// spec: docs/specs/09-decision-log.md section RD-069 (stored column widths apply to the data columns)
export function columnWidths(table: PMNode): (number | null)[] {
  const widths: (number | null)[] = [];
  const row = table.firstChild;
  if (!row) return widths;
  row.forEach((cell) => {
    const colspan = typeof cell.attrs.colspan === "number" && cell.attrs.colspan > 0 ? cell.attrs.colspan : 1;
    const colwidth: unknown = cell.attrs.colwidth;
    for (let i = 0; i < colspan; i++) {
      widths.push(Array.isArray(colwidth) ? positiveOrNull(colwidth[i]) : null);
    }
  });
  return widths;
}

/**
 * How a table is laid out in the editor. Fixed width: when every data column has a width the
 * table is exactly their sum plus the gutter, as in the page view; otherwise it is at least the
 * sum, counting an unsized column at the minimum. Responsive: no inline width (CSS makes it
 * 100 %), as in the page view.
 */
// spec: docs/specs/09-decision-log.md sections RD-057 and RD-069
export function tableLayout(
  attrs: { readonly widthMode?: unknown; readonly numberedColumn?: unknown },
  widths: readonly (number | null)[],
  cellMinWidth: number = TABLE_CELL_MIN_WIDTH,
): TableLayout {
  const mode: TableWidthMode = attrs.widthMode === "fixed" ? "fixed" : "responsive";
  const numbered = attrs.numberedColumn === true;
  const className = [CLASS.table, CLASS.tableWidthMode(mode), numbered ? CLASS.tableNumbered : null].filter(Boolean).join(" ");
  const gutter = numbered ? NUMBER_COLUMN_WIDTH : 0;
  let width: number | null = null;
  let minWidth: number | null = null;
  if (mode === "fixed" && widths.length > 0) {
    const allSized = widths.every((w) => w !== null);
    const total = widths.reduce<number>((sum, w) => sum + (w ?? cellMinWidth), 0) + gutter;
    if (allSized) width = total;
    else minWidth = total;
  }
  return { mode, numbered, className, widths, width, minWidth };
}

function parsePx(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match ? positiveOrNull(Number(match[1])) : null;
}

export class EditorTableView implements NodeView {
  readonly dom: HTMLDivElement;
  readonly table: HTMLTableElement;
  readonly colgroup: HTMLTableColElement;
  readonly contentDOM: HTMLTableSectionElement;
  private node: PMNode;
  private readonly observer: MutationObserver | null;

  constructor(
    node: PMNode,
    private readonly cellMinWidth: number = TABLE_CELL_MIN_WIDTH,
  ) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = `${CLASS.tableWrapper} tableWrapper`;
    this.table = this.dom.appendChild(document.createElement("table"));
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.observer =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(() => this.repairAfterExternalWrite());
    this.observer?.observe(this.colgroup, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    this.observer?.observe(this.table, { attributes: true, attributeFilter: ["style"] });
    this.render(tableLayout(node.attrs, columnWidths(node), cellMinWidth));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(tableLayout(node.attrs, columnWidths(node), this.cellMinWidth));
    return true;
  }

  /** Our own colgroup and table styling are not document content. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    if (this.colgroup.contains(mutation.target)) return true;
    return mutation.type === "attributes" && (mutation.target === this.table || mutation.target === this.dom);
  }

  destroy(): void {
    this.observer?.disconnect();
  }

  /**
   * Someone else (prosemirror-tables during a column drag) rewrote the colgroup or the table's
   * width. What it wrote into the colgroup, in order, are the data-column widths: keep those
   * and lay the table out again.
   */
  private repairAfterExternalWrite(): void {
    const written = Array.from(this.colgroup.children, (col) => parsePx((col as HTMLElement).style.width));
    const expected = columnWidths(this.node).length;
    const widths = written.length === expected ? written : columnWidths(this.node);
    this.render(tableLayout(this.node.attrs, widths, this.cellMinWidth));
  }

  private render(layout: TableLayout): void {
    const table = this.table;
    if (table.className !== layout.className) table.className = layout.className;
    table.setAttribute("data-width-mode", layout.mode);
    if (layout.numbered) table.setAttribute("data-numbered-column", "true");
    else table.removeAttribute("data-numbered-column");

    const cols: { className: string; width: string }[] = [];
    if (layout.numbered) cols.push({ className: CLASS.tableNumberColumn, width: `${NUMBER_COLUMN_WIDTH}px` });
    for (const w of layout.widths) cols.push({ className: "", width: w === null ? "" : `${w}px` });

    while (this.colgroup.children.length > cols.length) this.colgroup.lastElementChild?.remove();
    while (this.colgroup.children.length < cols.length) this.colgroup.appendChild(document.createElement("col"));
    cols.forEach((spec, i) => {
      const col = this.colgroup.children[i] as HTMLTableColElement;
      if (col.className !== spec.className) col.className = spec.className;
      if (col.style.width !== spec.width) col.style.width = spec.width;
    });

    const width = layout.width === null ? "" : `${layout.width}px`;
    const minWidth = layout.minWidth === null ? "" : `${layout.minWidth}px`;
    if (table.style.width !== width) table.style.width = width;
    if (table.style.minWidth !== minWidth) table.style.minWidth = minWidth;
    // Our own writes are not someone else's: drop their records so the observer stays quiet.
    this.observer?.takeRecords();
  }
}
