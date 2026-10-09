import { describe, expect, it } from "vitest";
import * as documents from "@/domain/documents";
import { LIMITS, canDeleteVersion, isDraftStale, isPresent, presenceCutoff, resolvePublish } from "@/domain/documents";

describe("LIMITS — 07 §4, RD-058, RD-062, RD-063", () => {
  it("states the spec's numbers", () => {
    expect(LIMITS).toEqual({
      titleMax: 255,
      messageMax: 500,
      contentMaxBytes: 5 * 1024 * 1024,
      contentMaxDepth: 64,
      attachmentMaxBytes: 10 * 1024 * 1024,
      presenceHeartbeatMs: 15_000,
      presenceWindowMs: 45_000,
    });
  });

  it("matches the Attachment_size_matches CHECK in the migration", () => {
    expect(LIMITS.attachmentMaxBytes).toBe(10_485_760);
  });

  it("gives a present user at least two missed heartbeats before they vanish", () => {
    expect(LIMITS.presenceWindowMs).toBeGreaterThanOrEqual(3 * LIMITS.presenceHeartbeatMs);
  });
});

describe("canDeleteVersion — RD-060, invariant D2", () => {
  it("allows an ordinary past version", () => {
    expect(canDeleteVersion({ current: false, pinned: false })).toEqual({ ok: true });
  });

  it("refuses the current version", () => {
    expect(canDeleteVersion({ current: true, pinned: false })).toEqual({ ok: false, code: "CURRENT_VERSION" });
  });

  it("refuses a pinned version", () => {
    expect(canDeleteVersion({ current: false, pinned: true })).toEqual({ ok: false, code: "PINNED_VERSION" });
  });

  it("reports CURRENT_VERSION first when both apply", () => {
    expect(canDeleteVersion({ current: true, pinned: true })).toEqual({ ok: false, code: "CURRENT_VERSION" });
  });
});

describe("drafts and publishing — RD-055", () => {
  it("a draft is stale once another version has been published", () => {
    expect(isDraftStale(3, 3)).toBe(false);
    expect(isDraftStale(3, 4)).toBe(true);
  });

  it("publishing from the current version is OK, with or without overwrite", () => {
    expect(resolvePublish({ baseVersion: 4, currentVersion: 4 })).toBe("OK");
    expect(resolvePublish({ baseVersion: 4, currentVersion: 4, overwrite: true })).toBe("OK");
  });

  it("publishing from an older version is a conflict unless the user chose Overwrite", () => {
    expect(resolvePublish({ baseVersion: 3, currentVersion: 4 })).toBe("CONFLICT");
    expect(resolvePublish({ baseVersion: 3, currentVersion: 4, overwrite: false })).toBe("CONFLICT");
    expect(resolvePublish({ baseVersion: 3, currentVersion: 4, overwrite: true })).toBe("OK");
  });

  it("a base version that does not exist yet is a conflict too", () => {
    expect(resolvePublish({ baseVersion: 9, currentVersion: 4 })).toBe("CONFLICT");
  });
});

describe("presence — RD-062", () => {
  const now = 1_700_000_000_000;

  it("the cutoff is 45 s before now", () => {
    expect(presenceCutoff(now)).toBe(now - 45_000);
  });

  it("counts a heartbeat for 45 s, boundary included", () => {
    expect(isPresent(now, now)).toBe(true);
    expect(isPresent(now - 15_000, now)).toBe(true);
    expect(isPresent(now - 45_000, now)).toBe(true);
    expect(isPresent(now - 45_001, now)).toBe(false);
  });

  it("counts a heartbeat from a clock slightly ahead, and nothing for NaN", () => {
    expect(isPresent(now + 2_000, now)).toBe(true);
    expect(isPresent(Number.NaN, now)).toBe(false);
  });
});

describe("the module's public names (later slices import these)", () => {
  it.each([
    "LIMITS",
    "normalizeTitle",
    "checkTitle",
    "titleKey",
    "suggestUniqueTitle",
    "copyTitle",
    "buildTree",
    "ancestorsOf",
    "descendantIds",
    "wouldCreateCycle",
    "planMove",
    "canonicalJson",
    "diffDocuments",
    "classifyAttachment",
    "sanitizeFilename",
    "attachmentUrl",
    "contentDisposition",
    "presenceCutoff",
    "isPresent",
    "canDeleteVersion",
    "isDraftStale",
    "resolvePublish",
  ])("exports %s", (name) => {
    expect(documents).toHaveProperty(name);
  });
});
