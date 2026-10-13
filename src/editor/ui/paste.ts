// What may come into the editor from outside it: pasted or dropped text and HTML, the Markup
// dialog's Markdown and HTML, and files. Three layers, each a pure function tested on its own:
//
//   1. stripUnstorable: U+0000 and unpaired UTF-16 surrogates out of pasted text, because
//      PostgreSQL `jsonb` cannot hold them and the server refuses them (RD-068) — one stray
//      character would otherwise make every later autosave a 422.
//   2. sanitizeHtml: pasted HTML parsed in an inert document; elements that carry script, style
//      or foreign content removed with their contents, event-handler attributes removed, links
//      the schema refuses unwrapped (their text kept), and every `<img>` that is not an attachment
//      URL removed (RD-058: images come only from attachments; the text around it stays).
//   3. cleanPastedSlice: the parsed slice, after the schema's own parser has run: a code block's
//      language that the server would refuse (more than 64 characters, a control character) is
//      dropped, and an image of an attachment this page does not have is dropped.
// spec: docs/specs/09-decision-log.md sections RD-058 (images only from attachments), RD-063, RD-068
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { isAllowedHref, parseAttachmentSrc } from "@/editor/schema";
import { isCodeLanguage } from "@/editor/schema/rules";

/**
 * Removes what PostgreSQL `jsonb` cannot hold — U+0000 and unpaired UTF-16 surrogates (half an
 * emoji) — from pasted or dropped text. A whole emoji (a surrogate pair) is kept.
 */
// spec: docs/specs/09-decision-log.md section RD-068 (the editor strips them from pasted text)
export function stripUnstorable(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\p{Cs}/gu, "");
}

/** Elements removed with everything inside them: script, styling, embedded and foreign content. */
const REMOVED_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "title",
  "svg",
  "math",
  "canvas",
  "audio",
  "video",
  "source",
  "track",
  "portal",
] as const;

/** Attributes that name a resource to fetch or a target to submit to. */
const URL_ATTRIBUTES = ["srcset", "action", "formaction", "background", "ping", "poster", "xlink:href", "lowsrc", "dynsrc"] as const;

/** The language classes TipTap's code block reads (`language-ts`) that the schema would refuse. */
function dropBadLanguageClasses(element: Element): void {
  for (const name of Array.from(element.classList)) {
    if (name.startsWith("language-") && !isCodeLanguage(name.slice("language-".length))) element.classList.remove(name);
  }
  if (element.classList.length === 0) element.removeAttribute("class");
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

export interface SanitizeOptions {
  /** Turn GFM task lists (`<li><input type=checkbox>`) into the schema's task list markup. */
  readonly taskLists?: boolean;
}

/**
 * GFM task lists as `marked` writes them — a `<ul>` whose every item starts with a checkbox —
 * rewritten into the markup the schema parses as a task list.
 */
function convertTaskLists(doc: Document): void {
  for (const list of Array.from(doc.querySelectorAll("ul"))) {
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    const boxOf = (item: Element) => item.querySelector(':scope > input[type="checkbox"], :scope > p:first-child > input[type="checkbox"]:first-child');
    if (items.length === 0 || items.some((item) => !boxOf(item))) continue;
    list.setAttribute("data-type", "taskList");
    for (const item of items) {
      const box = boxOf(item);
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", box?.hasAttribute("checked") ? "true" : "false");
      box?.remove();
    }
  }
}

/**
 * ProseMirror's `data-pm-slice="openStart openEnd [context JSON]"`: the context names wrapper nodes
 * and their attributes, and ProseMirror builds them with `type.create(attrs)`, skipping every
 * parseHTML rule. Pasted from a hostile page it could put values in the document that the server
 * refuses (an autosave that 422s forever) or that TipTap writes raw into a style attribute. Only
 * the two open depths are kept; the structure comes from the markup itself (RD-085).
 */
function restrictSliceAttribute(element: Element): void {
  const value = element.getAttribute("data-pm-slice");
  if (value === null) return;
  const depths = /^\s*(\d{1,3})\s+(\d{1,3})(?=\s|$)/.exec(value);
  if (depths) element.setAttribute("data-pm-slice", `${depths[1]} ${depths[2]} []`);
  else element.removeAttribute("data-pm-slice");
}

/**
 * Pasted (or Markup-dialog) HTML made safe to hand to the schema's parser. Parsing happens in a
 * DOMParser document, which runs no script and loads no image. Everything the schema reads
 * (`data-*` attributes, classes, inline colours, ProseMirror's own `data-pm-slice` without its context) is kept.
 */
// spec: docs/specs/09-decision-log.md sections RD-058 (a remote <img> is dropped, its text kept), RD-063 (links), RD-068
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  const stripped = stripUnstorable(html);
  if (typeof DOMParser === "undefined") return stripped;
  const doc = new DOMParser().parseFromString(stripped, "text/html");
  for (const name of REMOVED_ELEMENTS) {
    for (const element of Array.from(doc.getElementsByTagName(name))) element.remove();
  }
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || (URL_ATTRIBUTES as readonly string[]).includes(name)) element.removeAttribute(attribute.name);
    }
    restrictSliceAttribute(element);
    const tag = element.tagName;
    if (tag === "IMG") {
      if (!parseAttachmentSrc(element.getAttribute("src"))) element.remove();
    } else if (tag === "A") {
      const href = element.getAttribute("href");
      if (href !== null && !isAllowedHref(href.trim())) unwrap(element);
    } else if (tag === "CODE" || tag === "PRE") {
      dropBadLanguageClasses(element);
    }
  }
  if (options.taskLists) convertTaskLists(doc);
  return doc.body.innerHTML;
}

export interface SliceCleanup {
  /** Whether an image of this attachment may be kept (an attachment of this page). */
  readonly keepImage: (attachmentId: string) => boolean;
}

function cleanNode(node: PMNode, cleanup: SliceCleanup): PMNode | null {
  const name = node.type.name;
  if (name === "image") {
    const id: unknown = node.attrs.attachmentId;
    return typeof id === "string" && cleanup.keepImage(id) ? node : null;
  }
  let next = node;
  if (name === "codeBlock" && !isCodeLanguage(node.attrs.language)) {
    next = node.type.create({ ...node.attrs, language: null }, node.content, node.marks);
  }
  if (next.isLeaf || next.childCount === 0) return next;
  const content = cleanFragment(next.content, cleanup);
  return content === next.content ? next : next.copy(content);
}

function cleanFragment(fragment: Fragment, cleanup: SliceCleanup): Fragment {
  let changed = false;
  const children: PMNode[] = [];
  fragment.forEach((child) => {
    const cleaned = cleanNode(child, cleanup);
    if (cleaned !== child) changed = true;
    if (cleaned) children.push(cleaned);
  });
  return changed ? Fragment.fromArray(children) : fragment;
}

/**
 * A pasted or dropped slice, after parsing: images of attachments this page does not have are
 * dropped (the server would refuse them, RD-058), and code-block languages the schema refuses are
 * cleared (RD-068). Only inline images are ever removed, and every textblock accepts empty
 * content, so the result is always valid where the original was.
 */
// spec: docs/specs/09-decision-log.md sections RD-058 and RD-068
export function cleanPastedSlice(slice: Slice, cleanup: SliceCleanup): Slice {
  const content = cleanFragment(slice.content, cleanup);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/** Every attachment id an image in `doc` references. */
export function imageAttachmentIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "image" && typeof node.attrs.attachmentId === "string") ids.add(node.attrs.attachmentId);
    return !node.isLeaf;
  });
  return ids;
}

/** The part of a DataTransfer the upload decision reads. */
export interface TransferLike {
  readonly files: ArrayLike<File> | null | undefined;
  getData(format: string): string;
}

/**
 * The files a paste or a drop should upload, or none. When text comes with the files (copying
 * cells from a spreadsheet or a word processor also puts a picture of them on the clipboard), the
 * text wins and nothing is uploaded; a copied image or a file dropped from the desktop comes with
 * no text, and is uploaded.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (files and images come from uploads)
export function filesToUpload(transfer: TransferLike | null | undefined): File[] {
  if (!transfer?.files || transfer.files.length === 0) return [];
  let text = "";
  try {
    text = transfer.getData("text/plain");
  } catch {
    text = "";
  }
  if (text.trim().length > 0) return [];
  return Array.from(transfer.files);
}
