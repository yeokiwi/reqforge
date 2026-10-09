import { LIMITS } from "./limits";
import { codePointLength, truncateCodePoints } from "./text";

/**
 * The title a new page gets when none is given (RD-056: "an empty first version titled
 * `Untitled`"). Stored data, not interface copy; also the fallback when a derived title
 * would otherwise be empty.
 */
export const UNTITLED_TITLE = "Untitled";

/** What a copy is called before uniqueness numbering (RD-056: "`Copy of <title>`"). */
export function defaultCopyFormat(title: string): string {
  return `Copy of ${title}`;
}

export type TitleProblem = "EMPTY" | "TOO_LONG" | "CONTROL_CHARACTERS";
export type TitleCheck = { ok: true; title: string } | { ok: false; problem: TitleProblem };

// C0/C1 controls (tab, newline, DEL, ...), the Unicode line and paragraph separators, and
// lone surrogates (malformed UTF-16 that would be silently replaced on the way to the DB).
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u;
const FORBIDDEN_RUNS = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]+/gu;

/**
 * Unicode NFC, then trim. Idempotent. Stored titles are always in this form.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (titles: 1–255 characters after trimming)
export function normalizeTitle(raw: string): string {
  return raw.normalize("NFC").trim();
}

/**
 * Validates a title as the user typed it. Checks run on the normalised title, in the order
 * EMPTY, CONTROL_CHARACTERS, TOO_LONG — so a pasted trailing newline is trimmed away, while
 * a tab or newline inside the title is refused. Length is in code points after NFC, which
 * is what the database's char_length() CHECK counts.
 */
// spec: docs/specs/09-decision-log.md section RD-056; docs/specs/07-permissions-and-limits.md section 4 (Page title)
export function checkTitle(raw: string): TitleCheck {
  const title = normalizeTitle(raw);
  if (title.length === 0) return { ok: false, problem: "EMPTY" };
  if (FORBIDDEN.test(title)) return { ok: false, problem: "CONTROL_CHARACTERS" };
  if (codePointLength(title) > LIMITS.titleMax) return { ok: false, problem: "TOO_LONG" };
  return { ok: true, title };
}

/**
 * The case-insensitive uniqueness key of a title: normalised (NFC, trimmed), then
 * `toLowerCase()`. This is a *prediction* of the partial unique index
 * `Document_live_spaceId_title_key` on `(spaceId, lower(title))`. PostgreSQL's lower()
 * follows the database's collation and can disagree with JavaScript on a few characters
 * (final sigma, dotted capital I), so the index is the final arbiter: callers must still
 * map a unique violation to TITLE_TAKEN.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (unique per space, case-insensitively)
export function titleKey(title: string): string {
  return normalizeTitle(title).toLowerCase();
}

/**
 * The first of `base`, `base 2`, `base 3`, ... whose titleKey is not in `taken`. The result
 * never exceeds LIMITS.titleMax: the base is truncated (on a grapheme boundary), never the
 * number. Control characters in `base` become spaces and an empty base becomes
 * UNTITLED_TITLE, so the result always passes checkTitle. `taken` should be the titles of
 * the space's live pages; the database index still decides (see titleKey).
 */
// spec: docs/specs/09-decision-log.md section RD-056 (Create: `Untitled`, `Untitled 2`, ... if taken)
export function suggestUniqueTitle(base: string, taken: Iterable<string>): string {
  return uniqueTitle(base, (t) => t, taken);
}

/**
 * `Copy of <original>`, then `Copy of <original> 2`, ... under the same rules as
 * suggestUniqueTitle. The original title is what gets truncated, so the copy wording and
 * the number always survive. `format` lets the caller supply the wording (for example from
 * the copy deck); it defaults to RD-056's `Copy of <title>`.
 */
// spec: docs/specs/09-decision-log.md section RD-056 (Copy: `Copy of <title>`, made unique)
export function copyTitle(
  original: string,
  taken: Iterable<string>,
  format: (title: string) => string = defaultCopyFormat,
): string {
  return uniqueTitle(original, format, taken);
}

function cleanForDerivedTitle(s: string): string {
  return normalizeTitle(s.replace(FORBIDDEN_RUNS, " "));
}

function fitTitle(s: string, room: number): string {
  return truncateCodePoints(s, room).trimEnd();
}

function uniqueTitle(text: string, compose: (title: string) => string, taken: Iterable<string>): string {
  const takenKeys = new Set<string>();
  for (const t of taken) takenKeys.add(titleKey(t));

  const cleanText = cleanForDerivedTitle(text);
  // What the wording adds around the title ("Copy of " is 8). The outer fitTitle below is
  // the guarantee; this only makes the original, not the wording, absorb the truncation.
  const overhead = codePointLength(compose(""));

  // Terminates: for n >= 2 the last space-separated token of the candidate is exactly
  // String(n), so those candidates are pairwise distinct and at most |taken| + 2 are tried.
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` ${n}`;
    const room = LIMITS.titleMax - codePointLength(suffix);
    let base = fitTitle(cleanForDerivedTitle(compose(fitTitle(cleanText, room - overhead))), room);
    if (base === "") base = fitTitle(UNTITLED_TITLE, room);
    const candidate = normalizeTitle(base + suffix);
    if (!takenKeys.has(titleKey(candidate))) return candidate;
  }
}
