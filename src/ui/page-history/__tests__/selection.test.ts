// Page History's selection rule and store (10 section 23, RD-060): "Compare selected versions"
// takes exactly two versions, older first; the store is the double-submit guard and keeps its
// snapshots stable so useSyncExternalStore subscribers re-render only on a real change.
import { describe, expect, it, vi } from "vitest";
import { comparePair, createHistoryStore } from "../selection";

describe("comparePair — exactly two, older first", () => {
  it("is null for zero, one, three or more selected versions", () => {
    expect(comparePair([])).toBeNull();
    expect(comparePair([7])).toBeNull();
    expect(comparePair([7, 3, 5])).toBeNull();
    expect(comparePair([1, 2, 3, 4])).toBeNull();
  });

  it("puts the lower version number first whatever the order of selection", () => {
    expect(comparePair([3, 7])).toEqual([3, 7]);
    expect(comparePair([7, 3])).toEqual([3, 7]);
    expect(comparePair(new Set([234, 225]))).toEqual([225, 234]);
  });

  it("orders numerically, not as text", () => {
    expect(comparePair([10, 9])).toEqual([9, 10]);
    expect(comparePair([100, 20])).toEqual([20, 100]);
  });

  it("counts a version ticked twice once", () => {
    expect(comparePair([4, 4])).toBeNull();
    expect(comparePair([4, 4, 6])).toEqual([4, 6]);
  });
});

describe("createHistoryStore — selection", () => {
  it("starts with the initial versions ticked and lists them ascending", () => {
    const store = createHistoryStore([9, 2]);
    expect(store.isSelected(9)).toBe(true);
    expect(store.isSelected(2)).toBe(true);
    expect(store.isSelected(5)).toBe(false);
    expect(store.selected()).toEqual([2, 9]);
  });

  it("ticks and unticks, notifying subscribers only on a change", () => {
    const store = createHistoryStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setSelected(3, true);
    store.setSelected(3, true);
    expect(listener).toHaveBeenCalledTimes(1);
    store.setSelected(3, false);
    store.setSelected(8, false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.setSelected(4, true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps the same selected() array until the selection changes", () => {
    const store = createHistoryStore([1]);
    const first = store.selected();
    expect(store.selected()).toBe(first);
    store.setSelected(1, true);
    expect(store.selected()).toBe(first);
    store.setSelected(2, true);
    expect(store.selected()).not.toBe(first);
    expect(store.selected()).toEqual([1, 2]);
  });

  it("retain() drops versions that are no longer listed, and only then notifies", () => {
    const store = createHistoryStore([5, 3, 1]);
    const listener = vi.fn();
    store.subscribe(listener);
    store.retain([5, 4, 3, 1]);
    expect(listener).not.toHaveBeenCalled();
    store.retain([5, 1]);
    expect(store.selected()).toEqual([1, 5]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("createHistoryStore — one action at a time", () => {
  it("begin() claims the slot once; a second claim is refused until end()", () => {
    const store = createHistoryStore();
    expect(store.begin({ kind: "restore", version: 3 })).toBe(true);
    expect(store.begin({ kind: "restore", version: 3 })).toBe(false);
    expect(store.begin({ kind: "delete", version: 2 })).toBe(false);
    expect(store.pending()).toEqual({ kind: "restore", version: 3 });
    store.end();
    expect(store.pending()).toBeNull();
    expect(store.begin({ kind: "delete", version: 2 })).toBe(true);
  });

  it("holds one notice and notifies when it changes", () => {
    const store = createHistoryStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const notice = { tone: "error" as const, text: "x" };
    store.setNotice(notice);
    store.setNotice(notice);
    expect(store.notice()).toBe(notice);
    expect(listener).toHaveBeenCalledTimes(1);
    store.setNotice(null);
    expect(store.notice()).toBeNull();
  });
});
