// @vitest-environment jsdom
// The compare screen over real diffs (RD-060, RD-066, RD-069): one aligned row per block, removed
// rows empty on the right and added rows empty on the left, status by colour AND a word, every
// block rendered by DocumentView on a one-block document — tables and lists included — headers
// per version, the title flag, and the identical, empty and approximate cases.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/copy";
import { diffDocuments } from "@/domain/documents";
import { buildCompareModel } from "../../_lib/compare-model";
import { bob, detail, doc, h, p, page } from "../../_lib/__tests__/fixtures";
import { CompareView } from "../compare-view";

afterEach(cleanup);

function renderCompare(
  leftDoc: unknown,
  rightDoc: unknown,
  over: { leftTitle?: string; rightTitle?: string; approximate?: boolean; leftMessage?: string | null } = {},
) {
  const left = detail(2, leftDoc, { title: over.leftTitle ?? "Specifications", message: over.leftMessage ?? null });
  const right = detail(5, rightDoc, { title: over.rightTitle ?? "Specifications", current: true, author: bob, message: "Restored from v. 1" });
  const model = buildCompareModel({
    space: { key: "TEAM" },
    page: page(),
    left,
    right,
    blocks: diffDocuments(left.content, right.content),
    approximate: over.approximate ?? false,
  });
  return render(<CompareView model={model} />);
}

const rows = () => screen.getAllByTestId("compare-row");
/** The row's own two cells (a rendered table inside a cell has cells of its own). */
const cells = (row: HTMLElement) => [...row.children].filter((el): el is HTMLElement => el.getAttribute("role") === "cell");
const statuses = () => rows().map((r) => r.getAttribute("data-status"));

const table = (header: string, cell: string) => ({
  type: "table",
  content: [
    { type: "tableRow", content: [{ type: "tableHeader", content: [p(header)] }] },
    { type: "tableRow", content: [{ type: "tableCell", content: [p(cell)] }] },
  ],
});
const bullets = (...items: string[]) => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
const numbered = (start: number, ...items: string[]) => ({
  type: "orderedList",
  attrs: { start },
  content: items.map((i) => ({ type: "listItem", content: [p(i)] })),
});

describe("CompareView — rows", () => {
  it("aligns added, removed, changed and unchanged blocks, each row with a left and a right cell", () => {
    renderCompare(doc(p("Intro"), p("Old scope"), p("Removed para"), p("Outro")), doc(p("Intro"), p("New scope"), p("Outro"), p("Added para")));
    expect(statuses()).toEqual(["same", "changed", "removed", "same", "added"]);
    for (const row of rows()) expect(cells(row)).toHaveLength(2);

    const [same, changed, removed, , added] = rows() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(cells(same).map((c) => c.querySelector(".rf-content")?.textContent)).toEqual(["Intro", "Intro"]);
    expect(cells(changed).map((c) => c.querySelector(".rf-content")?.textContent)).toEqual(["Old scope", "New scope"]);

    const [removedLeft, removedRight] = cells(removed) as [HTMLElement, HTMLElement];
    expect(removedLeft.querySelector(".rf-content")?.textContent).toBe("Removed para");
    expect(removedRight.querySelector(".rf-content")).toBeNull();
    expect(removedRight).toHaveTextContent(t("compare.missing", { n: 5 }));

    const [addedLeft, addedRight] = cells(added) as [HTMLElement, HTMLElement];
    expect(addedLeft.querySelector(".rf-content")).toBeNull();
    expect(addedLeft).toHaveTextContent("Not in v. 2");
    expect(addedRight.querySelector(".rf-content")?.textContent).toBe("Added para");
  });

  it("states each status in words as well as colour; unchanged rows carry no badge", () => {
    renderCompare(doc(p("Same"), p("Gone"), p("Before")), doc(p("Same"), p("After"), p("New")));
    expect(statuses()).toEqual(["same", "changed", "changed"]);
    const [same, ...changed] = rows() as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(same).queryAllByTestId("compare-badge")).toEqual([]);
    expect(same).toHaveTextContent(t("compare.status.same"));
    for (const row of changed) {
      expect(within(row).getAllByTestId("compare-badge").map((b) => b.textContent)).toEqual(["Changed", "Changed"]);
      for (const cell of cells(row)) expect(cell.className).toContain("border-lozenge-medium");
    }
    expect(cells(same).every((cell) => cell.className.includes("border-transparent"))).toBe(true);
  });

  it("badges a removed block Removed on the left and an added one Added on the right", () => {
    renderCompare(doc(p("Keep"), p("Drop")), doc(p("Keep")));
    const removed = rows()[1] as HTMLElement;
    expect(within(cells(removed)[0] as HTMLElement).getByTestId("compare-badge").textContent).toBe("Removed");
    cleanup();
    renderCompare(doc(p("Keep")), doc(p("Keep"), p("Add")));
    const added = rows()[1] as HTMLElement;
    expect(within(cells(added)[1] as HTMLElement).getByTestId("compare-badge").textContent).toBe("Added");
  });

  it("renders tables and lists through DocumentView, and a changed table cell marks the table changed", () => {
    const { container } = renderCompare(
      doc(h(2, "Scope"), table("Requirement", "Old text"), bullets("one", "two"), numbered(3, "three")),
      doc(h(2, "Scope"), table("Requirement", "New text"), bullets("one", "two"), numbered(3, "three")),
    );
    expect(statuses()).toEqual(["same", "changed", "same", "same"]);
    const changed = rows()[1] as HTMLElement;
    const [leftTable, rightTable] = cells(changed).map((c) => c.querySelector("table")) as [HTMLTableElement, HTMLTableElement];
    expect(leftTable.querySelector("th")?.textContent).toBe("Requirement");
    expect(leftTable.querySelector("td")?.textContent).toBe("Old text");
    expect(rightTable.querySelector("td")?.textContent).toBe("New text");
    const content = screen.getByTestId("compare-table");
    expect(container.querySelectorAll(".rf-content ul li")).toHaveLength(4);
    expect(content.querySelectorAll(".rf-content ol")).toHaveLength(2);
    expect(content.querySelector(".rf-content ol")).toHaveAttribute("start", "3");
  });

  it("gives every rendered heading a distinct anchor id", () => {
    const { container } = renderCompare(doc(h(2, "Scope"), h(2, "Scope")), doc(h(2, "Scope"), h(2, "Scope")));
    const ids = [...container.querySelectorAll("h2")].map((el) => el.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id.startsWith("rf-h-"))).toBe(true);
  });
});

describe("CompareView — headers and notices", () => {
  it("heads each column with its version: label linking to its read-only view, title, published, author, change note", () => {
    renderCompare(doc(p("A")), doc(p("B")), { leftMessage: "edit 2" });
    const [left, right] = screen.getAllByTestId("compare-side") as [HTMLElement, HTMLElement];
    expect(within(left).getByRole("link", { name: "v. 2" })).toHaveAttribute("href", "/spaces/TEAM/pages/p-spec?version=2");
    expect(within(right).getByRole("link", { name: "CURRENT (v. 5)" })).toHaveAttribute("href", "/spaces/TEAM/pages/p-spec");
    expect(left).toHaveTextContent("Specifications");
    expect(left).toHaveTextContent("Jul 25, 2023 10:00");
    expect(left).toHaveTextContent("Alice Admin");
    expect(left).toHaveTextContent("edit 2");
    expect(right).toHaveTextContent("Bob Editor");
    expect(right).toHaveTextContent("Restored from v. 1");
    expect(screen.getByRole("table", { name: "Changes from v. 2 to v. 5" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });

  it("omits the Comment line for a version without a change note", () => {
    renderCompare(doc(p("A")), doc(p("B")));
    const [left] = screen.getAllByTestId("compare-side") as [HTMLElement];
    expect(left).not.toHaveTextContent("Comment");
  });

  it("links back to Page History, with the breadcrumb back to the page", () => {
    renderCompare(doc(p("A")), doc(p("B")));
    expect(screen.getByRole("heading", { level: 1, name: "Compare v. 2 with v. 5" })).toBeTruthy();
    expect(screen.getByRole("link", { name: t("compare.back") })).toHaveAttribute("href", "/spaces/TEAM/pages/p-spec/history");
    const crumbs = within(screen.getByRole("navigation", { name: t("history.breadcrumb") })).getAllByRole("link");
    expect(crumbs.map((c) => [c.textContent, c.getAttribute("href")])).toEqual([
      ["Pages", "/spaces/TEAM"],
      ["Product", "/spaces/TEAM/pages/p-product"],
      ["Specifications", "/spaces/TEAM/pages/p-spec"],
    ]);
  });

  it("summarises the changes when there are some", () => {
    renderCompare(doc(p("A"), p("B")), doc(p("A2"), p("B"), p("C")));
    expect(screen.getByTestId("compare-summary").textContent).toBe("1 added, 0 removed, 1 changed");
    expect(screen.queryByTestId("compare-identical")).toBeNull();
  });

  it("says so when the content is identical, and still shows every block", () => {
    renderCompare(doc(p("A"), p("B")), doc(p("A"), p("B")));
    expect(screen.getByTestId("compare-identical").textContent).toBe("v. 2 and v. 5 have the same content.");
    expect(screen.queryByTestId("compare-summary")).toBeNull();
    expect(statuses()).toEqual(["same", "same"]);
    expect(screen.queryAllByTestId("compare-title-changed")).toEqual([]);
  });

  it("flags a title that changed on both sides, even when the content is identical", () => {
    renderCompare(doc(p("A")), doc(p("A")), { leftTitle: "Spec", rightTitle: "Specifications" });
    expect(screen.getAllByTestId("compare-title-changed").map((f) => f.textContent)).toEqual(["Title changed", "Title changed"]);
    expect(screen.getByTestId("compare-identical")).toBeTruthy();
  });

  it("handles empty documents on either side", () => {
    renderCompare(doc(), doc(p("First words")));
    expect(screen.getAllByTestId("compare-side")[0]).toHaveTextContent(t("compare.empty"));
    expect(statuses()).toEqual(["added"]);
    cleanup();
    renderCompare(doc(), doc());
    expect(screen.queryAllByTestId("compare-row")).toEqual([]);
    expect(screen.getByTestId("compare-identical")).toBeTruthy();
  });

  it("warns when the alignment is approximate (RD-066), and only then", () => {
    renderCompare(doc(p("A")), doc(p("B")), { approximate: true });
    expect(screen.getByRole("note").textContent).toBe(t("compare.approximate"));
    cleanup();
    renderCompare(doc(p("A")), doc(p("B")));
    expect(screen.queryByTestId("compare-approximate")).toBeNull();
  });
});
