import { LIST_SEPARATOR } from '@/domain/indexer/normalise';
import type { IgnoreSet } from './options';

/**
 * Putting two sides into a comparable shape.
 * spec: 05-baselines-and-diff.md §5.2 step 3 —
 *   formatting → compare `bodySearch`, not `bodyHtml`;
 *   images     → replace image nodes with a placeholder token;
 *   hyperlinks → compare link text, not href.
 *
 * **`RD-047`'s simplification.** `bodySearch` is already markup-stripped, whitespace-
 * collapsed and NFKC-normalised (spec 03 §3.1), so under the *default* ignore set all
 * three rules are satisfied by comparing that one column: formatting is gone, an image
 * contributes no text at all, and a link's text survives while its href does not. That is
 * what lets `isModified()` be a SQL comparison of stored columns and still mean exactly
 * what the diff means (`RD-013`).
 *
 * The tokens below only matter when `formatting` is off and the body has to be compared
 * as HTML.
 */

export const IMAGE_TOKEN = '\u0001image\u0001';
export const HREF_TOKEN = '\u0001href\u0001';

export type ComparableRow = {
  key: string;
  title: string;
  bodyHtml: string;
  bodySearch: string;
  /** Inline property values, as `searchName` → the value(s) stored for it. */
  inlineProperties: ReadonlyArray<{ searchName: string; value: string; valueIndex: number }>;
  externalProperties: ReadonlyArray<{ searchName: string; value: string; valueIndex: number }>;
  /** Relationship + target key, in invariant P1's direction: child → parent. */
  dependencies: ReadonlyArray<{ relationship: string; targetKey: string }>;
};

/** The body as this ignore set wants it compared. */
export function comparableBody(row: Pick<ComparableRow, 'bodyHtml' | 'bodySearch'>, ignore: IgnoreSet): string {
  // The whole default ignore set, in one column (RD-047).
  if (ignore.formatting) return row.bodySearch;

  let html = row.bodyHtml;
  if (ignore.images) html = html.replace(/<img\s+[^>]*>/g, IMAGE_TOKEN);
  if (ignore.hyperlinks) html = html.replace(/(<a\s+[^>]*?)href="[^"]*"/g, `$1href="${HREF_TOKEN}"`);
  return html;
}

/**
 * A property set as a sorted, canonical string. Sorting is what makes it a *set*
 * comparison: reordering the columns of a table is not a change to the requirement.
 */
export function comparableProperties(
  properties: ComparableRow['inlineProperties'],
): string {
  return [...properties]
    .sort(
      (a, b) =>
        a.searchName.localeCompare(b.searchName) ||
        a.valueIndex - b.valueIndex ||
        a.value.localeCompare(b.value),
    )
    .map((property) => `${property.searchName}=${property.value}`)
    .join(LIST_SEPARATOR);
}

export function comparableDependencies(dependencies: ComparableRow['dependencies']): string {
  return [...dependencies]
    .sort((a, b) => a.relationship.localeCompare(b.relationship) || a.targetKey.localeCompare(b.targetKey))
    .map((edge) => `${edge.relationship}\u001e${edge.targetKey}`)
    .join(LIST_SEPARATOR);
}
