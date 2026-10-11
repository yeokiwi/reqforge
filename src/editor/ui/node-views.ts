// The editor's views of the custom nodes (03 §1.4), extending the headless nodes BY NAME; the
// schema is never changed. Each draws the same classes and data attributes the page view
// (DocumentView) draws, so content.css styles both, and every user-supplied value is written as
// text (textContent, setAttribute), never as HTML.
//
//   infoPanel        editable content, with a `Panel type` switcher (a native select, so it is
//                    keyboard-operable) that changes the variant as one undoable transaction
//   status           a lozenge; a click, or Enter while it is selected, opens its editor
//   date             the formatted date; a click, or Enter while it is selected, opens its editor
//   mention          `@label`, an atom
//   tableOfContents  a live preview of the page's headings (collectHeadings, so the anchors are
//                    the page view's `rf-h-…` ids); a click scrolls the editor to the heading
// spec: docs/specs/03-authoring-and-indexing.md section 1.4; docs/specs/10-ui-reference.md sections 5.4 and 5.5 (Info, Status, Date, User mention, Table of Contents)
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { type ParamlessCopyId, t } from "@/copy";
import {
  CLASS,
  MENTION_PREFIX,
  PANEL_VARIANTS,
  type PanelVariant,
  STATUS_COLOURS,
  collectHeadings,
  formatDateValue,
  type HeadingEntry,
} from "@/editor/schema";
import type { EditorUiBridge } from "./ui-bridge";

/** The props TipTap hands a node view (the subset these views use). */
export interface NodeViewContext {
  readonly editor: Editor;
  readonly node: PMNode;
  readonly getPos: () => number | undefined;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function positionOf(getPos: () => number | undefined): number | null {
  const pos = getPos();
  return typeof pos === "number" && Number.isInteger(pos) && pos >= 0 ? pos : null;
}

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return (values as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

// ------------------------------------------------------------------------------ info panel

export const PANEL_VARIANT_COPY: Readonly<Record<PanelVariant, ParamlessCopyId>> = Object.freeze({
  info: "editor.panel.info",
  note: "editor.panel.note",
  success: "editor.panel.success",
  warning: "editor.panel.warning",
  error: "editor.panel.error",
});

/** Sets an info panel's variant, as one transaction. False when `pos` is not an info panel. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (infoPanel.variant)
export function setPanelVariant(tr: Transaction, pos: number, variant: string): boolean {
  const node = tr.doc.nodeAt(pos);
  if (node?.type.name !== "infoPanel" || !(PANEL_VARIANTS as readonly string[]).includes(variant)) return false;
  if (node.attrs.variant === variant) return false;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, variant });
  return true;
}

// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5 (Info — info panel); RD-057
export class InfoPanelView implements NodeView {
  readonly dom: HTMLDivElement;
  readonly contentDOM: HTMLDivElement;
  readonly controls: HTMLDivElement;
  readonly select: HTMLSelectElement;
  private node: PMNode;

  constructor(private readonly context: NodeViewContext) {
    this.node = context.node;
    this.dom = document.createElement("div");
    this.dom.setAttribute("data-type", "infoPanel");
    this.controls = this.dom.appendChild(document.createElement("div"));
    this.controls.className = "rf-panel__controls";
    this.controls.setAttribute("contenteditable", "false");
    this.select = this.controls.appendChild(document.createElement("select"));
    this.select.setAttribute("aria-label", t("editor.panel.type"));
    this.select.title = t("editor.panel.type");
    for (const variant of PANEL_VARIANTS) {
      const option = this.select.appendChild(document.createElement("option"));
      option.value = variant;
      option.textContent = t(PANEL_VARIANT_COPY[variant]);
    }
    this.select.addEventListener("change", this.onChange);
    this.contentDOM = this.dom.appendChild(document.createElement("div"));
    this.contentDOM.className = "rf-panel__content";
    this.render();
  }

  private readonly onChange = () => {
    const { editor, getPos } = this.context;
    const pos = positionOf(getPos);
    const variant = this.select.value;
    if (pos === null || !editor.isEditable) {
      this.render();
      return;
    }
    const tr = editor.state.tr;
    if (setPanelVariant(tr, pos, variant)) editor.view.dispatch(tr);
    else this.render();
  };

  private render(): void {
    const variant = oneOf(PANEL_VARIANTS, this.node.attrs.variant, "info");
    const className = CLASS.panel(variant);
    if (this.dom.className !== className) this.dom.className = className;
    this.dom.setAttribute("data-variant", variant);
    if (this.select.value !== variant) this.select.value = variant;
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** The switcher's own events are not editing. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.controls.contains(event.target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    if (this.controls.contains(mutation.target)) return true;
    return mutation.type === "attributes" && mutation.target === this.dom;
  }

  destroy(): void {
    this.select.removeEventListener("change", this.onChange);
  }
}

// ------------------------------------------------------------------- status and date atoms

abstract class EditableAtomView implements NodeView {
  readonly dom: HTMLElement;
  protected node: PMNode;

  constructor(
    protected readonly context: NodeViewContext,
    protected readonly ui: EditorUiBridge,
    private readonly kind: "status" | "date",
    tag: "span" | "time",
  ) {
    this.node = context.node;
    this.dom = document.createElement(tag);
    this.dom.setAttribute("data-type", kind);
    this.dom.addEventListener("click", this.onClick);
    this.render();
  }

  protected abstract render(): void;

  /** A click selects the atom (ProseMirror does that) and opens its editor. */
  private readonly onClick = (event: MouseEvent) => {
    const { editor, getPos } = this.context;
    const pos = positionOf(getPos);
    if (pos === null || !editor.isEditable || event.button !== 0) return;
    event.preventDefault();
    if (!(editor.state.selection instanceof NodeSelection) || editor.state.selection.from !== pos) {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    }
    this.ui.call("editNode", { kind: this.kind, pos });
  };

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.dom.removeEventListener("click", this.onClick);
  }
}

// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5 (Status — lozenge); 4.2 (status value renders as a lozenge)
export class StatusView extends EditableAtomView {
  constructor(context: NodeViewContext, ui: EditorUiBridge) {
    super(context, ui, "status", "span");
  }

  protected render(): void {
    const colour = oneOf(STATUS_COLOURS, this.node.attrs.colour, "grey");
    this.dom.className = CLASS.status(colour);
    this.dom.setAttribute("data-colour", colour);
    this.dom.title = t("editor.status.title");
    this.dom.textContent = textOf(this.node.attrs.text);
  }
}

// spec: docs/specs/10-ui-reference.md section 5.5 (Date); RD-069 (dates display as the en-US short date)
export class DateView extends EditableAtomView {
  constructor(context: NodeViewContext, ui: EditorUiBridge) {
    super(context, ui, "date", "time");
  }

  protected render(): void {
    const value = textOf(this.node.attrs.value);
    this.dom.className = CLASS.date;
    if (value) this.dom.setAttribute("datetime", value);
    else this.dom.removeAttribute("datetime");
    this.dom.title = t("editor.date.editTitle");
    this.dom.textContent = formatDateValue(value) ?? value;
  }
}

// ---------------------------------------------------------------------------------- mention

// spec: docs/specs/10-ui-reference.md section 5.5 (User mention)
export class MentionView implements NodeView {
  readonly dom: HTMLSpanElement;
  private node: PMNode;

  constructor(context: NodeViewContext) {
    this.node = context.node;
    this.dom = document.createElement("span");
    this.dom.setAttribute("data-type", "mention");
    this.dom.className = CLASS.mention;
    this.render();
  }

  private render(): void {
    const userId = textOf(this.node.attrs.userId);
    if (userId) this.dom.setAttribute("data-user-id", userId);
    else this.dom.removeAttribute("data-user-id");
    this.dom.textContent = MENTION_PREFIX + textOf(this.node.attrs.label);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

// ------------------------------------------------------------------------ table of contents

interface HeadingAt {
  readonly level: number;
  readonly pos: number;
  readonly json: unknown;
  readonly key: string;
}

/** Every heading of the document in document order, with its position. Does not enter textblocks. */
export function headingsWithPositions(doc: PMNode): HeadingAt[] {
  const found: HeadingAt[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = typeof node.attrs.level === "number" ? node.attrs.level : 0;
      found.push({ level, pos, json: node.toJSON(), key: `${level}\u0000${node.textContent}` });
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

export interface TocEntry extends HeadingEntry {
  /** Which heading of the document it is (0 = the first), whatever its level. */
  readonly index: number;
  /** Where the heading is in the editor's document. */
  readonly pos: number;
}

/**
 * The table of contents of `doc` between two levels: the page view's entries (collectHeadings,
 * so the ids are the same `rf-h-…` anchors), each with the heading's position in the editor.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (tableOfContents); RD-069 (heading anchors)
export function tableOfContentsEntries(doc: PMNode, minLevel: number, maxLevel: number): TocEntry[] {
  const headings = headingsWithPositions(doc);
  // Only the headings decide the slugs, and in this order: the same ids collectHeadings gives the
  // whole document, without serialising the whole document.
  const entries = collectHeadings({ type: "doc", content: headings.map((h) => h.json) });
  const out: TocEntry[] = [];
  entries.forEach((entry, i) => {
    const at = headings[i];
    if (!at || entry.level < minLevel || entry.level > maxLevel || entry.text.length === 0) return;
    out.push({ ...entry, index: i, pos: at.pos });
  });
  return out;
}

function levelOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6 ? value : fallback;
}

// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5 (Table of Contents)
export class TableOfContentsView implements NodeView {
  readonly dom: HTMLElement;
  private node: PMNode;
  private signature = "";
  private entries: TocEntry[] = [];

  constructor(private readonly context: NodeViewContext) {
    this.node = context.node;
    this.dom = document.createElement("nav");
    this.dom.setAttribute("data-type", "tableOfContents");
    this.dom.className = CLASS.toc;
    this.dom.addEventListener("click", this.onClick);
    context.editor.on("transaction", this.onTransaction);
    this.render(true);
  }

  private readonly onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) this.render(false);
  };

  private readonly onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest("a[data-heading]") : null;
    if (!target) return;
    event.preventDefault();
    const { editor } = this.context;
    const heading = headingsWithPositions(editor.state.doc)[Number(target.getAttribute("data-heading"))];
    if (!heading) return;
    const $inside = editor.state.doc.resolve(heading.pos + 1);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($inside)).scrollIntoView());
    editor.view.focus();
  };

  private render(force: boolean): void {
    const min = levelOf(this.node.attrs.minLevel, 1);
    const max = levelOf(this.node.attrs.maxLevel, 6);
    const doc = this.context.editor.state.doc;
    const headings = headingsWithPositions(doc);
    // Typing elsewhere moves the headings but changes nothing shown: redraw only when it does.
    const signature = `${min}-${max}|${headings.map((h) => h.key).join("\u0001")}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.entries = tableOfContentsEntries(doc, min, max);
    this.dom.setAttribute("data-min-level", String(min));
    this.dom.setAttribute("data-max-level", String(max));
    this.dom.replaceChildren();
    if (this.entries.length === 0) {
      const empty = this.dom.appendChild(document.createElement("p"));
      empty.className = "rf-toc__empty";
      empty.textContent = t("editor.toc.empty");
      return;
    }
    const list = this.dom.appendChild(document.createElement("ul"));
    for (const entry of this.entries) {
      const item = list.appendChild(document.createElement("li"));
      item.className = CLASS.tocItem;
      item.setAttribute("data-level", String(entry.level - min + 1));
      const link = item.appendChild(document.createElement("a"));
      link.href = `#${entry.id}`;
      link.setAttribute("data-heading", String(entry.index));
      link.textContent = entry.text;
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.minLevel !== this.node.attrs.minLevel || node.attrs.maxLevel !== this.node.attrs.maxLevel;
    this.node = node;
    if (changed) this.render(true);
    return true;
  }

  /** Clicks on the list are the list's (they scroll to a heading). */
  stopEvent(event: Event): boolean {
    return event.type !== "dragstart" && event.target instanceof Element && event.target.closest("a[data-heading]") !== null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.dom.removeEventListener("click", this.onClick);
    this.context.editor.off("transaction", this.onTransaction);
  }
}
