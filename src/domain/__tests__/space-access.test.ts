import { describe, expect, it } from "vitest";
import { evaluateSpaceAccess } from "@/domain/permissions/space-access";

describe("evaluateSpaceAccess — spec 07 §2.1, RD-051", () => {
  it("grants nothing without any grant", () => {
    const access = evaluateSpaceAccess([]);
    expect(access).toMatchObject({ canView: false, canEdit: false, canExport: false, canAdmin: false });
  });

  it("VIEW alone lets you see and nothing else", () => {
    expect(evaluateSpaceAccess([["VIEW"]])).toMatchObject({
      canView: true,
      canEdit: false,
      canExport: false,
      canAdmin: false,
    });
  });

  it("no permission implies another: ADMIN does not grant EDIT", () => {
    const access = evaluateSpaceAccess([["VIEW", "ADMIN"]]);
    expect(access.canAdmin).toBe(true);
    expect(access.canEdit).toBe(false);
    expect(access.canExport).toBe(false);
  });

  it("EXPORT is separate from VIEW (07 §2.1)", () => {
    const access = evaluateSpaceAccess([["VIEW", "EDIT"]]);
    expect(access.canExport).toBe(false);
  });

  it("every action also requires VIEW: EDIT/EXPORT/ADMIN alone do nothing", () => {
    const access = evaluateSpaceAccess([["EDIT", "EXPORT", "ADMIN"]]);
    expect(access).toMatchObject({ canView: false, canEdit: false, canExport: false, canAdmin: false });
  });

  it("unions grants from several memberships (direct + group)", () => {
    const access = evaluateSpaceAccess([["VIEW"], ["EDIT"], ["EXPORT"]]);
    expect(access).toMatchObject({ canView: true, canEdit: true, canExport: true, canAdmin: false });
  });

  it("a grant that is only EDIT combines with another that supplies VIEW", () => {
    expect(evaluateSpaceAccess([["EDIT"], ["VIEW"]]).canEdit).toBe(true);
  });

  it("exposes the effective set, deduplicated", () => {
    const access = evaluateSpaceAccess([["VIEW", "EDIT"], ["VIEW"]]);
    expect([...access.permissions].sort()).toEqual(["EDIT", "VIEW"]);
  });
});
