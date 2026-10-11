// `Created by admin, last modified 6 minutes ago` (10 section 4.1): the relative time is a
// <time> element carrying the ISO instant, with the absolute time on hover. The times arrive
// pre-formatted (the server formats them once with src/ui/time.ts), so nothing here reads the
// clock and server render and hydration cannot disagree.
// spec: docs/specs/10-ui-reference.md section 4.1 (`Created by …, last modified …`: relative time, absolute on hover)
import { t } from "@/copy";

/** Stands in for `{relative}` while the sentence is split; a name cannot plausibly contain it. */
const SLOT = "\u0000relative\u0000";

/**
 * The copy-deck sentence `page.byline` split around its `{relative}` placeholder, so the
 * relative time can be wrapped in <time> without inlining any words.
 */
// spec: docs/specs/10-ui-reference.md section 13 (`page.byline`)
export function bylineParts(author: string): { readonly before: string; readonly after: string } {
  const sentence = t("page.byline", { author, relative: SLOT });
  const at = sentence.lastIndexOf(SLOT);
  if (at < 0) return { before: sentence, after: "" };
  return { before: sentence.slice(0, at), after: sentence.slice(at + SLOT.length) };
}

export interface BylineView {
  readonly author: string;
  /** ISO-8601 instant of the shown version. */
  readonly modifiedAt: string;
  /** `6 minutes ago` (formatRelative). */
  readonly relative: string;
  /** `Jul 25, 2023 13:08` (formatDateTime), shown on hover. */
  readonly absolute: string;
}

export function PageByline({ byline }: { readonly byline: BylineView }) {
  const { before, after } = bylineParts(byline.author);
  return (
    <p className="mt-1 text-sm text-slate-600" data-testid="page-byline">
      {before}
      <time dateTime={byline.modifiedAt} title={byline.absolute}>
        {byline.relative}
      </time>
      {after}
    </p>
  );
}
