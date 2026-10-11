// Remembered expansion: per space, and never fatal (localStorage can be missing, full or throw).
import { describe, expect, it } from "vitest";
import { MAX_REMEMBERED, expansionKey, readExpanded, writeExpanded, type StorageLike } from "../expansion-storage";

function memory(): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("expansion storage", () => {
  it("round-trips per space, keyed case-insensitively", () => {
    const store = memory();
    writeExpanded(() => store, "team", ["a", "b"]);
    expect(store.data.has(expansionKey("TEAM"))).toBe(true);
    expect(readExpanded(() => store, "TEAM")).toEqual(["a", "b"]);
    expect(readExpanded(() => store, "PLAT")).toEqual([]);
  });

  it("ignores junk: not JSON, not an array, non-string or oversized ids", () => {
    const store = memory();
    store.data.set(expansionKey("TEAM"), "{oops");
    expect(readExpanded(() => store, "TEAM")).toEqual([]);
    store.data.set(expansionKey("TEAM"), JSON.stringify({ a: 1 }));
    expect(readExpanded(() => store, "TEAM")).toEqual([]);
    store.data.set(expansionKey("TEAM"), JSON.stringify(["ok", 3, "", "x".repeat(65)]));
    expect(readExpanded(() => store, "TEAM")).toEqual(["ok"]);
  });

  it("caps what it keeps", () => {
    const store = memory();
    writeExpanded(() => store, "TEAM", Array.from({ length: MAX_REMEMBERED + 10 }, (_, i) => `p${i}`));
    expect(readExpanded(() => store, "TEAM")).toHaveLength(MAX_REMEMBERED);
  });

  it("never throws, whichever step fails", () => {
    const throwingSource = () => {
      throw new DOMException("denied", "SecurityError");
    };
    const throwingStore: StorageLike = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(readExpanded(throwingSource, "TEAM")).toEqual([]);
    expect(readExpanded(() => throwingStore, "TEAM")).toEqual([]);
    expect(readExpanded(() => null, "TEAM")).toEqual([]);
    expect(() => writeExpanded(throwingSource, "TEAM", ["a"])).not.toThrow();
    expect(() => writeExpanded(() => throwingStore, "TEAM", ["a"])).not.toThrow();
  });
});
