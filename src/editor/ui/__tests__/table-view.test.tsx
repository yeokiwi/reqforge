// @vitest-environment jsdom
// The editor's table node view draws a table the way the page view (DocumentView) does
// (RD-057 `num`, `Responsive ▾`/`Fixed width ▾`; RD-069): the same classes, a leading 30 px
// <col> for the numbered gutter, stored widths applied to the DATA columns, and a fixed table
// as wide as its columns plus the gutter. It also survives prosemirror-tables rewriting the
// colgroup during a column drag.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentView } from "@/editor/render/document-view";
import { NUMBER_COLUMN_WIDTH, documentSchema } from "@/editor/schema";
import { EditorTableView, TABLE_CELL_MIN_WIDTH, columnWidths, tableLayout } from "../table-view";
import { table } from "./editor-harness";

function nodeOf(attrs: Record<string, unknown>, widths: (number | null)[]) {
  return documentSchema.nodeFromJSON(table(attrs, widths));
}

function colWidths(view: EditorTableView): string[] {
  return Array.from(view.colgroup.children, (col) => (col as HTMLElement).style.width);
}

/** The <table> DocumentView renders for the same content. */
function pageViewTable(attrs: Record<string, unknown>, widths: (number | null)[]): HTMLTableElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<DocumentView content={{ type: "doc", content: [table(attrs, widths)] }} />);
  const el = host.querySelector("table");
  if (!el) throw new Error("no table");
  return el;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("columnWidths and tableLayout", () => {
  it("reads one width per data column from the first row, expanding colspans", () => {
    const node = documentSchema.nodeFromJSON({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colspan: 2, colwidth: [100, 50] }, content: [{ type: "paragraph" }] },
            { type: "tableHeader", content: [{ type: "paragraph" }] },
          ],
        },
      ],
    });
    expect(columnWidths(node)).toEqual([100, 50, null]);
  });

  it("responsive: no inline width, whatever the stored widths", () => {
    const layout = tableLayout({ widthMode: "responsive", numberedColumn: true }, [100, 50]);
    expect(layout).toMatchObject({ mode: "responsive", numbered: true, width: null, minWidth: null });
    expect(layout.className).toBe("rf-table rf-table--responsive rf-table--numbered");
  });

  it("fixed with every column sized: exactly their sum, plus the 30 px gutter when numbered", () => {
    expect(tableLayout({ widthMode: "fixed" }, [100, 50]).width).toBe(150);
    expect(tableLayout({ widthMode: "fixed", numberedColumn: true }, [100, 50]).width).toBe(150 + NUMBER_COLUMN_WIDTH);
  });

  it("fixed with an unsized column: at least the sum, counting it at the minimum", () => {
    const layout = tableLayout({ widthMode: "fixed" }, [100, null]);
    expect(layout.width).toBeNull();
    expect(layout.minWidth).toBe(100 + TABLE_CELL_MIN_WIDTH);
  });

  it("unknown attribute values fall back to the defaults", () => {
    expect(tableLayout({ widthMode: "wide", numberedColumn: "yes" }, []).className).toBe("rf-table rf-table--responsive");
  });
});

describe("EditorTableView", () => {
  it("renders a numbered fixed table exactly as the page view does: classes, gutter col, data widths, total width", () => {
    const attrs = { widthMode: "fixed", numberedColumn: true };
    const view = new EditorTableView(nodeOf(attrs, [120, 80]));
    const page = pageViewTable(attrs, [120, 80]);
    expect(view.table.className).toBe(page.className);
    expect(view.table.getAttribute("data-width-mode")).toBe(page.getAttribute("data-width-mode"));
    expect(view.table.getAttribute("data-numbered-column")).toBe(page.getAttribute("data-numbered-column"));
    expect(view.table.style.width).toBe(page.style.width);
    expect(view.table.style.width).toBe(`${120 + 80 + NUMBER_COLUMN_WIDTH}px`);
    const pageCols = Array.from(page.querySelectorAll("col"), (col) => [col.className, col.style.width]);
    const editorCols = Array.from(view.colgroup.children, (col) => [col.className, (col as HTMLElement).style.width]);
    expect(editorCols).toEqual(pageCols);
    expect(editorCols[0]).toEqual(["rf-table__number-col", `${NUMBER_COLUMN_WIDTH}px`]);
    view.destroy();
  });

  it("without the numbered column, stored widths start at the first column", () => {
    const view = new EditorTableView(nodeOf({ widthMode: "fixed" }, [120, 80]));
    expect(colWidths(view)).toEqual(["120px", "80px"]);
    expect(view.table.className).toBe(pageViewTable({ widthMode: "fixed" }, [120, 80]).className);
    view.destroy();
  });

  it("wraps the table in .rf-table-wrapper and gives ProseMirror a tbody to fill", () => {
    const view = new EditorTableView(nodeOf({}, [null, null]));
    expect(view.dom.classList.contains("rf-table-wrapper")).toBe(true);
    expect(view.contentDOM.tagName).toBe("TBODY");
    expect(view.table.parentElement).toBe(view.dom);
    view.destroy();
  });

  it("updates in place when the numbered column or the width mode is toggled", () => {
    const view = new EditorTableView(nodeOf({}, [100, 60]));
    expect(view.update(nodeOf({ widthMode: "fixed", numberedColumn: true }, [100, 60]))).toBe(true);
    expect(view.table.className).toBe("rf-table rf-table--fixed rf-table--numbered");
    expect(colWidths(view)).toEqual(["30px", "100px", "60px"]);
    expect(view.table.style.width).toBe("190px");
    view.update(nodeOf({ widthMode: "responsive" }, [100, 60]));
    expect(colWidths(view)).toEqual(["100px", "60px"]);
    expect(view.table.style.width).toBe("");
    expect(view.table.hasAttribute("data-numbered-column")).toBe(false);
    view.destroy();
  });

  it("refuses to update to another node type", () => {
    const view = new EditorTableView(nodeOf({}, [null, null]));
    expect(view.update(documentSchema.nodeFromJSON({ type: "paragraph" }))).toBe(false);
    view.destroy();
  });

  it("ignores mutations of its own colgroup and table styling, not of the content", () => {
    const view = new EditorTableView(nodeOf({}, [null, null]));
    const record = (target: Node, type: "attributes" | "childList") => ({ type, target }) as unknown as MutationRecord;
    expect(view.ignoreMutation(record(view.colgroup, "childList"))).toBe(true);
    expect(view.ignoreMutation(record(view.table, "attributes"))).toBe(true);
    expect(view.ignoreMutation(record(view.contentDOM, "childList"))).toBe(false);
    view.destroy();
  });

  it("puts the gutter back when prosemirror-tables rewrites the colgroup as data columns during a drag", async () => {
    const view = new EditorTableView(nodeOf({ widthMode: "fixed", numberedColumn: true }, [120, 80]));
    // What updateColumnsOnResize does: write the data widths into the FIRST cols, drop the extra.
    const cols = Array.from(view.colgroup.children) as HTMLElement[];
    (cols[0] as HTMLElement).style.width = "150px";
    (cols[1] as HTMLElement).style.width = "80px";
    cols[2]?.remove();
    view.table.style.width = "230px";
    await flush();
    expect(colWidths(view)).toEqual(["30px", "150px", "80px"]);
    expect(view.colgroup.children[0]?.className).toBe("rf-table__number-col");
    expect(view.table.style.width).toBe(`${150 + 80 + NUMBER_COLUMN_WIDTH}px`);
    view.destroy();
  });

  it("stops observing when destroyed", async () => {
    const view = new EditorTableView(nodeOf({ numberedColumn: true }, [120, 80]));
    view.destroy();
    view.colgroup.replaceChildren();
    await flush();
    expect(view.colgroup.children).toHaveLength(0);
  });
});
