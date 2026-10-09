// Versions and drafts (RD-055, RD-060). Version numbers are the per-document sequence
// (DocumentVersion.number); a draft records the number it was opened from.

export type VersionDeleteCheck = { ok: true } | { ok: false; code: "CURRENT_VERSION" | "PINNED_VERSION" };

/**
 * Whether one version may be deleted from history. The current version never can (the
 * foreign key would refuse it too); a version pinned by a baseline never can (invariant
 * D2, enforced again by a trigger). A version that is both reports CURRENT_VERSION.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Delete); docs/specs/01-domain-model.md (invariant D2); docs/specs/08-api-surface.md section 3.2
export function canDeleteVersion(version: { current: boolean; pinned: boolean }): VersionDeleteCheck {
  if (version.current) return { ok: false, code: "CURRENT_VERSION" };
  if (version.pinned) return { ok: false, code: "PINNED_VERSION" };
  return { ok: true };
}

/**
 * A draft is stale when the version it started from is no longer the current one — someone
 * published in the meantime.
 */
// spec: docs/specs/01-domain-model.md (DocumentDraft: stale when baseVersionNumber no longer equals the current version's number); RD-055
export function isDraftStale(baseVersion: number, currentVersion: number): boolean {
  return baseVersion !== currentVersion;
}

export type PublishResolution = "OK" | "CONFLICT";

/**
 * Publishing from the current version is OK. Publishing from any other version — older,
 * or one that does not exist yet — is a VERSION_CONFLICT unless the user chose Overwrite,
 * in which case it is published as a new version on top.
 */
// spec: docs/specs/09-decision-log.md section RD-055 (Concurrency: VERSION_CONFLICT, Overwrite); docs/specs/08-api-surface.md section 3.2
export function resolvePublish(input: {
  baseVersion: number;
  currentVersion: number;
  overwrite?: boolean | undefined;
}): PublishResolution {
  if (!isDraftStale(input.baseVersion, input.currentVersion)) return "OK";
  return input.overwrite === true ? "OK" : "CONFLICT";
}
