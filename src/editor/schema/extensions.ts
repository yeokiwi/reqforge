// The TipTap extension list that realises the standard rich-text schema. Headless: no React,
// no DOM at import time. The editor UI adds behaviour (history, drop cursor, gap cursor,
// node views) on top of this list; it never adds or removes schema. The input rules that
// come with these extensions are part of the list, so every rule that turns typed text into
// attributes is bounded here to values the validator accepts.
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-057, RD-058, RD-063)
import { type AnyExtension, type Node, getExtensionField, textblockTypeInputRule, wrappingInputRule } from "@tiptap/core";
import { AppError } from "@/domain/errors";
import { Color } from "@tiptap/extension-color";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit, type StarterKitOptions } from "@tiptap/starter-kit";
import { CLASS } from "./dom";
import {
  DateNode,
  Indent,
  InfoPanel,
  Mention,
  Status,
  TableOfContents,
  cellAttributes,
  parseImageWidth,
  tableAttributes,
} from "./nodes";
import { MAX_CODE_LANGUAGE_LENGTH, TEXT_ALIGNMENTS, isAllowedHref, isHexColour, normaliseColour, parseAttachmentSrc } from "./rules";

/**
 * StarterKit with every schema part switched off and only its editing behaviour left on.
 * The editor UI adds `StarterKit.configure(STARTER_KIT_BEHAVIOUR_ONLY)` next to
 * `schemaExtensions` to get history, the drop cursor and the gap cursor without
 * duplicating a node or mark.
 */
export const STARTER_KIT_BEHAVIOUR_ONLY: Partial<StarterKitOptions> = {
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  document: false,
  hardBreak: false,
  heading: false,
  horizontalRule: false,
  italic: false,
  listItem: false,
  orderedList: false,
  paragraph: false,
  strike: false,
  text: false,
};

// StarterKit's schema parts, without its behaviour-only extensions. They are taken out of
// the kit one by one (rather than kept inside it) because two need narrowing below and
// because the editor UI must be able to add the kit again for behaviour alone.
const starterKit = StarterKit.configure({ history: false, dropcursor: false, gapcursor: false });

function starterKitParts(): Map<string, AnyExtension> {
  const addExtensions = getExtensionField<(() => AnyExtension[]) | undefined>(starterKit, "addExtensions", {
    name: starterKit.name,
    options: starterKit.options,
    storage: starterKit.storage,
  });
  const parts = addExtensions ? addExtensions() : [];
  return new Map(parts.map((extension) => [extension.name, extension]));
}

const parts = starterKitParts();

function part(name: string): AnyExtension {
  const extension = parts.get(name);
  if (!extension) throw new AppError("SCHEMA_INVARIANT", `StarterKit has no "${name}" extension`);
  return extension;
}

function nodePart(name: string): Node {
  const extension = part(name);
  if (extension.type !== "node") throw new AppError("SCHEMA_INVARIANT", `StarterKit's "${name}" is not a node`);
  return extension as Node;
}

function startOf(element: HTMLElement): number {
  const raw = element.getAttribute("start");
  if (raw === null || !/^\s*\d+\s*$/.test(raw)) return 1;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : 1;
}

/**
 * `1. ` starts an ordered list at the typed number. At most 15 digits, so `start` is always a
 * safe integer (2^53 − 1 has 16): a longer number stays text instead of becoming a list the
 * server refuses.
 */
const ORDERED_LIST_INPUT = /^(\d{1,15})\.\s$/;

// `orderedList` keeps `start` only: TipTap's extra `type` attribute is not in the spec. Its
// input rule is TipTap's, with the number bounded (it never keeps marks or attributes here).
const OrderedList = nodePart("orderedList").extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: startOf,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.start === 1 ? {} : { start: String(attributes.start) },
      },
    };
  },
  addInputRules() {
    return [
      wrappingInputRule({
        find: ORDERED_LIST_INPUT,
        type: this.type,
        getAttributes: (match) => ({ start: Number(match[1]) }),
        joinPredicate: (match, node) => node.childCount + Number(node.attrs.start) === Number(match[1]),
      }),
    ];
  },
});

/**
 * ```` ```ts ```` and `~~~ts` start a code block in that language. The language is at most 64
 * letters, the longest the schema stores: a longer one stays text.
 */
const CODE_FENCES = ["```", "~~~"].map((fence) => new RegExp(`^${fence}([a-z]{1,${MAX_CODE_LANGUAGE_LENGTH}})?[\\s\\n]$`));

const CodeBlock = nodePart("codeBlock").extend({
  addInputRules() {
    return CODE_FENCES.map((find) => textblockTypeInputRule({ find, type: this.type, getAttributes: (match) => ({ language: match[1] }) }));
  },
});

// `link` keeps `href` only (no stored target/rel/class), and refuses what the server refuses.
const LinkMark = Link.configure({
  isAllowedUri: (url: string) => isAllowedHref(url),
}).extend({
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("href"),
        renderHTML: (attributes: Record<string, unknown>) => (isAllowedHref(attributes.href) ? { href: attributes.href } : {}),
      },
    };
  },
});

// `textStyle.color` is `#rrggbb` or null. Browsers report pasted colours as `rgb(…)`, so the
// parse normalises instead of storing what the server would refuse.
const ColorAttribute = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) => normaliseColour(element.style.color),
            renderHTML: (attributes: Record<string, unknown>) =>
              isHexColour(attributes.color) ? { style: `color: ${attributes.color}` } : {},
          },
        },
      },
    ];
  },
});

// `image` is an inline atom referencing an attachment of this page (RD-058). A pasted
// `<img>` whose `src` is not an attachment URL is not parsed: the text stays, the image goes.
// TipTap's Markdown input rule `![alt](src)` is dropped: it would make an image with no
// attachmentId out of any typed URL. Images come from the attachment picker only.
const ImageNode = Image.configure({ inline: true, allowBase64: false }).extend({
  atom: true,
  addInputRules() {
    return [];
  },
  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => parseAttachmentSrc(element.getAttribute("src"))?.attachmentId ?? null,
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.attachmentId === "string" ? { "data-attachment-id": attributes.attachmentId } : {},
      },
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("src"),
        renderHTML: (attributes: Record<string, unknown>) =>
          parseAttachmentSrc(attributes.src) ? { src: attributes.src } : {},
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("alt"),
        renderHTML: (attributes: Record<string, unknown>) => (typeof attributes.alt === "string" ? { alt: attributes.alt } : {}),
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("title"),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.title === "string" ? { title: attributes.title } : {},
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => parseImageWidth(element.getAttribute("width")),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.width === "number" ? { width: String(attributes.width) } : {},
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (element: HTMLElement) => (parseAttachmentSrc(element.getAttribute("src")) ? null : false),
      },
    ];
  },
});

const TableNode = Table.configure({ HTMLAttributes: { class: CLASS.table } }).extend({
  addAttributes() {
    return { ...this.parent?.(), ...tableAttributes };
  },
});

// A row may hold no cells: when the toolbar's merge spans whole rows, the covered row is
// left empty (every one of its cells is under a rowspan from above), which is how
// prosemirror-tables models it. Requiring one cell (`+`) made that merge corrupt the table.
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-065)
const TableRowNode = TableRow.extend({ content: "(tableCell | tableHeader)*" });

const TableHeaderNode = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes };
  },
});

const TableCellNode = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes };
  },
});

/**
 * Every extension that contributes a node, mark or attribute to the document schema, in
 * the order of the table in `03` §1.4. TipTap sorts by priority when it builds the schema,
 * so `link` (priority 1000) and `textStyle` (101) rank first among the marks.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-063)
export const schemaExtensions: readonly AnyExtension[] = Object.freeze([
  part("doc"),
  part("paragraph"),
  part("heading"),
  part("blockquote"),
  CodeBlock,
  part("horizontalRule"),
  part("bulletList"),
  OrderedList,
  part("listItem"),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableNode,
  TableRowNode,
  TableHeaderNode,
  TableCellNode,
  InfoPanel,
  TableOfContents,
  ImageNode,
  Status,
  DateNode,
  Mention,
  part("hardBreak"),
  part("text"),
  // marks
  part("bold"),
  part("italic"),
  Underline,
  part("strike"),
  part("code"),
  Subscript,
  Superscript,
  LinkMark,
  TextStyle,
  ColorAttribute,
  // attributes
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: [...TEXT_ALIGNMENTS], defaultAlignment: null }),
  Indent,
]);
