// `?version=N` (10 §11, RD-060): absent is current; the API's form (RD-072) is a version; every
// other spelling is a page that does not exist.
import { describe, expect, it } from "vitest";
import { parseVersionParam } from "../version-param";

describe("parseVersionParam", () => {
  it("absent means the current version", () => {
    expect(parseVersionParam(undefined)).toEqual({ kind: "current" });
  });

  it("a positive decimal integer names a version", () => {
    expect(parseVersionParam("1")).toEqual({ kind: "version", number: 1 });
    expect(parseVersionParam("234")).toEqual({ kind: "version", number: 234 });
    expect(parseVersionParam("2147483647")).toEqual({ kind: "version", number: 2147483647 });
  });

  it.each(["", "0", "-1", "+1", "1.0", "1e3", "007", " 1", "1 ", "0x10", "abc", "١٢", "2147483648", "99999999999999999999"])(
    "%j is not a version (404)",
    (raw) => {
      expect(parseVersionParam(raw)).toEqual({ kind: "invalid" });
    },
  );

  it("a repeated parameter is ambiguous, so invalid", () => {
    expect(parseVersionParam(["1", "2"])).toEqual({ kind: "invalid" });
    expect(parseVersionParam(["1"])).toEqual({ kind: "invalid" });
  });
});
