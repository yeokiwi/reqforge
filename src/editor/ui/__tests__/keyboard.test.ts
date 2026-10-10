// The pure halves of keyboard navigation: a toolbar's roving focus (one tab stop, Left/Right
// wrap, Home/End) and the 2-D grid of the table-size and emoji pickers.
import { describe, expect, it } from "vitest";
import { EMOJI, TABLE_GRID, nextGridIndex } from "../pickers";
import { nextRovingIndex } from "../roving";

describe("toolbar roving focus", () => {
  it("Right and Left move one control and wrap at the ends", () => {
    expect(nextRovingIndex("ArrowRight", 0, 5)).toBe(1);
    expect(nextRovingIndex("ArrowRight", 4, 5)).toBe(0);
    expect(nextRovingIndex("ArrowLeft", 3, 5)).toBe(2);
    expect(nextRovingIndex("ArrowLeft", 0, 5)).toBe(4);
  });

  it("Home and End jump to the ends", () => {
    expect(nextRovingIndex("Home", 3, 5)).toBe(0);
    expect(nextRovingIndex("End", 1, 5)).toBe(4);
  });

  it("from outside the controls, Right goes to the first and Left to the last", () => {
    expect(nextRovingIndex("ArrowRight", -1, 5)).toBe(0);
    expect(nextRovingIndex("ArrowLeft", -1, 5)).toBe(4);
  });

  it("other keys, and an empty toolbar, are not handled", () => {
    expect(nextRovingIndex("ArrowDown", 1, 5)).toBeNull();
    expect(nextRovingIndex("Enter", 1, 5)).toBeNull();
    expect(nextRovingIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("picker grids", () => {
  const cols = TABLE_GRID.columns;
  const count = TABLE_GRID.columns * TABLE_GRID.rows;

  it("arrow keys move in two dimensions and stop at the edges", () => {
    expect(nextGridIndex("ArrowRight", 0, cols, count)).toBe(1);
    expect(nextGridIndex("ArrowDown", 0, cols, count)).toBe(cols);
    expect(nextGridIndex("ArrowUp", 0, cols, count)).toBe(0);
    expect(nextGridIndex("ArrowLeft", 0, cols, count)).toBe(0);
    expect(nextGridIndex("ArrowRight", count - 1, cols, count)).toBe(count - 1);
    expect(nextGridIndex("ArrowDown", count - 1, cols, count)).toBe(count - 1);
    expect(nextGridIndex("ArrowUp", cols + 3, cols, count)).toBe(3);
  });

  it("Home and End go to the ends of the row", () => {
    expect(nextGridIndex("Home", cols + 4, cols, count)).toBe(cols);
    expect(nextGridIndex("End", cols + 4, cols, count)).toBe(2 * cols - 1);
  });

  it("End on a short last row stops at the last cell", () => {
    expect(nextGridIndex("End", 41, 8, 43)).toBe(42);
    expect(nextGridIndex("ArrowDown", 37, 8, 43)).toBe(37);
  });

  it("other keys are not handled", () => {
    expect(nextGridIndex("Tab", 0, cols, count)).toBeNull();
    expect(nextGridIndex("ArrowRight", 0, cols, 0)).toBeNull();
  });

  it("the table grid is 10 × 8 and the emoji set has no duplicates", () => {
    expect(TABLE_GRID).toEqual({ columns: 10, rows: 8 });
    expect(new Set(EMOJI).size).toBe(EMOJI.length);
  });
});
