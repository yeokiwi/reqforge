// One drawn tree's own state: the roving tab stop, the highlight path, the drop indicator.
import { describe, expect, it, vi } from "vitest";
import { PageTreeStore } from "../store";
import { TreeView } from "../view-state";
import { fakeApi, sampleTree } from "./fake-api";

const storeWith = (currentId: string | null = null) =>
  new PageTreeStore({ spaceKey: "TEAM", canEdit: true, initial: { status: "ready", pages: sampleTree() }, currentId, fetchImpl: fakeApi().fetchImpl });

describe("TreeView — tab stop", () => {
  it("is the first root by default, the current page when there is one", () => {
    expect(new TreeView(storeWith()).getTabStop()).toBe("s");
    expect(new TreeView(storeWith("n")).getTabStop()).toBe("n"); // its ancestors were opened
  });

  it("follows focus, and falls back to the closest drawn row when a parent closes", () => {
    const store = storeWith("n");
    const view = new TreeView(store);
    view.setActive("n");
    expect(view.getTabStop()).toBe("n");
    view.collapse("t1a");
    expect(view.getTabStop()).toBe("t1a");
    view.collapse("s");
    expect(view.getTabStop()).toBe("s");
  });
});

describe("TreeView — ?highlight= (10 §11, RD-059)", () => {
  it("draws the path open from the first render, then commits it to the shared store", () => {
    const store = storeWith();
    const view = new TreeView(store, "n");
    expect(view.isOpen("s") && view.isOpen("t1a")).toBe(true);
    expect(store.isExpanded("s")).toBe(false);
    const stop = view.attach();
    expect(store.isExpanded("s") && store.isExpanded("t1a")).toBe(true);
    expect(view.isHighlighted("n")).toBe(true);
    expect(view.getTabStop()).toBe("n");
    stop();
  });

  it("opens the path once the pages arrive, if they were not there yet", () => {
    const store = new PageTreeStore({ spaceKey: "TEAM", canEdit: false, initial: null, fetchImpl: fakeApi().fetchImpl });
    const view = new TreeView(store, "n");
    const stop = view.attach();
    expect(view.isOpen("s")).toBe(false);
    store.adopt(sampleTree());
    expect(store.isExpanded("s") && store.isExpanded("t1a")).toBe(true);
    // Once only: closing it again is the reader's choice.
    view.collapse("s");
    store.adopt([...sampleTree()]);
    expect(store.isExpanded("s")).toBe(false);
    stop();
  });

  it("ignores an id that is not in the tree", () => {
    const store = storeWith();
    const view = new TreeView(store, "ghost");
    const stop = view.attach();
    expect(view.isHighlighted("ghost")).toBe(false);
    expect(view.getTabStop()).toBe("s");
    stop();
  });

  it("asks the highlighted row to scroll into view exactly once", () => {
    const view = new TreeView(storeWith(), "n");
    expect(view.takeScrollRequest("h")).toBe(false);
    expect(view.takeScrollRequest("n")).toBe(true);
    expect(view.takeScrollRequest("n")).toBe(false);
  });
});

describe("TreeView — drop indicator", () => {
  it("emits only when the indicator actually moves", () => {
    const view = new TreeView(storeWith());
    const listener = vi.fn();
    view.subscribe(listener);
    view.startDrag("h");
    listener.mockClear();
    view.setDrop({ id: "t1", zone: "before" });
    view.setDrop({ id: "t1", zone: "before" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(view.dropZoneFor("t1")).toBe("before");
    expect(view.dropZoneFor("h")).toBeNull();
    view.clearDropFor("h"); // not where the indicator is
    expect(view.dropZoneFor("t1")).toBe("before");
    view.endDrag();
    expect(view.dropZoneFor("t1")).toBeNull();
    expect(view.dragId).toBeNull();
  });
});
