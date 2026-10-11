// The tree's keyboard (WAI-ARIA APG tree view) and the keyboard route to moving pages (10 §3.2).
import { describe, expect, it } from "vitest";
import { treeKeyAction, type KeyInput } from "../keyboard";
import { buildModel } from "../model";
import { sampleTree } from "./fake-api";

const model = buildModel(sampleTree());
const open = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => set.has(id);
};
const key = (k: string, mods: Partial<Omit<KeyInput, "key">> = {}): KeyInput => ({
  key: k,
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe("treeKeyAction — moving focus", () => {
  it("↓ and ↑ walk the visible rows depth-first", () => {
    const isOpen = open("s");
    expect(treeKeyAction(key("ArrowDown"), model, isOpen, "s", false)).toEqual({ kind: "focus", id: "h" });
    expect(treeKeyAction(key("ArrowDown"), model, isOpen, "t1a", false)).toEqual({ kind: "focus", id: "team" });
    expect(treeKeyAction(key("ArrowUp"), model, isOpen, "team", false)).toEqual({ kind: "focus", id: "t1a" });
  });

  it("swallows ↑ on the first row and ↓ on the last, so the page does not scroll", () => {
    expect(treeKeyAction(key("ArrowUp"), model, open(), "s", false)).toEqual({ kind: "none" });
    expect(treeKeyAction(key("ArrowDown"), model, open(), "team", false)).toEqual({ kind: "none" });
  });

  it("Home and End go to the first and last visible rows", () => {
    expect(treeKeyAction(key("End"), model, open("team"), "s", false)).toEqual({ kind: "focus", id: "m" });
    expect(treeKeyAction(key("Home"), model, open("team"), "m", false)).toEqual({ kind: "focus", id: "s" });
  });

  it("→ opens a closed parent, then moves to its first child; does nothing on a leaf", () => {
    expect(treeKeyAction(key("ArrowRight"), model, open(), "s", false)).toEqual({ kind: "expand", id: "s" });
    expect(treeKeyAction(key("ArrowRight"), model, open("s"), "s", false)).toEqual({ kind: "focus", id: "h" });
    expect(treeKeyAction(key("ArrowRight"), model, open("s"), "h", false)).toEqual({ kind: "none" });
  });

  it("← closes an open parent, else moves to the parent; does nothing on a closed root", () => {
    expect(treeKeyAction(key("ArrowLeft"), model, open("s"), "s", false)).toEqual({ kind: "collapse", id: "s" });
    expect(treeKeyAction(key("ArrowLeft"), model, open("s"), "h", false)).toEqual({ kind: "focus", id: "s" });
    expect(treeKeyAction(key("ArrowLeft"), model, open(), "team", false)).toEqual({ kind: "none" });
  });

  it("Enter opens the page", () => {
    expect(treeKeyAction(key("Enter"), model, open(), "s", false)).toEqual({ kind: "open", id: "s" });
  });

  it("leaves other keys and modified keys to the browser", () => {
    expect(treeKeyAction(key("a"), model, open(), "s", false)).toBeNull();
    expect(treeKeyAction(key("Tab"), model, open(), "s", false)).toBeNull();
    expect(treeKeyAction(key("ArrowDown", { ctrlKey: true }), model, open(), "s", false)).toBeNull();
    expect(treeKeyAction(key("ArrowDown", { shiftKey: true }), model, open(), "s", false)).toBeNull();
    // Alt+← is the browser's Back: never claimed without Shift.
    expect(treeKeyAction(key("ArrowLeft", { altKey: true }), model, open(), "h", true)).toBeNull();
    expect(treeKeyAction(key("ArrowRight", { altKey: true }), model, open(), "h", true)).toBeNull();
    expect(treeKeyAction(key("ArrowDown"), model, open(), "unknown", true)).toBeNull();
  });
});

describe("treeKeyAction — moving pages (editors only)", () => {
  it("Alt+↑ / Alt+↓ move the page among its siblings", () => {
    expect(treeKeyAction(key("ArrowUp", { altKey: true }), model, open("s"), "t1", true)).toEqual({
      kind: "move",
      id: "t1",
      target: { parentId: "s", index: 0 },
    });
    expect(treeKeyAction(key("ArrowDown", { altKey: true }), model, open("s"), "t1", true)).toEqual({
      kind: "move",
      id: "t1",
      target: { parentId: "s", index: 2 },
    });
  });

  it("Alt+Shift+→ moves it under the page above; Alt+Shift+← up a level", () => {
    expect(treeKeyAction(key("ArrowRight", { altKey: true, shiftKey: true }), model, open("s"), "t1", true)).toEqual({
      kind: "move",
      id: "t1",
      target: { parentId: "h", index: 0 },
    });
    expect(treeKeyAction(key("ArrowLeft", { altKey: true, shiftKey: true }), model, open("s"), "t1", true)).toEqual({
      kind: "move",
      id: "t1",
      target: { parentId: null, index: 1 },
    });
  });

  it("swallows a move key with nowhere to go", () => {
    expect(treeKeyAction(key("ArrowUp", { altKey: true }), model, open(), "s", true)).toEqual({ kind: "none" });
  });

  it("offers no move keys to a viewer who cannot edit", () => {
    expect(treeKeyAction(key("ArrowUp", { altKey: true }), model, open("s"), "t1", false)).toBeNull();
    expect(treeKeyAction(key("ArrowRight", { altKey: true, shiftKey: true }), model, open("s"), "t1", false)).toBeNull();
  });
});
