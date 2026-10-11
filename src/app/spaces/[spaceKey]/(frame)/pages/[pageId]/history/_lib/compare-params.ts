// `?a={n}&b={m}` on the compare screen (10 section 11, RD-060). Each must be one positive decimal
// integer a version number can be (the API's `?version` form, RD-072), and the two must differ.
// Anything else — missing, repeated, empty, signed, fractional, zero-padded, too large, or the
// same version twice — is a page that does not exist (404), never a 500. The order is kept as
// given: `a` is the left side and `b` the right; Page History always sends the older one as `a`.
// spec: docs/specs/10-ui-reference.md section 11 (Compare two versions); docs/specs/09-decision-log.md sections RD-060, RD-072

/** The largest version number the database can hold (int4). */
const VERSION_MAX = 2_147_483_647;

export interface ComparePair {
  readonly a: number;
  readonly b: number;
}

/** One version number from a search parameter, or null. */
// spec: docs/specs/09-decision-log.md section RD-072 (?version must be a positive decimal integer)
export function parseVersionNumber(raw: string | readonly string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= VERSION_MAX ? n : null;
}

/** Both versions, or null when the pair is not two different version numbers. */
// spec: docs/specs/09-decision-log.md section RD-060 (Compare takes exactly two versions)
export function parseComparePair(params: {
  readonly a?: string | readonly string[] | undefined;
  readonly b?: string | readonly string[] | undefined;
}): ComparePair | null {
  const a = parseVersionNumber(params.a);
  const b = parseVersionNumber(params.b);
  if (a === null || b === null || a === b) return null;
  return { a, b };
}
