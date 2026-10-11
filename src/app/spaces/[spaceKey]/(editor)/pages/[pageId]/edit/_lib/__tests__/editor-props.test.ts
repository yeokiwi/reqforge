// What the editor route hands <PageEditor> (10 §5.1, RD-055, RD-078): the canonical space key in
// every URL, the page as stored, the starting state exactly as the use case returned it, and
// `restricted: false` until restrictions exist (slice 16).
import { describe, expect, it } from "vitest";
import { evaluateSpaceAccess } from "@/domain/permissions/space-access";
import type { EditorState } from "@/server/usecases/pages";
import { editorProps } from "../editor-props";

function state(over: Partial<EditorState["initial"]> = {}): EditorState {
  return {
    space: {
      id: "s1",
      key: "TEAM",
      name: "Team",
      classification: null,
      favourite: false,
      lastViewedAt: null,
      access: evaluateSpaceAccess([["VIEW", "EDIT"]]),
    },
    page: {
      id: "p1",
      title: "Specifications",
      parentId: "p0",
      ordinal: 0,
      currentVersion: 4,
      lastModifiedAt: "2026-10-11T09:54:00.000Z",
      spaceKey: "TEAM",
      ancestors: [
        { id: "p00", title: "Root" },
        { id: "p0", title: "Product" },
      ],
      createdBy: { id: "u1", name: "Alice Admin" },
      createdAt: "2026-10-01T08:00:00.000Z",
      lastModifiedBy: { id: "u2", name: "Bob Editor" },
      descendantCount: 0,
      watching: true,
      favourite: false,
      hasDraft: true,
      permissions: { canEdit: true, canAdmin: false },
    },
    initial: {
      title: "Specifications (draft)",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      baseVersion: 3,
      fromDraft: true,
      ...over,
    },
  };
}

describe("editorProps", () => {
  it("maps the editor state and the signed-in user to PageEditor's props", () => {
    expect(editorProps(state(), { id: "u2", name: "Bob Editor" })).toEqual({
      space: { key: "TEAM", name: "Team" },
      page: {
        id: "p1",
        title: "Specifications",
        ancestors: [
          { id: "p00", title: "Root" },
          { id: "p0", title: "Product" },
        ],
        restricted: false,
      },
      initial: {
        title: "Specifications (draft)",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        baseVersion: 3,
        fromDraft: true,
      },
      me: { id: "u2", name: "Bob Editor" },
      viewHref: "/spaces/TEAM/pages/p1",
      historyHref: "/spaces/TEAM/pages/p1/history",
    });
  });

  it("keeps the page's stored title for the breadcrumb, whatever the draft's title is (RD-078)", () => {
    const props = editorProps(state({ title: "" }), { id: "u2", name: "Bob" });
    expect(props.page.title).toBe("Specifications");
    expect(props.initial.title).toBe("");
  });

  it("passes no more of the user than id and name", () => {
    const actor = { id: "u2", name: "Bob", email: "bob@reqforge.test", isInstanceAdmin: true };
    expect(editorProps(state(), actor).me).toEqual({ id: "u2", name: "Bob" });
  });

  it("percent-encodes ids in the URLs it builds", () => {
    const s = state();
    const props = editorProps({ ...s, page: { ...s.page, id: "a/b" } }, { id: "u", name: "U" });
    expect(props.viewHref).toBe("/spaces/TEAM/pages/a%2Fb");
    expect(props.historyHref).toBe("/spaces/TEAM/pages/a%2Fb/history");
  });
});
