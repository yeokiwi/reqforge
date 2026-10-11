// `?highlight={pageId}` on the space overview (10 §11, RD-059): honoured only for a page in the
// viewer's tree; anything else is ignored without comment.
import { describe, expect, it } from "vitest";
import { page } from "@/ui/page-tree/__tests__/fake-api";
import { highlightFromParam } from "../overview";

const tree = { status: "ready" as const, pages: [page("p1", "One"), page("p2", "Two", "p1")] };

describe("highlightFromParam", () => {
  it("returns a page id that is in the tree", () => {
    expect(highlightFromParam("p2", tree)).toBe("p2");
  });

  it("ignores an id the viewer's tree does not have (unknown, deleted or invisible)", () => {
    expect(highlightFromParam("p9", tree)).toBeNull();
  });

  it("ignores a missing, repeated or malformed parameter", () => {
    expect(highlightFromParam(undefined, tree)).toBeNull();
    expect(highlightFromParam(["p1", "p2"], tree)).toBeNull();
    expect(highlightFromParam("", tree)).toBeNull();
    expect(highlightFromParam("a/b", tree)).toBeNull();
    expect(highlightFromParam("x".repeat(65), tree)).toBeNull();
  });

  it("leaves the decision to the client when the tree could not be loaded", () => {
    expect(highlightFromParam("p9", { status: "error" })).toBe("p9");
  });
});
