// RD-085: the application cannot be framed (clickjacking: a same-site page could iframe it under
// decoy buttons with the SameSite=Lax session cookie attached), and no response is sniffed.
import { describe, expect, it } from "vitest";
import config from "../../next.config";

describe("next.config headers", () => {
  it("send frame-ancestors 'none' and X-Frame-Options DENY on every path", async () => {
    const rules = (await config.headers?.()) ?? [];
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(all, "a catch-all header rule").toBeDefined();
    const headers = Object.fromEntries((all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});
