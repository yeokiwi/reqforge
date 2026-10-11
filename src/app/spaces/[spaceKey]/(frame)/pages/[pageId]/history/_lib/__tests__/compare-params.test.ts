// `?a={n}&b={m}` (10 section 11, RD-060, RD-072): two different version numbers, else the 404 page.
import { describe, expect, it } from "vitest";
import { parseComparePair, parseVersionNumber } from "../compare-params";

describe("parseComparePair", () => {
  it("accepts two different positive integers, keeping the order given", () => {
    expect(parseComparePair({ a: "3", b: "7" })).toEqual({ a: 3, b: 7 });
    expect(parseComparePair({ a: "7", b: "3" })).toEqual({ a: 7, b: 3 });
    expect(parseComparePair({ a: "1", b: "2147483647" })).toEqual({ a: 1, b: 2147483647 });
  });

  it("refuses the same version twice", () => {
    expect(parseComparePair({ a: "4", b: "4" })).toBeNull();
  });

  it("refuses a missing side", () => {
    expect(parseComparePair({ b: "4" })).toBeNull();
    expect(parseComparePair({ a: "4" })).toBeNull();
    expect(parseComparePair({})).toBeNull();
  });

  it("refuses a repeated parameter", () => {
    expect(parseComparePair({ a: ["1", "2"], b: "3" })).toBeNull();
    expect(parseComparePair({ a: "1", b: ["3"] })).toBeNull();
  });

  it.each(["", "0", "-1", "+1", "1.0", "1e3", "01", " 1", "1 ", "abc", "0x10", "Infinity", "NaN", "１"])(
    "refuses a = %j",
    (raw) => {
      expect(parseComparePair({ a: raw, b: "9" })).toBeNull();
    },
  );

  it("refuses numbers a version cannot have (beyond int4, and beyond safe integers)", () => {
    expect(parseComparePair({ a: "1", b: "2147483648" })).toBeNull();
    expect(parseComparePair({ a: "1", b: "9007199254740993" })).toBeNull();
    expect(parseComparePair({ a: "1", b: "9".repeat(400) })).toBeNull();
  });
});

describe("parseVersionNumber", () => {
  it("reads one positive decimal integer", () => {
    expect(parseVersionNumber("12")).toBe(12);
    expect(parseVersionNumber(undefined)).toBeNull();
    expect(parseVersionNumber(["12"])).toBeNull();
  });
});
