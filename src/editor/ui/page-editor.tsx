"use client";

// The page editor (10 §5.1), top to bottom:
//
//   toolbar row 1                                                     (always)
//   toolbar row 2: table tools                                        (only while the selection is in a table)
//   conflict banner                                                   (only after someone else published, RD-055)
//   breadcrumb · label · restriction                       presence   (10 §5.1, RD-062)
//   editable title
//   content (.rf-content.rf-editor)
//   footer: errors · save state · What did you change? · Notify watchers · Update · Close · ···
//
// Saving follows RD-055: edits autosave a draft (use-autosave.ts); Update publishes a version
// from the editor's own state (not from the draft) and returns to the page; Close returns to
// the page keeping the draft; Revert to last published deletes the draft and reloads the current
// version. A conflict offers Overwrite or Reload latest. While a file is uploading, none of those
// can be pressed: the file is in no version and no draft until it lands (RD-058). The TipTap
// editor is created on the client only (immediatelyRender: false), so server and client markup agree.
//
// Inserting (10 §5.3–5.5): the `+ ▾` menu, the `{` Macro suggestions and the macro browser; the
// dialogs behind Markup, Date, Symbol, User mention and Status; files from `🖼`, the menu, a paste
// or a drop, all uploaded through one path (RD-058). `🔍` and Ctrl/Cmd+F open the find bar, `?`
// and Ctrl/Cmd+/ the keyboard shortcuts (RD-057). The extensions reach this component through
// one EditorUiBridge (ui-bridge.ts).
// spec: docs/specs/10-ui-reference.md sections 5.1, 5.4 and 5.5; docs/specs/09-decision-log.md sections RD-055, RD-057, RD-058, RD-061, RD-062, RD-063
import "../content.css";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { type FocusEvent, type KeyboardEvent, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { t } from "@/copy";
import type { GetPageResponse, UserRef } from "@/domain/documents/api-types";
import { LIMITS } from "@/domain/documents/limits";
import { truncateCodePoints } from "@/domain/documents/text";
import { checkTitle } from "@/domain/documents/title";
import { STATUS_COLOURS, type StatusColour } from "@/editor/schema";
import { ApiError, createPageApi, toApiError } from "./api";
import type { SaveReason } from "./autosave-scheduler";
import { type LinkTarget, applyLink, linkTarget, removeLink, toolbarState } from "./commands";
import { ConflictBanner } from "./conflict-banner";
import { ConfirmDialog } from "./dialog";
import { EditorFooter } from "./editor-footer";
import { EditorHeader } from "./editor-header";
import { buildEditorExtensions } from "./extensions";
import { FindBar } from "./find-bar";
import {
  findNodePos,
  insertDate,
  insertMacro,
  insertMention,
  insertText,
  runInsert,
  todayValue,
  updateDate,
  updateStatus,
} from "./insert-commands";
import { InsertMenu, type InsertMenuActions } from "./insert-menu";
import { LinkDialog } from "./link-dialog";
import { MacroBrowser } from "./macro-browser";
import { insertMarkupHtml, markupToHtml } from "./markdown";
import { MarkupDialog } from "./markup-dialog";
import { MentionDialog } from "./mention-dialog";
import { footerMessages, messageText, publishProblemOf, titleMessage } from "./messages";
import { DateDialog, StatusDialog } from "./node-dialogs";
import { imageAttachmentIds } from "./paste";
import { type DiscardAction, INITIAL_SAVE_STATE, canPublish, saveLabel, saveReducer } from "./save-state";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { MacroSuggestionController } from "./suggestion";
import { MacroSuggestionList } from "./suggestion-list";
import { SymbolDialog } from "./symbol-dialog";
import { EditorToolbar, TableToolbar } from "./toolbar";
import { EditorUiBridge, type NodeEditTarget } from "./ui-bridge";
import { UploadStatus } from "./upload-status";
import { useAutosave } from "./use-autosave";
import { usePresence } from "./use-presence";
import { useUploads } from "./use-uploads";

export interface PageEditorProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: {
    readonly id: string;
    readonly title: string;
    /** Root first, excluding the page itself. */
    readonly ancestors: readonly { readonly id: string; readonly title: string }[];
    readonly restricted: boolean;
  };
  /** What the editor opens with: the caller's draft if they have one, else the current version (RD-055). */
  readonly initial: {
    readonly title: string;
    readonly content: unknown;
    /** The version the edit started from: the draft's base, or the current version. */
    readonly baseVersion: number;
    readonly fromDraft: boolean;
  };
  readonly me: { readonly id: string; readonly name: string };
  /** Where Update and Close go: the page view. */
  readonly viewHref: string;
  /** `···` → Page history. */
  readonly historyHref: string;
}

/** Saves that may outlive the page (the tab is closing): sent with `keepalive`. */
const KEEPALIVE_REASONS: ReadonlySet<SaveReason> = new Set<SaveReason>(["dispose", "hidden"]);

type OpenDialog =
  | { readonly kind: "link"; readonly target: LinkTarget }
  | { readonly kind: "revert" }
  | { readonly kind: "closeUnsaved" }
  | { readonly kind: "markup" | "symbol" | "mention" | "macroBrowser" | "shortcuts" }
  /** Inserting a date (`node` null) or editing the date node `node`. */
  | { readonly kind: "date"; readonly node: PMNode | null; readonly value: string }
  | { readonly kind: "status"; readonly node: PMNode; readonly text: string; readonly colour: StatusColour };

/** Text the find bar starts with: the selection, when it is short and on one line. */
export function initialFindQuery(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  if (empty || to - from > 200) return "";
  const text = editor.state.doc.textBetween(from, to, "\n");
  return text.includes("\n") ? "" : text;
}

function statusColourOf(value: unknown): StatusColour {
  return (STATUS_COLOURS as readonly unknown[]).includes(value) ? (value as StatusColour) : "grey";
}

function asContent(value: unknown): JSONContent | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JSONContent) : null;
}

/**
 * Replaces the editor's document with a version from the server, as a fresh state: the undo
 * history starts again, so Undo cannot bring the discarded draft back. No update event is
 * emitted (it is not an edit); a no-op transaction lets the toolbar re-read its state.
 */
// spec: docs/specs/09-decision-log.md section RD-055 (Revert to last published; Reload latest)
export function loadDocument(editor: Editor, content: unknown): void {
  const json = asContent(content);
  try {
    const doc = editor.schema.nodeFromJSON(json);
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc, plugins: editor.state.plugins }));
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  } catch {
    editor.commands.setContent(json, false);
  }
}

// spec: docs/specs/10-ui-reference.md section 5.1 (Editor layout); docs/specs/09-decision-log.md section RD-055
export function PageEditor({ space, page, initial, me, viewHref, historyHref }: PageEditorProps) {
  const router = useRouter();
  const api = useMemo(() => createPageApi({ spaceKey: space.key, pageId: page.id }), [space.key, page.id]);
  const [save, dispatch] = useReducer(saveReducer, INITIAL_SAVE_STATE);
  const [title, setTitle] = useState(initial.title);
  const [changeNote, setChangeNote] = useState("");
  const [notifyWatchers, setNotifyWatchers] = useState(true);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [find, setFind] = useState<{ readonly initialQuery: string } | null>(null);
  const titleId = useId();
  const titleErrorId = useId();

  const rootRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  // The one object the editor's extensions hold to reach this component (ui-bridge.ts).
  const [ui] = useState(() => new EditorUiBridge(new MacroSuggestionController()));
  // Read by the draft save and by Update, which must see the newest values, not a render's.
  const titleRef = useRef(initial.title);
  const baseVersionRef = useRef(initial.baseVersion);
  // Set synchronously so a double click cannot start two publishes or two reloads.
  const busyRef = useRef(false);

  const autosave = useAutosave({
    save: (reason) => {
      const editor = editorRef.current;
      if (!editor) return Promise.reject(new ApiError("UNEXPECTED_RESPONSE", 0));
      return api.saveDraft(
        { title: titleRef.current, content: editor.getJSON(), baseVersion: baseVersionRef.current },
        { keepalive: KEEPALIVE_REASONS.has(reason) },
      );
    },
    dispatch,
  });

  // useEditor re-applies its options on every render: keep them the same objects.
  const [extensions] = useState(() => buildEditorExtensions({ placeholder: t("editor.placeholder"), ui }));
  const [editorProps] = useState(() => ({
    attributes: { role: "textbox", "aria-multiline": "true", "aria-label": t("editor.content.label") },
  }));
  const onUpdate = useCallback(() => autosave.change("content"), [autosave]);
  const editor = useEditor({
    extensions,
    content: asContent(initial.content),
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps,
    onUpdate,
  });

  useEffect(() => {
    editorRef.current = editor;
    // The images the page opened with are its attachments: a paste may keep them (RD-058).
    if (editor) for (const id of imageAttachmentIds(editor.state.doc)) ui.rememberAttachment(id);
  }, [editor, ui]);

  const toolbar = useEditorState({ editor, selector: ({ editor: current }) => (current ? toolbarState(current) : null) });

  const busy = save.activity !== "editing";
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === busy) editor.setEditable(!busy, false);
  }, [editor, busy]);

  // Reopening a stale draft: say so at once rather than at the first autosave (RD-055).
  useEffect(() => {
    if (!initial.fromDraft) return;
    const controller = new AbortController();
    api.getDraft(controller.signal).then(
      (draft) => {
        if (draft?.stale) dispatch({ type: "staleDraftFound", currentVersion: draft.currentVersion });
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [api, initial.fromDraft]);

  const others = usePresence((signal) => api.heartbeat(signal), me.id);
  const uploads = useUploads(api, editorRef, ui);
  const searchPeople = useCallback((q: string, signal: AbortSignal) => api.searchPeople(q, signal), [api]);

  // ------------------------------------------------------------------------------ actions

  const changeTitle = (value: string) => {
    const next = truncateCodePoints(value, LIMITS.titleMax);
    titleRef.current = next;
    setTitle(next);
    autosave.change("title");
  };

  const leave = () => {
    router.push(viewHref);
    router.refresh();
  };

  /**
   * Update (and Overwrite): publish the editor's current title and content as a new version. Not
   * while a file is uploading: it is not in the content until it lands (RD-058).
   */
  // spec: docs/specs/09-decision-log.md section RD-055 (Update publishes; VERSION_CONFLICT offers Overwrite); RD-058, RD-061, RD-067
  const publish = async (overwrite: boolean) => {
    const current = editorRef.current;
    if (!current || busyRef.current || uploads.hasPending()) return;
    const checked = checkTitle(titleRef.current);
    if (!checked.ok) {
      dispatch({
        type: "publishFailed",
        problem: { code: checked.problem === "EMPTY" ? "TITLE_EMPTY" : "TITLE_INVALID", field: "title", limit: null },
      });
      titleInputRef.current?.focus();
      return;
    }
    busyRef.current = true;
    dispatch({ type: "publishStarted" });
    current.setEditable(false, false);
    await autosave.pause();
    try {
      await api.publish({
        title: checked.title,
        content: current.getJSON(),
        baseVersion: baseVersionRef.current,
        message: changeNote,
        notifyWatchers,
        ...(overwrite ? { overwrite: true } : {}),
      });
      dispatch({ type: "publishSucceeded" });
      leave();
    } catch (error) {
      const failure = toApiError(error);
      if (failure.code === "VERSION_CONFLICT") {
        // The server always sends currentVersion; if a proxy lost it, a newer version still exists.
        dispatch({ type: "publishConflict", currentVersion: failure.currentVersion ?? baseVersionRef.current + 1 });
      } else {
        const problem = publishProblemOf(failure);
        dispatch({ type: "publishFailed", problem });
        if (problem.field === "title") titleInputRef.current?.focus();
      }
      busyRef.current = false;
      autosave.resume();
    }
  };

  /** Revert to last published, and Reload latest: drop the draft, open the current version. */
  // spec: docs/specs/09-decision-log.md section RD-055 (Revert to last published deletes the draft; Reload latest)
  const discard = async (action: DiscardAction) => {
    const current = editorRef.current;
    if (!current || busyRef.current || uploads.hasPending()) return;
    busyRef.current = true;
    dispatch({ type: "discardStarted", action });
    await autosave.pause();
    try {
      // Read first, then delete: a failure at either step leaves the draft and the editor as they were.
      const latest: GetPageResponse = await api.getPage();
      await api.discardDraft();
      loadDocument(current, latest.version.content);
      for (const id of imageAttachmentIds(current.state.doc)) ui.rememberAttachment(id);
      titleRef.current = latest.version.title;
      setTitle(latest.version.title);
      baseVersionRef.current = latest.version.number;
      autosave.reset();
    } catch (error) {
      dispatch({ type: "discardFailed", action, code: toApiError(error).code });
    } finally {
      busyRef.current = false;
      autosave.resume();
    }
  };

  /**
   * Close: back to the page, keeping the draft (RD-055). Saves what is pending first. Not while a
   * file is uploading: leaving would abort it, and it is in no draft yet (RD-058).
   */
  // spec: docs/specs/09-decision-log.md section RD-055 (Close keeps the draft); RD-058
  const close = async () => {
    if (busyRef.current || uploads.hasPending()) return;
    const saved = await autosave.flush("close");
    if (!saved && autosave.isDirty()) {
      setDialog({ kind: "closeUnsaved" });
      return;
    }
    leave();
  };

  const openLink = () => {
    const current = editorRef.current;
    if (current) setDialog({ kind: "link", target: linkTarget(current) });
  };

  const focusEditor = useCallback(() => {
    const current = editorRef.current;
    if (current && !current.isDestroyed) current.commands.focus();
  }, []);

  /** `🔍` and Ctrl/Cmd+F: open the find bar, or focus it when it is open. */
  const openFind = () => {
    const current = editorRef.current;
    if (!current) return;
    if (find) {
      findInputRef.current?.focus();
      findInputRef.current?.select();
      return;
    }
    setFind({ initialQuery: initialFindQuery(current) });
  };

  const closeFind = () => {
    setFind(null);
    focusEditor();
  };

  /** A status or a date asked to be edited (a click, or Enter while it is selected). */
  const editNode = (target: NodeEditTarget) => {
    const current = editorRef.current;
    const node = current?.state.doc.nodeAt(target.pos);
    if (!current || !current.isEditable || !node) return;
    if (target.kind === "status" && node.type.name === "status") {
      setDialog({ kind: "status", node, text: typeof node.attrs.text === "string" ? node.attrs.text : "", colour: statusColourOf(node.attrs.colour) });
    } else if (target.kind === "date" && node.type.name === "date") {
      setDialog({ kind: "date", node, value: typeof node.attrs.value === "string" ? node.attrs.value : todayValue() });
    }
  };

  const chooseFiles = () => fileInputRef.current?.click();

  const insertActions: InsertMenuActions = {
    chooseFiles,
    openLink,
    openMarkup: () => setDialog({ kind: "markup" }),
    openDate: () => setDialog({ kind: "date", node: null, value: todayValue() }),
    openSymbol: () => setDialog({ kind: "symbol" }),
    openMention: () => setDialog({ kind: "mention" }),
    openMacroBrowser: () => setDialog({ kind: "macroBrowser" }),
  };

  // The extensions call these through the bridge; they are swapped in on every render so they
  // always see the current state.
  useEffect(() => {
    ui.setHandlers({
      openLink,
      openFind,
      openShortcuts: () => setDialog({ kind: "shortcuts" }),
      openMacroBrowser: () => setDialog({ kind: "macroBrowser" }),
      editNode,
      uploadFiles: (files, pos) => uploads.upload(files, pos),
    });
  });

  // The find bar takes focus when it opens.
  useEffect(() => {
    if (!find) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [find]);

  /** Runs `change` on the editor and closes the dialog. */
  const closeDialogAfter = (change: (editor: Editor) => unknown) => {
    setDialog(null);
    const current = editorRef.current;
    if (current) change(current);
  };

  /** The node a dialog was opened for, where it is now (null when it has gone). */
  const nodePos = (node: PMNode): number | null => {
    const current = editorRef.current;
    return current ? findNodePos(current.state.doc, node) : null;
  };

  // Leaving the editor shell (not moving between its own controls) saves what is pending.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && rootRef.current?.contains(next)) return;
    void autosave.flush("blur");
  };

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      editorRef.current?.commands.focus("start");
    }
  };

  // -------------------------------------------------------------------------------- render

  const titleProblem = titleMessage(save);
  const publishing = save.activity === "publishing";
  // A file in flight is in no version and no draft yet: Update, Overwrite, Reload latest, Close
  // and ··· wait for it (RD-058). The upload region says what is uploading.
  const waitForUploads = busy || uploads.pending;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-surface-page" onBlur={onBlur} data-testid="page-editor">
      <div className="shrink-0">
        <EditorToolbar
          editor={editor}
          state={toolbar}
          readOnly={busy}
          onOpenLink={openLink}
          onChooseFiles={chooseFiles}
          insertMenu={<InsertMenu editor={editor} ui={ui} disabled={busy || toolbar === null} actions={insertActions} />}
          onToggleFind={() => (find ? closeFind() : openFind())}
          findOpen={find !== null}
          onOpenShortcuts={() => setDialog({ kind: "shortcuts" })}
        />
        {editor && toolbar?.table ? <TableToolbar editor={editor} table={toolbar.table} readOnly={busy} /> : null}
        {editor && find ? <FindBar editor={editor} readOnly={busy} initialQuery={find.initialQuery} queryRef={findInputRef} onClose={closeFind} /> : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-label={t("editor.files.choose")}
        data-testid="file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) uploads.upload(files, null);
        }}
      />
      {save.conflict ? (
        <ConflictBanner
          currentVersion={save.conflict.currentVersion}
          busy={waitForUploads}
          onOverwrite={() => void publish(true)}
          onReload={() => void discard("reload")}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 pb-24">
          <EditorHeader space={space} page={page} others={others} />
          <input
            ref={titleInputRef}
            id={titleId}
            type="text"
            value={title}
            readOnly={busy}
            aria-label={t("editor.title.label")}
            placeholder={t("editor.title.placeholder")}
            aria-invalid={titleProblem ? true : undefined}
            aria-describedby={titleProblem ? titleErrorId : undefined}
            autoComplete="off"
            className="mt-3 block w-full border-0 bg-transparent p-0 text-3xl font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
            onChange={(event) => changeTitle(event.target.value)}
            onKeyDown={onTitleKeyDown}
          />
          {titleProblem ? (
            <p id={titleErrorId} role="alert" className="mt-1 text-sm text-red-700">
              {messageText(titleProblem)}
            </p>
          ) : null}
          <EditorContent editor={editor} className="rf-content rf-editor mt-6" />
        </div>
      </div>
      {ui.suggestions ? <MacroSuggestionList controller={ui.suggestions} /> : null}
      <UploadStatus uploads={uploads.items} onDismiss={uploads.dismiss} />
      <EditorFooter
        label={saveLabel(save)}
        messages={footerMessages(save)}
        changeNote={changeNote}
        onChangeNote={setChangeNote}
        changeNoteInvalid={save.publishProblem?.field === "message"}
        notifyWatchers={notifyWatchers}
        onNotifyWatchers={setNotifyWatchers}
        canUpdate={editor !== null && canPublish(save) && !uploads.pending}
        publishing={publishing}
        canLeave={!waitForUploads}
        onUpdate={() => void publish(false)}
        onClose={() => void close()}
        onRevert={() => setDialog({ kind: "revert" })}
        historyHref={historyHref}
      />

      {dialog?.kind === "link" ? (
        <LinkDialog
          href={dialog.target.href}
          onSubmit={(input) => {
            setDialog(null);
            if (editorRef.current) applyLink(editorRef.current, input);
          }}
          onRemove={() => {
            setDialog(null);
            if (editorRef.current) removeLink(editorRef.current);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "revert" ? (
        <ConfirmDialog
          title={t("editor.revert.title")}
          description={t("editor.revert.body")}
          confirmLabel={t("editor.revert.confirm")}
          onConfirm={() => {
            setDialog(null);
            void discard("revert");
          }}
          onCancel={() => setDialog(null)}
          testId="revert-dialog"
        />
      ) : null}
      {dialog?.kind === "markup" ? (
        <MarkupDialog
          fallbackFocus={focusEditor}
          onCancel={() => setDialog(null)}
          onSubmit={(source, format) => {
            const current = editorRef.current;
            if (!current) return false;
            const ok = insertMarkupHtml(current, markupToHtml(source, format), { keepImage: (id) => ui.isKnownAttachment(id) });
            if (ok) setDialog(null);
            return ok;
          }}
        />
      ) : null}
      {dialog?.kind === "date" ? (
        <DateDialog
          value={dialog.value}
          editing={dialog.node !== null}
          fallbackFocus={focusEditor}
          onCancel={() => setDialog(null)}
          onSubmit={(value) => {
            const node = dialog.node;
            closeDialogAfter((e) => {
              if (node === null) {
                runInsert(e, (tr) => insertDate(tr, value), (pos) => pos !== null);
                return;
              }
              const pos = nodePos(node);
              if (pos !== null) e.chain().focus().command(({ tr }) => updateDate(tr, pos, value)).run();
            });
          }}
        />
      ) : null}
      {dialog?.kind === "status" ? (
        <StatusDialog
          text={dialog.text}
          colour={dialog.colour}
          fallbackFocus={focusEditor}
          onCancel={() => setDialog(null)}
          onSubmit={(input) => {
            const pos = nodePos(dialog.node);
            closeDialogAfter((e) => {
              if (pos !== null) e.chain().focus().command(({ tr }) => updateStatus(tr, pos, input)).run();
            });
          }}
        />
      ) : null}
      {dialog?.kind === "symbol" ? (
        <SymbolDialog
          fallbackFocus={focusEditor}
          onCancel={() => setDialog(null)}
          onPick={(symbol) => closeDialogAfter((e) => runInsert(e, (tr) => insertText(tr, symbol)))}
        />
      ) : null}
      {dialog?.kind === "mention" ? (
        <MentionDialog
          search={searchPeople}
          fallbackFocus={focusEditor}
          onCancel={() => setDialog(null)}
          onPick={(user: UserRef) => closeDialogAfter((e) => runInsert(e, (tr) => insertMention(tr, user), (pos) => pos !== null))}
        />
      ) : null}
      {dialog?.kind === "macroBrowser" ? (
        <MacroBrowser
          fallbackFocus={focusEditor}
          onCancel={() => setDialog(null)}
          onChoose={(id) => closeDialogAfter((e) => insertMacro(e, id, { ui }))}
        />
      ) : null}
      {dialog?.kind === "shortcuts" ? <ShortcutsDialog fallbackFocus={focusEditor} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "closeUnsaved" ? (
        <ConfirmDialog
          title={t("editor.closeUnsaved.title")}
          description={t("editor.closeUnsaved.body")}
          confirmLabel={t("editor.closeUnsaved.confirm")}
          cancelLabel={t("editor.closeUnsaved.cancel")}
          onConfirm={() => {
            setDialog(null);
            leave();
          }}
          onCancel={() => setDialog(null)}
          testId="close-unsaved-dialog"
        />
      ) : null}
    </div>
  );
}
