import { describe, expect, it } from "vitest";
import { CopyError, isCopyId, t } from "@/copy";
import { deck } from "@/copy/deck.generated";

describe("t()", () => {
  it("returns a plain string unchanged", () => {
    expect(t("editor.update")).toBe("Update");
  });

  it("substitutes placeholders", () => {
    expect(t("bulk.count", { n: 12 })).toBe("This will create one macro for each of the 12 lines.");
    expect(t("key.invalid", { key: "REQ/006\\" })).toBe('"REQ/006\\" is not a valid key.');
  });

  it("substitutes a placeholder everywhere it occurs", () => {
    expect(t("baselines.pages", { n: 3 })).toBe("3 page / 3 pages");
  });

  it("substitutes several different placeholders", () => {
    expect(t("search.pager", { from: 1, to: 30, n: 412 })).toContain("1-30 of 412 results");
  });

  it("does not interpret '$' sequences in substituted values", () => {
    expect(t("picker.create", { key: "$&-1" })).toBe("Create $&-1");
  });

  it("throws a typed error when a placeholder has no value", () => {
    // @ts-expect-error — the type system rejects the missing parameter too
    expect(() => t("bulk.count", {})).toThrow(CopyError);
  });

  it("knows which ids exist", () => {
    expect(isCopyId("editor.update")).toBe(true);
    expect(isCopyId("editor.nope")).toBe(false);
    expect(isCopyId("toString")).toBe(false);
  });

  it("can render every id in the deck, given values for its placeholders", () => {
    for (const [id, template] of Object.entries(deck)) {
      const params = Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map((m) => [m[1], "X"]));
      // Cast: ids are only known at runtime here; the typed overloads are covered above.
      const render = t as unknown as (id: string, params: Record<string, string>) => string;
      const out = render(id, params);
      expect(out, id).not.toMatch(/\{\w+\}/);
      expect(out.length, id).toBeGreaterThan(0);
    }
  });
});
