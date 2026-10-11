// What a Page History row offers (10 section 23, RD-060, 07 section 2.4): nothing on the current
// version; Restore with space EDIT; Delete with space ADMIN, disabled with the "Pinned by …"
// tooltip on a pinned version, and absent without ADMIN.
import { describe, expect, it } from "vitest";
import { t } from "@/copy";
import { pinnedReason, rowActions } from "../row-actions";

const admin = { canEdit: true, canAdmin: true };
const editor = { canEdit: true, canAdmin: false };
const viewer = { canEdit: false, canAdmin: false };
const adminOnly = { canEdit: false, canAdmin: true };

const old = { current: false, pinned: false };
const pinned = { current: false, pinned: true };
const current = { current: true, pinned: false };

describe("rowActions", () => {
  it("offers nothing on the current version, whoever is looking", () => {
    for (const permissions of [admin, editor, viewer, adminOnly]) {
      expect(rowActions(current, permissions)).toEqual({ restore: false, delete: { kind: "hidden" } });
      expect(rowActions({ ...current, pinned: true }, permissions)).toEqual({ restore: false, delete: { kind: "hidden" } });
    }
  });

  it("gives a space ADMIN who can edit Restore and Delete", () => {
    expect(rowActions(old, admin)).toEqual({ restore: true, delete: { kind: "enabled" } });
  });

  it("gives an editor Restore but no Delete at all", () => {
    expect(rowActions(old, editor)).toEqual({ restore: true, delete: { kind: "hidden" } });
    expect(rowActions(pinned, editor)).toEqual({ restore: true, delete: { kind: "hidden" } });
  });

  it("gives a viewer neither", () => {
    expect(rowActions(old, viewer)).toEqual({ restore: false, delete: { kind: "hidden" } });
    expect(rowActions(pinned, viewer)).toEqual({ restore: false, delete: { kind: "hidden" } });
  });

  it("gives an ADMIN without EDIT Delete but not Restore (no permission implies another, RD-051)", () => {
    expect(rowActions(old, adminOnly)).toEqual({ restore: false, delete: { kind: "enabled" } });
  });

  it("disables Delete on a pinned version, with the tooltip saying why", () => {
    expect(rowActions(pinned, admin)).toEqual({ restore: true, delete: { kind: "disabled", reason: "Pinned by a baseline" } });
    expect(rowActions({ ...pinned, pinnedBy: [3] }, admin)).toEqual({
      restore: true,
      delete: { kind: "disabled", reason: "Pinned by baseline 3" },
    });
  });
});

describe("pinnedReason", () => {
  it("uses the video's wording when the baseline is known", () => {
    expect(pinnedReason([3])).toBe(t("history.pinned", { n: 3 }));
    expect(pinnedReason([3])).toBe("Pinned by baseline 3");
    expect(pinnedReason([3, 5])).toBe("Pinned by baseline 3, 5");
  });

  it("says 'a baseline' until the API names it (before slice 13)", () => {
    expect(pinnedReason(undefined)).toBe("Pinned by a baseline");
    expect(pinnedReason([])).toBe("Pinned by a baseline");
  });
});
