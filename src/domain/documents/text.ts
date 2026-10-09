// Small Unicode helpers shared by titles and filenames. Lengths are counted in code points
// because that is what PostgreSQL's char_length() counts in a UTF-8 database, and the
// length CHECK constraints on Document, DocumentVersion and Attachment use char_length().

/** Length in Unicode code points: an astral character (emoji, rare CJK) counts once. */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

let segmenter: Intl.Segmenter | null | undefined;

function graphemes(s: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  }
  if (segmenter === null) return [...s];
  return Array.from(segmenter.segment(s), (seg) => seg.segment);
}

/**
 * The longest prefix of `s` that is at most `max` code points, cut on a grapheme-cluster
 * boundary so an emoji sequence or a letter with its accents is never split. A single
 * cluster longer than `max` is the one case cut inside a cluster, so the result is empty
 * only when `max <= 0` or `s` is empty.
 */
export function truncateCodePoints(s: string, max: number): string {
  if (max <= 0) return "";
  if (codePointLength(s) <= max) return s;
  let out = "";
  let used = 0;
  for (const g of graphemes(s)) {
    const len = codePointLength(g);
    if (used + len > max) break;
    out += g;
    used += len;
  }
  return out === "" ? [...s].slice(0, max).join("") : out;
}

/** Replaces lone UTF-16 surrogates with U+FFFD, so encodeURIComponent cannot throw. */
export function toWellFormed(s: string): string {
  return s.replace(/\p{Cs}/gu, "�");
}
