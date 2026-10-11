// Files and images (10 §5.5, RD-058): what an upload looks like inside the editor while it runs,
// and what a failed one says. The toolbar's `🖼`, the `+ ▾` menu's `Files and images`, a paste
// and a drop all go through one path (use-uploads.ts): POST /pages/{id}/attachments, then the
// answer becomes an image node (a verified image) or a link to the file (anything else), at the
// place the upload started.
//
// That place is held by a widget decoration of the `rfUploads` plugin, which ProseMirror maps
// through every edit made while the bytes travel, so the attachment lands where the user put it
// even if they keep typing above it. The placeholder is not content: it is never saved, and
// adding or removing it is not an undo step.
// spec: docs/specs/10-ui-reference.md section 5.5 (Files and images); docs/specs/09-decision-log.md sections RD-058 and RD-071
import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { t } from "@/copy";
import { LIMITS } from "@/domain/documents/limits";
import type { ClientErrorCode } from "./api";

type UploadMeta = { readonly add: { readonly id: string; readonly pos: number; readonly name: string } } | { readonly remove: string };

export const uploadsKey = new PluginKey<DecorationSet>("rfUploads");

function placeholderWidget(name: string): HTMLElement {
  const widget = document.createElement("span");
  widget.className = "rf-upload-placeholder";
  widget.setAttribute("aria-hidden", "true");
  widget.textContent = t("editor.upload.uploading", { name });
  return widget;
}

// spec: docs/specs/09-decision-log.md section RD-058 (uploads land where they started)
export function uploadPlaceholderPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadsKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(uploadsKey) as UploadMeta | undefined;
        if (meta && "add" in meta) {
          const pos = Math.max(0, Math.min(meta.add.pos, tr.doc.content.size));
          const widget = Decoration.widget(pos, () => placeholderWidget(meta.add.name), { id: meta.add.id, side: -1 });
          next = next.add(tr.doc, [widget]);
        } else if (meta && "remove" in meta) {
          next = next.remove(next.find(undefined, undefined, (spec: { id?: unknown }) => spec.id === meta.remove));
        }
        return next;
      },
    },
    props: {
      decorations: (state) => uploadsKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export const UploadPlaceholders = Extension.create({
  name: "rfUploads",
  addProseMirrorPlugins() {
    return [uploadPlaceholderPlugin()];
  },
});

/** Marks `pos` as where upload `id` will land. Not an undo step. */
export function addUploadPlaceholder(tr: Transaction, id: string, pos: number, name: string): Transaction {
  return tr.setMeta(uploadsKey, { add: { id, pos, name } } satisfies UploadMeta).setMeta("addToHistory", false);
}

/** Drops upload `id`'s placeholder (in the same transaction as the insert, or alone after a failure). */
export function removeUploadPlaceholder(tr: Transaction, id: string): Transaction {
  return tr.setMeta(uploadsKey, { remove: id } satisfies UploadMeta);
}

/** Where upload `id` will land now, or null when its place was deleted. */
export function findUploadPlaceholder(state: EditorState, id: string): number | null {
  const set = uploadsKey.getState(state);
  const found = set?.find(undefined, undefined, (spec: { id?: unknown }) => spec.id === id)[0];
  return found ? found.from : null;
}

// ------------------------------------------------------------------------------- messages

/** Why an upload did not attach: a server problem code, or the client's own checks. */
export type UploadFailure = ClientErrorCode | "EMPTY" | "CLIENT_TOO_LARGE" | "NOT_INSERTED";

const MIB = 1024 * 1024;

function mib(limit: number | null): string {
  const bytes = limit !== null && Number.isFinite(limit) && limit > 0 ? limit : LIMITS.attachmentMaxBytes;
  return String(Math.round((bytes / MIB) * 10) / 10);
}

/**
 * Checks the browser can make before sending anything: an empty file, or one over the limit
 * (RD-058). The server makes them again, with the type checks (RD-071); these only save a
 * pointless upload.
 */
// spec: docs/specs/09-decision-log.md sections RD-058 (10 MiB) and RD-071 (empty, too large)
export function precheckUpload(file: Pick<File, "size">): UploadFailure | null {
  if (file.size === 0) return "EMPTY";
  if (file.size > LIMITS.attachmentMaxBytes) return "CLIENT_TOO_LARGE";
  return null;
}

/** What a failed upload says, from the copy deck. */
// spec: docs/specs/08-api-surface.md section 3.2 (TOO_LARGE, UNSUPPORTED_MEDIA, …); RD-058, RD-071
export function uploadFailureText(failure: UploadFailure, name: string, limit: number | null = null): string {
  switch (failure) {
    case "EMPTY":
      return t("editor.upload.empty", { name });
    case "CLIENT_TOO_LARGE":
    case "TOO_LARGE":
      return t("editor.upload.tooLarge", { name, mib: mib(limit) });
    case "UNSUPPORTED_MEDIA":
      return t("editor.upload.unsupported", { name });
    case "UNAUTHENTICATED":
      return t("editor.upload.signedOut", { name });
    case "FORBIDDEN":
    case "NOT_FOUND":
      return t("editor.upload.noAccess");
    default:
      return t("editor.upload.failed", { name });
  }
}

/** The name a dropped or pasted file is uploaded under (a pasted screenshot may have none). */
export function uploadName(file: Pick<File, "name" | "type">): string {
  const name = file.name.trim();
  if (name.length > 0) return name;
  const subtype = /^image\/(png|jpeg|gif|webp)$/.exec(file.type)?.[1];
  return subtype ? `image.${subtype === "jpeg" ? "jpg" : subtype}` : "file";
}
