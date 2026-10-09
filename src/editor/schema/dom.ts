// The DOM contract shared by the editor (TipTap renderHTML) and the page renderer
// (DocumentView): the same classes and data attributes, so src/editor/content.css styles
// both. No TipTap import here, so the renderer stays light.

/** Class names shared by renderHTML and DocumentView. */
export const CLASS = {
  content: "rf-content",
  table: "rf-table",
  tableWrapper: "rf-table-wrapper",
  tableWidthMode: (mode: string) => `rf-table--${mode}`,
  tableNumbered: "rf-table--numbered",
  /** The leading `<col>` a numbered table reserves for its counter cell. */
  tableNumberColumn: "rf-table__number-col",
  panel: (variant: string) => `rf-panel rf-panel--${variant}`,
  toc: "rf-toc",
  tocItem: "rf-toc__item",
  status: (colour: string) => `rf-status rf-status--${colour}`,
  date: "rf-date",
  mention: "rf-mention",
} as const;

/** What a mention's label is prefixed with, in both views. A glyph, not copy. */
export const MENTION_PREFIX = "@";

/**
 * What every heading id starts with: `rf-h-` + the heading's slug. Content shares the page's
 * id namespace with the application shell (`<main id="main">`, `global-search`), so a bare
 * slug would let a heading called "Main" take an id the shell already uses.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (tableOfContents)
export const HEADING_ID_PREFIX = "rf-h-";

/**
 * Width in CSS pixels of a numbered table's counter column (RD-057 `num`). content.css draws
 * the counter cell at this width and the page view reserves a `<col>` of it; a test keeps
 * the two equal.
 */
// spec: docs/specs/09-decision-log.md section RD-057 (num)
export const NUMBER_COLUMN_WIDTH = 30;
