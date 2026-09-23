/**
 * Classification labels. Pure.
 * spec: 07-permissions-and-limits.md §2.3; RD-060.
 *
 * Labels are "free text configured per installation", but the spec also needs "the
 * highest" of several, so the installation's labels are an ordered list: a higher `rank`
 * is more restrictive. Labels never enforce access by themselves — restrictions do — they
 * tell a reader how the content must be handled.
 */
export type ClassificationLabel = { id: string; name: string; rank: number };

/**
 * The most restrictive of the labels given, or `null` when none is set.
 * spec 07 §2.3 — "every export carries the label of the highest-classified content it
 * contains"; "a document's effective label is the highest of its own and any label on
 * content it embeds".
 */
export function highest(
  labels: ReadonlyArray<ClassificationLabel | null | undefined>,
): ClassificationLabel | null {
  let best: ClassificationLabel | null = null;
  for (const label of labels) {
    if (label && (best === null || label.rank > best.rank)) best = label;
  }
  return best;
}

/** The text an exported file carries in its header, its footer and its first row. */
export function classificationBanner(label: ClassificationLabel | null): string | null {
  return label ? `Classification: ${label.name}` : null;
}

/**
 * Validates a label name. Labels are printed into every export's header and footer, so
 * they are single-line, printable, and short enough to fit there.
 */
export function cleanLabelName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 60) return null;
  // `&` is ExcelJS's header/footer control character; a label must print as written.
  if (/[&\p{Cc}]/u.test(name)) return null;
  return name;
}
