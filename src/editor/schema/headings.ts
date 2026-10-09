// Headings and their anchor ids, for the table of contents and for links into a page.
// An id is a prefix (HEADING_ID_PREFIX unless the caller names another) and a GitHub-style
// slug: lower-cased, spaces to hyphens, punctuation stripped, Unicode letters and digits
// kept, repeats suffixed -1, -2, … in document order. Tolerates any input (the renderer calls
// it on whatever it is given): it walks iteratively, stops at the schema's depth limit and
// never visits more than MAX_VISITED_NODES nodes.
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (tableOfContents)
import { Node as PMNode } from "@tiptap/pm/model";
import { HEADING_ID_PREFIX } from "./dom";
import { MAX_NODE_DEPTH } from "./rules";

export interface HeadingEntry {
  level: number;
  text: string;
  id: string;
}

export interface HeadingIdOptions {
  /**
   * Put before every slug. Defaults to HEADING_ID_PREFIX. Two views of content on one screen
   * (the history compare, RD-060) each need their own, or their ids and anchors collide.
   */
  idPrefix?: string;
}

export interface HeadingIndex {
  /** Every heading in document order (pre-order, containers included). */
  entries: HeadingEntry[];
  /** The entry for a heading node object of the indexed JSON, by identity. */
  entryFor(node: object): HeadingEntry | undefined;
}

/**
 * Upper bound on nodes visited, so a hostile object graph cannot stall a render. No valid
 * stored document comes near it: the smallest canonical node is about 21 bytes of JSON, so
 * 5 MiB holds at most ~250 000 nodes.
 */
export const MAX_VISITED_NODES = 300_000;

/** What a heading whose text has no letters or digits is called. */
export const EMPTY_HEADING_SLUG = "heading";

// Everything that is not a letter, mark, digit, connector (`_`), hyphen or space.
const STRIP = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

/** A single slug, before de-duplication. */
export function slugify(text: string): string {
  return text.toLowerCase().replace(STRIP, "").replace(/ /g, "-");
}

/** De-duplicates slugs the way github-slugger does: `a`, `a-1`, `a-2`, … */
export class Slugger {
  private readonly occurrences = new Map<string, number>();

  slug(text: string): string {
    const base = slugify(text) || EMPTY_HEADING_SLUG;
    let result = base;
    while (this.occurrences.has(result)) {
      const n = (this.occurrences.get(base) ?? 0) + 1;
      this.occurrences.set(base, n);
      result = `${base}-${n}`;
    }
    this.occurrences.set(result, 0);
    return result;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The heading's own text: its text nodes, hard breaks as spaces, whitespace collapsed. */
export function headingText(node: Record<string, unknown>): string {
  const content = Array.isArray(node.content) ? (node.content as unknown[]) : [];
  let text = "";
  for (const child of content) {
    if (!isRecord(child)) continue;
    if (child.type === "text" && typeof child.text === "string") text += child.text;
    else if (child.type === "hardBreak") text += " ";
  }
  return text.replace(/\s+/g, " ").trim();
}

function headingLevel(node: Record<string, unknown>): number | null {
  const attrs = isRecord(node.attrs) ? node.attrs : {};
  const level = attrs.level;
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
}

/**
 * Indexes the headings of a document given as canonical JSON (or a ProseMirror node, which
 * is converted first).
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (tableOfContents)
export function indexHeadings(doc: unknown, { idPrefix = HEADING_ID_PREFIX }: HeadingIdOptions = {}): HeadingIndex {
  const root: unknown = doc instanceof PMNode ? doc.toJSON() : doc;
  const entries: HeadingEntry[] = [];
  const byNode = new WeakMap<object, HeadingEntry>();
  const slugger = new Slugger();

  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_VISITED_NODES) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number };
    visited++;
    if (!isRecord(node) || depth > MAX_NODE_DEPTH) continue;
    if (node.type === "heading") {
      const level = headingLevel(node);
      if (level !== null && !byNode.has(node)) {
        const text = headingText(node);
        const entry = { level, text, id: idPrefix + slugger.slug(text) };
        entries.push(entry);
        byNode.set(node, entry);
      }
      continue; // headings hold inline content only
    }
    const content = node.content;
    if (!Array.isArray(content)) continue;
    // Never queue more than the budget allows, however long (or sparse) the array claims to be.
    const take = Math.min(content.length, Math.max(0, MAX_VISITED_NODES - visited - stack.length));
    for (let i = take - 1; i >= 0; i--) stack.push({ node: content[i], depth: depth + 1 });
  }

  return { entries, entryFor: (node) => byNode.get(node) };
}

/** Every heading in document order with a stable, unique id. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (tableOfContents)
export function collectHeadings(doc: unknown, options: HeadingIdOptions = {}): HeadingEntry[] {
  return indexHeadings(doc, options).entries;
}
