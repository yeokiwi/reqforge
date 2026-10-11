"use client";

// One upload path for the toolbar's `🖼`, the `+ ▾` menu's `Files and images`, a paste and a drop
// (RD-058): every file is checked, marked in the document where it will land, sent to
// POST /pages/{id}/attachments, and on success inserted there as an image or a link, as ONE
// transaction (one undo step) that also drops the mark. A failure drops the mark and leaves a
// message, in the copy deck's words for its problem code, until the user dismisses it.
// spec: docs/specs/10-ui-reference.md section 5.5 (Files and images); docs/specs/09-decision-log.md sections RD-058 and RD-071
import type { Editor } from "@tiptap/core";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentRef } from "@/domain/documents/api-types";
import { toApiError } from "./api";
import { insertAttachmentAt } from "./insert-commands";
import type { EditorUiBridge } from "./ui-bridge";
import {
  type UploadFailure,
  addUploadPlaceholder,
  findUploadPlaceholder,
  precheckUpload,
  removeUploadPlaceholder,
  uploadFailureText,
  uploadName,
} from "./uploads";

export type Upload =
  | { readonly id: string; readonly name: string; readonly status: "uploading" }
  | { readonly id: string; readonly name: string; readonly status: "failed"; readonly message: string };

export interface UploadsApi {
  uploadAttachment(file: Blob, filename: string, signal?: AbortSignal): Promise<AttachmentRef>;
}

export interface Uploads {
  readonly items: readonly Upload[];
  /** Uploads and inserts files; `pos` is where (null: at the selection). */
  upload(files: readonly File[], pos: number | null): void;
  dismiss(id: string): void;
}

let uploadCount = 0;

// spec: docs/specs/09-decision-log.md section RD-058
export function useUploads(api: UploadsApi, editorRef: RefObject<Editor | null>, ui: EditorUiBridge): Uploads {
  const [items, setItems] = useState<readonly Upload[]>([]);
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    const pending = controllers.current;
    return () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    };
  }, []);

  const fail = useCallback((id: string, name: string, failure: UploadFailure, limit: number | null) => {
    const message = uploadFailureText(failure, name, limit);
    setItems((list) => {
      const failed: Upload = { id, name, status: "failed", message };
      return list.some((u) => u.id === id) ? list.map((u) => (u.id === id ? failed : u)) : [...list, failed];
    });
  }, []);

  const upload = useCallback(
    (files: readonly File[], pos: number | null) => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      for (const file of files) {
        const id = `upload-${++uploadCount}`;
        const name = uploadName(file);
        const refused = precheckUpload(file);
        if (refused) {
          fail(id, name, refused, null);
          continue;
        }
        const at = pos ?? editor.state.selection.from;
        editor.view.dispatch(addUploadPlaceholder(editor.state.tr, id, at, name));
        setItems((list) => [...list, { id, name, status: "uploading" }]);
        const controller = new AbortController();
        controllers.current.add(controller);
        api.uploadAttachment(file, name, controller.signal).then(
          (ref) => {
            controllers.current.delete(controller);
            ui.rememberAttachment(ref.id);
            const current = editorRef.current;
            if (!current || current.isDestroyed) return;
            // Where it started; if that text has since been deleted, where the caret is now.
            const place = findUploadPlaceholder(current.state, id) ?? current.state.selection.from;
            const tr = removeUploadPlaceholder(current.state.tr, id);
            const inserted = insertAttachmentAt(tr, place, ref);
            current.view.dispatch(tr);
            if (inserted) setItems((list) => list.filter((u) => u.id !== id));
            else fail(id, name, "NOT_INSERTED", null);
          },
          (error: unknown) => {
            controllers.current.delete(controller);
            const failure = toApiError(error);
            const current = editorRef.current;
            if (current && !current.isDestroyed) current.view.dispatch(removeUploadPlaceholder(current.state.tr, id).setMeta("addToHistory", false));
            if (failure.code === "ABORTED") return;
            fail(id, name, failure.code, failure.limit);
          },
        );
      }
    },
    [api, editorRef, ui, fail],
  );

  const dismiss = useCallback((id: string) => setItems((list) => list.filter((u) => u.id !== id)), []);

  return { items, upload, dismiss };
}
