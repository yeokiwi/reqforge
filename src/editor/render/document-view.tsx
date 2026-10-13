// Renders canonical ProseMirror content (`03` §1.5) to React elements, for the page view, past
// versions, the history compare and `?format=html`. Static: no hooks, no context, no browser
// APIs and no react-dom, so it runs as a server component, in a route handler (to-html.ts
// serialises it there with renderStaticMarkup) and under renderToStaticMarkup.
//
// It trusts nothing. Every attribute that reaches the DOM is re-checked with the schema's own
// rules (links, image sources, colours, alignment), React escapes all text and attribute
// values, and HTML is never injected as a string. Unknown nodes render their children and
// unknown marks are skipped (forward compatibility); anything malformed renders nothing.
// spec: docs/specs/10-ui-reference.md section 4.2; docs/specs/03-authoring-and-indexing.md sections 1.4 and 1.5 (RD-058, RD-063)
import "../content.css";
import { type CSSProperties, Fragment, type ReactNode, createElement } from "react";
import { CLASS, HEADING_ID_PREFIX, MENTION_PREFIX, NUMBER_COLUMN_WIDTH } from "@/editor/schema/dom";
import { formatDateValue } from "@/editor/schema/format";
import {
  type HeadingIndex,
  MAX_VISITED_NODES,
  TOC_ENTRIES_PER_DOCUMENT,
  TOC_ENTRIES_PER_NODE,
  indexHeadings,
} from "@/editor/schema/headings";
import {
  INDENT_MAX,
  MAX_COLSPAN,
  MAX_COLUMN_WIDTH,
  MAX_IMAGE_WIDTH,
  MAX_NODE_DEPTH,
  MAX_ROWSPAN,
  PANEL_VARIANTS,
  STATUS_COLOURS,
  TABLE_WIDTH_MODES,
  TEXT_ALIGNMENTS,
  classifyHref,
  isAttachmentSrcFor,
  isCalendarDate,
  isCodeLanguage,
  isHexColour,
  isIntegerInRange,
  isOneOf,
} from "@/editor/schema/rules";

/** A node as the renderer sees it: shape-checked, attributes still untrusted. */
export interface ContentNode {
  type: string;
  attrs: Readonly<Record<string, unknown>>;
  content: readonly unknown[];
  marks: readonly ContentMark[];
  text: string | null;
}

export interface ContentMark {
  type: string;
  attrs: Readonly<Record<string, unknown>>;
}

/**
 * Renders one node type. `children` is the node's rendered content (null for atoms). The
 * extension point later slices use for requirement pills; an entry here replaces the
 * built-in rendering of that type.
 */
export type NodeRenderer = (node: ContentNode, children: ReactNode) => ReactNode;
export type NodeRenderers = Readonly<Partial<Record<string, NodeRenderer>>>;

export interface DocumentViewProps {
  content: unknown;
  className?: string;
  nodeRenderers?: NodeRenderers;
  /**
   * What heading ids (and the table of contents' links) start with; defaults to
   * HEADING_ID_PREFIX. Give each view its own when two render on one screen, as the history
   * compare does (RD-060), or their anchors collide.
   */
  idPrefix?: string;
}

interface RenderContext {
  readonly headings: HeadingIndex;
  readonly custom: NodeRenderers;
  budget: number;
  /** Table-of-contents entries still allowed in this document (RD-085). */
  tocBudget: number;
}

const NO_ATTRS: Readonly<Record<string, unknown>> = Object.freeze({});
const NO_CONTENT: readonly unknown[] = Object.freeze([]);
const MAX_MARKS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMarks(value: unknown): ContentMark[] {
  if (!Array.isArray(value)) return [];
  const marks: ContentMark[] = [];
  for (let i = 0; i < Math.min(value.length, MAX_MARKS); i++) {
    const mark: unknown = value[i];
    if (isRecord(mark) && typeof mark.type === "string") {
      marks.push({ type: mark.type, attrs: isRecord(mark.attrs) ? mark.attrs : NO_ATTRS });
    }
  }
  return marks;
}

function asNode(value: unknown): ContentNode | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  return {
    type: value.type,
    attrs: isRecord(value.attrs) ? value.attrs : NO_ATTRS,
    content: Array.isArray(value.content) ? value.content : NO_CONTENT,
    marks: asMarks(value.marks),
    text: typeof value.text === "string" ? value.text : null,
  };
}

// ---------------------------------------------------------------------------- attributes

function blockStyle(node: ContentNode): CSSProperties | undefined {
  const align = node.attrs.textAlign;
  return isOneOf(TEXT_ALIGNMENTS, align) ? { textAlign: align } : undefined;
}

function indentOf(node: ContentNode): string | undefined {
  const indent = node.attrs.indent;
  return isIntegerInRange(indent, 1, INDENT_MAX) ? String(indent) : undefined;
}

function spanOf(value: unknown, max: number): number {
  return isIntegerInRange(value, 1, max) ? value : 1;
}

function widthsOf(value: unknown, colspan: number): number[] | null {
  if (!Array.isArray(value) || value.length !== colspan) return null;
  return value.every((w) => typeof w === "number" && Number.isFinite(w) && w >= 0 && w <= MAX_COLUMN_WIDTH)
    ? (value as number[])
    : null;
}

function plainText(node: ContentNode): string {
  let text = "";
  for (let i = 0; i < node.content.length && i < MAX_VISITED_NODES; i++) {
    const child = asNode(node.content[i]);
    if (child?.text) text += child.text;
  }
  return text;
}

// --------------------------------------------------------------------------------- marks

type MarkRenderer = (mark: ContentMark, children: ReactNode) => ReactNode;

const MARK_RENDERERS: Readonly<Record<string, MarkRenderer>> = {
  bold: (_m, children) => <strong>{children}</strong>,
  italic: (_m, children) => <em>{children}</em>,
  underline: (_m, children) => <u>{children}</u>,
  strike: (_m, children) => <s>{children}</s>,
  code: (_m, children) => <code>{children}</code>,
  subscript: (_m, children) => <sub>{children}</sub>,
  superscript: (_m, children) => <sup>{children}</sup>,
  link: (mark, children) => {
    const href = mark.attrs.href;
    const kind = classifyHref(href);
    if (kind === null || typeof href !== "string") return children;
    if (kind === "external") {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    return <a href={href}>{children}</a>;
  },
  textStyle: (mark, children) => {
    const color = mark.attrs.color;
    return isHexColour(color) ? <span style={{ color }}>{children}</span> : children;
  },
};

/** Marks are stored outermost first (schema rank), so they wrap from the last inwards. */
function withMarks(marks: readonly ContentMark[], inner: ReactNode): ReactNode {
  let out = inner;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i] as ContentMark;
    const render = MARK_RENDERERS[mark.type];
    if (render) out = render(mark, out);
  }
  return out;
}

// --------------------------------------------------------------------------------- nodes

type BuiltIn = (node: ContentNode, children: () => ReactNode, ctx: RenderContext, raw: object) => ReactNode;

function heading(node: ContentNode, children: () => ReactNode, ctx: RenderContext, raw: object): ReactNode {
  const level = node.attrs.level;
  if (!isIntegerInRange(level, 1, 6)) return <p>{children()}</p>;
  return createElement(
    `h${level}`,
    { id: ctx.headings.entryFor(raw)?.id, style: blockStyle(node), "data-indent": indentOf(node) },
    children(),
  );
}

/**
 * The table's `<colgroup>`, from the stored widths of its first row, or null when none is
 * stored. A numbered table's counter (content.css `tr::before`) is a real leading table
 * column, so it gets a `<col>` of its own and its width counts in the total; otherwise every
 * stored width would land one column to the left (RD-057 `num`).
 */
function colGroup(table: ContentNode, numbered: boolean): { cols: ReactNode; total: number | null } | null {
  const firstRow = asNode(table.content[0]);
  if (!firstRow) return null;
  const widths: Array<number | null> = [];
  for (let i = 0; i < firstRow.content.length && widths.length < MAX_COLSPAN; i++) {
    const cell = asNode(firstRow.content[i]);
    if (!cell) continue;
    const colspan = spanOf(cell.attrs.colspan, MAX_COLSPAN);
    const colwidth = widthsOf(cell.attrs.colwidth, colspan);
    for (let j = 0; j < colspan && widths.length < MAX_COLSPAN; j++) {
      const w = colwidth?.[j];
      widths.push(w && w > 0 ? w : null);
    }
  }
  if (!widths.some((w) => w !== null)) return null;
  const sum = widths.every((w) => w !== null) ? widths.reduce<number>((acc, w) => acc + (w ?? 0), 0) : null;
  return {
    cols: (
      <colgroup>
        {numbered ? <col className={CLASS.tableNumberColumn} style={{ width: NUMBER_COLUMN_WIDTH }} /> : null}
        {widths.map((w, i) => (
          <col key={i} style={w === null ? undefined : { width: w }} />
        ))}
      </colgroup>
    ),
    total: sum === null ? null : sum + (numbered ? NUMBER_COLUMN_WIDTH : 0),
  };
}

function table(node: ContentNode, children: () => ReactNode): ReactNode {
  const mode = isOneOf(TABLE_WIDTH_MODES, node.attrs.widthMode) ? node.attrs.widthMode : "responsive";
  const numbered = node.attrs.numberedColumn === true;
  const classes = [CLASS.table, CLASS.tableWidthMode(mode), numbered ? CLASS.tableNumbered : null].filter(Boolean).join(" ");
  const cols = colGroup(node, numbered);
  const style = mode === "fixed" && cols?.total ? { width: cols.total } : undefined;
  return (
    <div className={CLASS.tableWrapper}>
      <table
        className={classes}
        style={style}
        data-width-mode={mode}
        data-numbered-column={numbered ? "true" : undefined}
      >
        {cols?.cols}
        <tbody>{children()}</tbody>
      </table>
    </div>
  );
}

function tableCell(tag: "th" | "td") {
  return function renderTableCell(node: ContentNode, children: () => ReactNode): ReactNode {
    const colspan = spanOf(node.attrs.colspan, MAX_COLSPAN);
    const rowspan = spanOf(node.attrs.rowspan, MAX_ROWSPAN);
    const colwidth = widthsOf(node.attrs.colwidth, colspan);
    const background = isHexColour(node.attrs.background) ? node.attrs.background : undefined;
    return createElement(
      tag,
      {
        colSpan: colspan === 1 ? undefined : colspan,
        rowSpan: rowspan === 1 ? undefined : rowspan,
        "data-colwidth": colwidth ? colwidth.join(",") : undefined,
        "data-background": background,
        style: background ? { backgroundColor: background } : undefined,
      },
      children(),
    );
  };
}

function tableOfContents(node: ContentNode, _children: () => ReactNode, ctx: RenderContext): ReactNode {
  const min = isIntegerInRange(node.attrs.minLevel, 1, 6) ? node.attrs.minLevel : 1;
  const max = isIntegerInRange(node.attrs.maxLevel, 1, 6) ? node.attrs.maxLevel : 6;
  const wanted = ctx.headings.entries.filter((e) => e.level >= min && e.level <= max && e.text.length > 0);
  // Capped per table and per document, so many tables over many headings cannot multiply (RD-085).
  const entries = wanted.slice(0, Math.max(0, Math.min(TOC_ENTRIES_PER_NODE, ctx.tocBudget)));
  ctx.tocBudget -= entries.length;
  return (
    <nav data-type="tableOfContents" className={CLASS.toc} data-min-level={min} data-max-level={max}>
      {entries.length > 0 ? (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className={CLASS.tocItem} data-level={entry.level - min + 1}>
              <a href={`#${entry.id}`}>{entry.text}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

function image(node: ContentNode): ReactNode {
  const { attachmentId, src, alt, title, width } = node.attrs;
  if (!isAttachmentSrcFor(src, attachmentId)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- attachment bytes, served by our own API
    <img
      src={src}
      alt={typeof alt === "string" ? alt : ""}
      title={typeof title === "string" ? title : undefined}
      width={isIntegerInRange(width, 1, MAX_IMAGE_WIDTH) ? width : undefined}
      loading="lazy"
      decoding="async"
      data-attachment-id={attachmentId as string}
    />
  );
}

function status(node: ContentNode): ReactNode {
  const text = node.attrs.text;
  if (typeof text !== "string" || text.trim().length === 0) return null;
  const colour = isOneOf(STATUS_COLOURS, node.attrs.colour) ? node.attrs.colour : "grey";
  return (
    <span data-type="status" data-colour={colour} className={CLASS.status(colour)}>
      {text}
    </span>
  );
}

function date(node: ContentNode): ReactNode {
  const value = node.attrs.value;
  if (!isCalendarDate(value)) return typeof value === "string" ? value : null;
  return (
    <time data-type="date" className={CLASS.date} dateTime={value}>
      {formatDateValue(value)}
    </time>
  );
}

function mention(node: ContentNode): ReactNode {
  const { userId, label } = node.attrs;
  if (typeof label !== "string" || label.length === 0) return null;
  return (
    <span data-type="mention" className={CLASS.mention} data-user-id={typeof userId === "string" ? userId : undefined}>
      {MENTION_PREFIX + label}
    </span>
  );
}

function taskItem(node: ContentNode, children: () => ReactNode): ReactNode {
  const checked = node.attrs.checked === true;
  return (
    <li data-type="taskItem" data-checked={checked ? "true" : "false"}>
      <label>
        <input type="checkbox" checked={checked} disabled readOnly />
        <span />
      </label>
      <div>{children()}</div>
    </li>
  );
}

/**
 * The built-in rendering of every node type in the schema. A parity test fails if the
 * schema has a node that is missing here.
 */
// spec: docs/specs/10-ui-reference.md section 4.2; docs/specs/03-authoring-and-indexing.md section 1.4
export const NODE_RENDERERS: Readonly<Record<string, BuiltIn>> = {
  doc: (_n, children) => children(),
  paragraph: (node, children) => (
    <p style={blockStyle(node)} data-indent={indentOf(node)}>
      {children()}
    </p>
  ),
  heading,
  blockquote: (_n, children) => <blockquote>{children()}</blockquote>,
  codeBlock: (node) => {
    const language = node.attrs.language;
    const known = typeof language === "string" && isCodeLanguage(language);
    return (
      <pre data-language={known ? language : undefined}>
        <code className={known ? `language-${language}` : undefined}>{plainText(node)}</code>
      </pre>
    );
  },
  horizontalRule: () => <hr />,
  bulletList: (_n, children) => <ul>{children()}</ul>,
  orderedList: (node, children) => {
    const start = node.attrs.start;
    const valid = typeof start === "number" && Number.isSafeInteger(start) && start >= 0 && start !== 1;
    return <ol start={valid ? start : undefined}>{children()}</ol>;
  },
  listItem: (_n, children) => <li>{children()}</li>,
  taskList: (_n, children) => <ul data-type="taskList">{children()}</ul>,
  taskItem,
  table,
  tableRow: (_n, children) => <tr>{children()}</tr>,
  tableHeader: tableCell("th"),
  tableCell: tableCell("td"),
  infoPanel: (node, children) => {
    const variant = isOneOf(PANEL_VARIANTS, node.attrs.variant) ? node.attrs.variant : "info";
    return (
      <div data-type="infoPanel" data-variant={variant} className={CLASS.panel(variant)}>
        {children()}
      </div>
    );
  },
  tableOfContents,
  image,
  status,
  date,
  mention,
  hardBreak: () => <br />,
  text: (node) => node.text,
};

/** Every mark type DocumentView renders. */
export const RENDERED_MARK_TYPES: readonly string[] = Object.freeze(Object.keys(MARK_RENDERERS));

// Inline node types: their marks are rendered around them (an image can be a link).
const INLINE_TYPES = new Set(["text", "image", "status", "date", "mention", "hardBreak"]);

function renderChildren(node: ContentNode, depth: number, ctx: RenderContext): ReactNode {
  const out: ReactNode[] = [];
  // A for loop, never .map: a hostile sparse array may claim 2^32 − 1 elements.
  for (let i = 0; i < node.content.length && ctx.budget > 0; i++) {
    out.push(renderNode(node.content[i], depth + 1, i, ctx));
  }
  return out;
}

function renderNode(value: unknown, depth: number, key: number, ctx: RenderContext): ReactNode {
  if (depth > MAX_NODE_DEPTH || ctx.budget <= 0) return null;
  ctx.budget -= 1;
  try {
    const node = asNode(value);
    if (!node) return null;
    const children = () => renderChildren(node, depth, ctx);
    const custom = ctx.custom[node.type];
    const builtIn = NODE_RENDERERS[node.type];
    let rendered: ReactNode;
    if (custom) rendered = custom(node, node.content.length > 0 ? children() : null);
    else if (builtIn) rendered = builtIn(node, children, ctx, value as object);
    else rendered = children(); // an unknown node: its content, without a wrapper
    if (INLINE_TYPES.has(node.type) && node.marks.length > 0) rendered = withMarks(node.marks, rendered);
    return <Fragment key={key}>{rendered}</Fragment>;
  } catch {
    return null; // a throwing getter or similar: render nothing rather than fail the page
  }
}

const NO_HEADINGS: HeadingIndex = { entries: [], entryFor: () => undefined };

function headingsOf(content: unknown, idPrefix: string): HeadingIndex {
  try {
    return indexHeadings(content, { idPrefix });
  } catch {
    return NO_HEADINGS;
  }
}

/** Renders a document's content inside a `.rf-content` container. */
// spec: docs/specs/10-ui-reference.md section 4.2; docs/specs/03-authoring-and-indexing.md section 1.5
export function DocumentView({ content, className, nodeRenderers, idPrefix = HEADING_ID_PREFIX }: DocumentViewProps): ReactNode {
  const ctx: RenderContext = {
    headings: headingsOf(content, idPrefix),
    custom: nodeRenderers ?? {},
    budget: MAX_VISITED_NODES,
    tocBudget: TOC_ENTRIES_PER_DOCUMENT,
  };
  return (
    <div className={className ? `${CLASS.content} ${className}` : CLASS.content}>{renderNode(content, 1, 0, ctx)}</div>
  );
}
