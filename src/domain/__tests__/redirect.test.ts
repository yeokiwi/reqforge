import { describe, expect, it } from "vitest";
import { DEFAULT_LANDING, safeRedirectPath } from "@/domain/auth/redirect";

describe("safeRedirectPath", () => {
  it.each(["/spaces", "/spaces/TEAM", "/requirements/TEAM/REQ%20005", "/search?q=a&b=c"])(
    "keeps the same-site path %s",
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    ["absolute URL", "https://evil.example/x"],
    ["protocol-relative", "//evil.example/x"],
    ["backslash host", "/\\evil.example"],
    ["backslash later in path", "/a\\b"],
    ["javascript scheme", "javascript:alert(1)"],
    ["no leading slash", "spaces"],
    ["CRLF injection", "/a\r\nSet-Cookie: x=1"],
    ["tab inside", "/\t/evil.example"],
    ["the login page itself", "/login"],
    ["login with query", "/login?next=/x"],
    ["empty", ""],
  ])("falls back for %s", (_label, raw) => {
    expect(safeRedirectPath(raw)).toBe(DEFAULT_LANDING);
  });

  it("falls back for null and undefined", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_LANDING);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_LANDING);
  });

  it("does not treat '/loginfoo' as the login page", () => {
    expect(safeRedirectPath("/loginfoo")).toBe("/loginfoo");
  });
});
