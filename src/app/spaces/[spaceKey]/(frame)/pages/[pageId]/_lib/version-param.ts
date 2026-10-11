// `?version=N` on the page view (10 section 11, RD-060): absent means the current version; a
// positive decimal integer names a version; anything else — empty, signed, fractional, padded,
// repeated, or too large to be a version number — is a page that does not exist (404). The
// accepted form is the API's (`versionQuery`, RD-072), so the two can never disagree.
// spec: docs/specs/10-ui-reference.md section 11 (Page version); docs/specs/09-decision-log.md sections RD-060, RD-072

export type VersionParam =
  | { readonly kind: "current" }
  | { readonly kind: "version"; readonly number: number }
  | { readonly kind: "invalid" };

/** The largest version number the database can hold (int4). */
const VERSION_MAX = 2_147_483_647;

// spec: docs/specs/09-decision-log.md section RD-060 (a past version is viewed read-only at ?version=N); RD-072 (malformed input)
export function parseVersionParam(raw: string | readonly string[] | undefined): VersionParam {
  if (raw === undefined) return { kind: "current" };
  if (typeof raw !== "string") return { kind: "invalid" };
  if (!/^[1-9][0-9]*$/.test(raw)) return { kind: "invalid" };
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number > VERSION_MAX) return { kind: "invalid" };
  return { kind: "version", number };
}
