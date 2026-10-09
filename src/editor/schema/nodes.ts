// The custom nodes and attributes of the standard rich-text schema. Each carries parseHTML
// and renderHTML so that pasted HTML maps onto it and the editor UI can extend it with a
// node view; the classes and data attributes renderHTML emits are the ones DocumentView
// emits, so src/editor/content.css styles the editor and the page alike.
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-057, RD-058, RD-063)
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { CLASS, MENTION_PREFIX } from "./dom";
import { formatDateValue } from "./format";
import {
  INDENT_MAX,
  MAX_COLSPAN,
  MAX_COLUMN_WIDTH,
  MAX_IMAGE_WIDTH,
  MAX_MENTION_LABEL_LENGTH,
  MAX_ROWSPAN,
  PANEL_VARIANTS,
  STATUS_COLOURS,
  STATUS_TEXT_MAX,
  TABLE_WIDTH_MODES,
  isCalendarDate,
  isEntityId,
  isOneOf,
  isStatusText,
  normaliseColour,
} from "./rules";

function intOrNull(raw: string | null, min: number, max: number): number | null {
  if (raw === null || !/^\s*\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function enumOr<T extends string>(values: readonly T[], raw: string | null, fallback: T): T {
  return isOneOf(values, raw) ? raw : fallback;
}

/** Pasted lozenge text: whitespace collapsed, trimmed, cut to 60 characters. */
export function normaliseStatusText(raw: string | null | undefined): string {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  return Array.from(collapsed).slice(0, STATUS_TEXT_MAX).join("").trim();
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ------------------------------------------------------------------ attribute extensions

/**
 * `indent` 0–6 on paragraphs and headings (RD-057: ⇤ ⇥ change a paragraph's or heading's
 * indent level). Rendered as `data-indent`; content.css turns it into a margin.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-057)
export const Indent = Extension.create<{ types: string[] }>({
  name: "indent",
  addOptions() {
    return { types: ["paragraph", "heading"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => intOrNull(element.getAttribute("data-indent"), 0, INDENT_MAX) ?? 0,
            renderHTML: (attributes) =>
              typeof attributes.indent === "number" && attributes.indent > 0
                ? { "data-indent": String(attributes.indent) }
                : {},
          },
        },
      },
    ];
  },
});

/** Table attributes: `widthMode` (RD-057 `Responsive ▾`/`Fixed width ▾`) and `numberedColumn`. */
export const tableAttributes = {
  widthMode: {
    default: "responsive",
    parseHTML: (element: HTMLElement) => enumOr(TABLE_WIDTH_MODES, element.getAttribute("data-width-mode"), "responsive"),
    renderHTML: (attributes: Record<string, unknown>) => {
      const mode = enumOr(TABLE_WIDTH_MODES, textOf(attributes.widthMode), "responsive");
      return { "data-width-mode": mode, class: CLASS.tableWidthMode(mode) };
    },
  },
  numberedColumn: {
    default: false,
    parseHTML: (element: HTMLElement) => element.getAttribute("data-numbered-column") === "true",
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.numberedColumn === true ? { "data-numbered-column": "true", class: CLASS.tableNumbered } : {},
  },
};

function parseColwidth(element: HTMLElement): number[] | null {
  const raw = element.getAttribute("colwidth") ?? element.getAttribute("data-colwidth");
  if (!raw) return null;
  const colspan = intOrNull(element.getAttribute("colspan"), 1, MAX_COLSPAN) ?? 1;
  const widths = raw.split(",").map((w) => Number(w.trim()));
  if (widths.length !== colspan) return null;
  if (widths.some((w) => !Number.isFinite(w) || w < 0 || w > MAX_COLUMN_WIDTH)) return null;
  return widths;
}

/** Cell attributes: spans, column widths and a `background` fill (RD-057 `fill ▾`). */
export const cellAttributes = {
  colspan: {
    default: 1,
    parseHTML: (element: HTMLElement) => intOrNull(element.getAttribute("colspan"), 1, MAX_COLSPAN) ?? 1,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.colspan === 1 ? {} : { colspan: String(attributes.colspan) },
  },
  rowspan: {
    default: 1,
    parseHTML: (element: HTMLElement) => intOrNull(element.getAttribute("rowspan"), 1, MAX_ROWSPAN) ?? 1,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.rowspan === 1 ? {} : { rowspan: String(attributes.rowspan) },
  },
  colwidth: {
    default: null,
    parseHTML: parseColwidth,
    renderHTML: (attributes: Record<string, unknown>) =>
      Array.isArray(attributes.colwidth) ? { colwidth: attributes.colwidth.join(",") } : {},
  },
  background: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      normaliseColour(element.getAttribute("data-background") ?? element.style.backgroundColor),
    renderHTML: (attributes: Record<string, unknown>) => {
      const colour = normaliseColour(attributes.background);
      return colour ? { "data-background": colour, style: `background-color: ${colour}` } : {};
    },
  },
};

// ------------------------------------------------------------------------- custom nodes

/** `infoPanel` — the Info macro (`10` §5.4–5.5): a coloured block holding blocks. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-057)
export const InfoPanel = Node.create({
  name: "infoPanel",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (element) => enumOr(PANEL_VARIANTS, element.getAttribute("data-variant"), "info"),
        renderHTML: (attributes) => ({ "data-variant": enumOr(PANEL_VARIANTS, textOf(attributes.variant), "info") }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="infoPanel"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const variant = enumOr(PANEL_VARIANTS, textOf(node.attrs.variant), "info");
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "infoPanel", class: CLASS.panel(variant) }), 0];
  },
});

function levelAttribute(name: "data-min-level" | "data-max-level", fallback: number) {
  return (element: HTMLElement) => intOrNull(element.getAttribute(name), 1, 6) ?? fallback;
}

/** `tableOfContents` — an atom; the list is computed from the document's headings. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4
export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    const min = levelAttribute("data-min-level", 1);
    const max = levelAttribute("data-max-level", 6);
    return {
      minLevel: {
        default: 1,
        parseHTML: (element) => Math.min(min(element), max(element)),
        renderHTML: (attributes) => ({ "data-min-level": String(attributes.minLevel) }),
      },
      maxLevel: {
        default: 6,
        parseHTML: (element) => Math.max(min(element), max(element)),
        renderHTML: (attributes) => ({ "data-max-level": String(attributes.maxLevel) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'nav[data-type="tableOfContents"]' }, { tag: 'div[data-type="tableOfContents"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["nav", mergeAttributes(HTMLAttributes, { "data-type": "tableOfContents", class: CLASS.toc })];
  },
});

/** `status` — the Status macro: a lozenge with text and a colour. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4
export const Status = Node.create({
  name: "status",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element) => normaliseStatusText(element.textContent),
        renderHTML: () => ({}),
      },
      colour: {
        default: "grey",
        parseHTML: (element) => enumOr(STATUS_COLOURS, element.getAttribute("data-colour"), "grey"),
        renderHTML: (attributes) => ({ "data-colour": enumOr(STATUS_COLOURS, textOf(attributes.colour), "grey") }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="status"]',
        // A lozenge with no usable text stays text: never create a node the server refuses.
        getAttrs: (element) => (isStatusText(normaliseStatusText(element.textContent)) ? null : false),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const colour = enumOr(STATUS_COLOURS, textOf(node.attrs.colour), "grey");
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "status", class: CLASS.status(colour) }),
      textOf(node.attrs.text),
    ];
  },
  renderText({ node }) {
    return textOf(node.attrs.text);
  },
});

/** `date` — an inline date, stored as `YYYY-MM-DD`, shown as e.g. `Oct 9, 2026`. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4
export const DateNode = Node.create({
  name: "date",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      value: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("datetime");
          return isCalendarDate(value) ? value : null;
        },
        renderHTML: (attributes) => (isCalendarDate(attributes.value) ? { datetime: attributes.value } : {}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'time[data-type="date"]',
        getAttrs: (element) => (isCalendarDate(element.getAttribute("datetime")) ? null : false),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "time",
      mergeAttributes(HTMLAttributes, { "data-type": "date", class: CLASS.date }),
      formatDateValue(node.attrs.value) ?? textOf(node.attrs.value),
    ];
  },
  renderText({ node }) {
    return textOf(node.attrs.value);
  },
});

function isMentionLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_MENTION_LABEL_LENGTH;
}

/** `mention` — `@label` for a user, keyed by `userId` (`10` §5.5 User mention). */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element) => {
          const id = element.getAttribute("data-user-id");
          return isEntityId(id) ? id : null;
        },
        renderHTML: (attributes) => (isEntityId(attributes.userId) ? { "data-user-id": attributes.userId } : {}),
      },
      label: {
        default: null,
        parseHTML: (element) => {
          const label = element.getAttribute("data-label");
          return isMentionLabel(label) ? label : null;
        },
        renderHTML: (attributes) => (isMentionLabel(attributes.label) ? { "data-label": attributes.label } : {}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="mention"]',
        getAttrs: (element) =>
          isEntityId(element.getAttribute("data-user-id")) && isMentionLabel(element.getAttribute("data-label"))
            ? null
            : false,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "mention", class: CLASS.mention }),
      `${MENTION_PREFIX}${textOf(node.attrs.label)}`,
    ];
  },
  renderText({ node }) {
    return `${MENTION_PREFIX}${textOf(node.attrs.label)}`;
  },
});

export function parseImageWidth(raw: string | null): number | null {
  return intOrNull(raw, 1, MAX_IMAGE_WIDTH);
}
