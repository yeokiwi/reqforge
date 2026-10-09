import { describe, expect, it } from "vitest";
import { canonicalSpaceKey, isValidSpaceKey } from "@/domain/spaces/space-key";

describe("isValidSpaceKey — spec 01: [A-Z][A-Z0-9]{1,15}", () => {
  it.each(["TEAM", "AB", "A1", "PLAT2", "A".repeat(16)])("accepts %s", (key) => {
    expect(isValidSpaceKey(key)).toBe(true);
  });

  it.each([
    ["too short", "A"],
    ["too long", "A".repeat(17)],
    ["leading digit", "1TEAM"],
    ["lowercase", "team"],
    ["hyphen", "MY-SPACE"],
    ["space", "MY SPACE"],
    ["unicode letter", "ÉQUIPE"],
    ["empty", ""],
    ["trailing newline", "TEAM\n"],
  ])("rejects %s", (_label, key) => {
    expect(isValidSpaceKey(key)).toBe(false);
  });
});

describe("canonicalSpaceKey", () => {
  it("uppercases a valid key", () => {
    expect(canonicalSpaceKey("team")).toBe("TEAM");
    expect(canonicalSpaceKey("Plat2")).toBe("PLAT2");
  });

  it("returns null rather than a bad key, so no query is made for it", () => {
    expect(canonicalSpaceKey("../etc")).toBeNull();
    expect(canonicalSpaceKey("a")).toBeNull();
    expect(canonicalSpaceKey("")).toBeNull();
  });
});
