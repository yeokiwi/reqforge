// Image nodes reference attachments of their OWN page (RD-058), so copying a page's content
// to another page means pointing every image at the copy's own attachment rows. Pure functions
// over canonical ProseMirror JSON: a node is `{ type, attrs?, content?, marks?, text? }` and
// only `content` holds child nodes.
import { attachmentUrl } from "@/domain/documents";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function forEachNode(doc: unknown, visit: (node: JsonObject) => void): void {
  const stack: unknown[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isObject(node)) continue;
    visit(node);
    if (Array.isArray(node.content)) for (const child of node.content as unknown[]) stack.push(child);
  }
}

/** The ids of every attachment an image node in `doc` references. */
// spec: docs/specs/09-decision-log.md section RD-058 (an image node may only reference an attachment on the same page)
export function imageAttachmentIds(doc: unknown): Set<string> {
  const ids = new Set<string>();
  forEachNode(doc, (node) => {
    if (node.type !== "image" || !isObject(node.attrs)) return;
    const id = node.attrs.attachmentId;
    if (typeof id === "string") ids.add(id);
  });
  return ids;
}

export interface CopiedAttachment {
  /** The copy's attachment row id. */
  readonly id: string;
  /** Its stored (sanitised) filename. */
  readonly filename: string;
}

/**
 * A deep copy of `doc` in which every image whose `attachmentId` is a key of `map` points at
 * the mapped attachment: `attachmentId` replaced and `src` rebuilt with attachmentUrl, so the
 * copy validates against the new page's attachments. Everything else — key order included — is
 * left as it was, so canonical input stays canonical. `doc` is not modified.
 */
// spec: docs/specs/09-decision-log.md sections RD-056 (Copy), RD-058 (images reference their own page), RD-068 (attachment src form)
export function rewriteImageAttachments(doc: unknown, map: ReadonlyMap<string, CopiedAttachment>): unknown {
  const copy: unknown = structuredClone(doc);
  forEachNode(copy, (node) => {
    if (node.type !== "image" || !isObject(node.attrs)) return;
    const from = node.attrs.attachmentId;
    if (typeof from !== "string") return;
    const to = map.get(from);
    if (!to) return;
    node.attrs.attachmentId = to.id;
    node.attrs.src = attachmentUrl(to.id, to.filename);
  });
  return copy;
}
