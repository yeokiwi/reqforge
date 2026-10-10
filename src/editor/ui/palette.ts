// The fixed colour palettes of the toolbar: text colour (`A▾`) and cell fill (`fill ▾`).
// Both store `#rrggbb` (03 section 1.4: `textStyle.color`, a cell's `background`). The values
// are seeded from the colour roles of 10 section 1.1 and the panel backgrounds of content.css,
// so a coloured page reads in the product's own palette. The names are copy-deck strings.
// spec: docs/specs/10-ui-reference.md section 5.1 (`A▾`, `fill ▾`); docs/specs/09-decision-log.md section RD-057
import type { CopyId } from "@/copy";

export interface Swatch {
  readonly hex: string;
  readonly copy: CopyId;
}

/** Text colours, from the §1.1 tokens: badge.child, chrome.nav, action.primary, badge.original, badge.link, lozenge.critical, badge.external. */
export const TEXT_COLOURS: readonly Swatch[] = Object.freeze([
  { hex: "#626878", copy: "editor.colour.grey" },
  { hex: "#093e9b", copy: "editor.colour.darkBlue" },
  { hex: "#0b48b1", copy: "editor.colour.blue" },
  { hex: "#198b5a", copy: "editor.colour.green" },
  { hex: "#dd8a34", copy: "editor.colour.orange" },
  { hex: "#a11911", copy: "editor.colour.red" },
  { hex: "#5a4aa3", copy: "editor.colour.purple" },
]);

/** Cell fills: table.header.bg and the five info-panel backgrounds of content.css. */
export const CELL_FILLS: readonly Swatch[] = Object.freeze([
  { hex: "#f0f1f3", copy: "editor.fill.grey" },
  { hex: "#deebff", copy: "editor.fill.blue" },
  { hex: "#e3fcef", copy: "editor.fill.green" },
  { hex: "#fffae6", copy: "editor.fill.yellow" },
  { hex: "#ffebe6", copy: "editor.fill.red" },
  { hex: "#eae6ff", copy: "editor.fill.purple" },
]);
