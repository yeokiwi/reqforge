import { describe, expect, it } from "vitest";
import { initials } from "@/ui/initials";

describe("initials", () => {
  it.each([
    ["Alice Admin", "AA"],
    ["carol", "C"],
    ["  bob   the   builder ", "BB"],
    ["émile zola", "ÉZ"],
    ["日本語 太郎", "日太"],
    ["", "?"],
    ["   ", "?"],
  ])("%j → %j", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it("does not split an astral character in half", () => {
    expect(initials("𝒜lice")).toBe("𝒜");
  });
});
