"use client";

// The `🔍` find and replace bar (RD-057), under the toolbar while it is open. Typing searches
// (find-replace.ts decorates every match and selects the current one); Enter and Shift+Enter, or
// the arrow buttons, go to the next and previous match; `Match case` makes the search
// case-sensitive; the count says `n of m`, `n of more than m` or `No results`, politely
// announced. Replace and Replace all go through transactions, so both are undoable, and Replace
// all is one undo step. Escape anywhere in the bar closes it, clears the highlights and returns
// focus to the editor.
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍` find and replace in the page; Ctrl+F while the editor is focused)
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { type KeyboardEvent, type Ref, useEffect, useId, useState } from "react";
import { t } from "@/copy";
import { secondaryButtonClass } from "./dialog";
import { type FindCount, clearFind, findCount, findState, moveFindMatch, replaceAllMatches, replaceCurrentMatch, setFindQuery } from "./find-replace";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "./icons";

/** The count line's text. */
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍`: match count)
export function findCountText(count: FindCount | null): string {
  if (!count) return "";
  switch (count.kind) {
    case "none":
      return t("editor.find.none");
    case "count":
      return t("editor.find.count", { current: count.current, total: count.total });
    case "capped":
      return t("editor.find.capped", { current: count.current, total: count.total });
  }
}

export interface FindBarProps {
  readonly editor: Editor;
  /** No replacing while an Update or a reload is in progress. */
  readonly readOnly: boolean;
  /** Text to search for when the bar opens (the selected text, if short and on one line). */
  readonly initialQuery: string;
  readonly queryRef: Ref<HTMLInputElement>;
  readonly onClose: () => void;
}

const inputClass =
  "h-8 w-48 rounded border border-slate-300 px-2 text-sm focus:border-action-primary focus:outline-none focus:ring-1 focus:ring-action-primary";
const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-primary disabled:cursor-not-allowed disabled:opacity-40";

// spec: docs/specs/09-decision-log.md section RD-057 (`🔍`)
export function FindBar({ editor, readOnly, initialQuery, queryRef, onClose }: FindBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const queryId = useId();
  const replaceId = useId();
  const caseId = useId();
  const count = useEditorState({ editor, selector: ({ editor: e }) => findCount(findState(e.state)) });
  const total = count?.kind === "count" || count?.kind === "capped" ? count.total : 0;

  // Search whenever the query or the case setting changes (and once on open).
  useEffect(() => {
    if (editor.isDestroyed) return;
    setFindQuery(editor.state, editor.view.dispatch, query, caseSensitive);
  }, [editor, query, caseSensitive]);

  // Closing (unmounting) clears the highlights.
  useEffect(
    () => () => {
      if (!editor.isDestroyed) clearFind(editor.state, editor.view.dispatch);
    },
    [editor],
  );

  const move = (delta: 1 | -1) => moveFindMatch(editor.state, editor.view.dispatch, delta);
  const replace = () => {
    if (!readOnly) replaceCurrentMatch(editor.state, editor.view.dispatch, replacement);
  };
  const replaceAll = () => {
    if (!readOnly) replaceAllMatches(editor.state, editor.view.dispatch, replacement);
  };

  const onBarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    move(event.shiftKey ? -1 : 1);
  };

  const onReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    replace();
  };

  return (
    <div
      role="search"
      aria-label={t("editor.find")}
      data-testid="find-bar"
      onKeyDown={onBarKeyDown}
      className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-sm"
    >
      <label htmlFor={queryId} className="sr-only">
        {t("editor.find.query")}
      </label>
      <input
        ref={queryRef}
        id={queryId}
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("editor.find.query")}
        value={query}
        className={inputClass}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onQueryKeyDown}
      />
      <span role="status" aria-live="polite" className="min-w-20 text-xs text-slate-600" data-testid="find-count">
        {findCountText(count)}
      </span>
      <button type="button" className={iconButtonClass} aria-label={t("editor.find.previous")} title={t("editor.find.previous")} disabled={total === 0} onClick={() => move(-1)}>
        <ArrowUpIcon />
      </button>
      <button type="button" className={iconButtonClass} aria-label={t("editor.find.next")} title={t("editor.find.next")} disabled={total === 0} onClick={() => move(1)}>
        <ArrowDownIcon />
      </button>
      <span className="flex items-center gap-1">
        <input id={caseId} type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
        <label htmlFor={caseId} className="text-xs text-slate-700">
          {t("editor.find.matchCase")}
        </label>
      </span>
      <label htmlFor={replaceId} className="sr-only">
        {t("editor.find.replacement")}
      </label>
      <input
        id={replaceId}
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("editor.find.replacement")}
        value={replacement}
        readOnly={readOnly}
        className={inputClass}
        onChange={(event) => setReplacement(event.target.value)}
        onKeyDown={onReplaceKeyDown}
      />
      <button type="button" className={secondaryButtonClass} disabled={readOnly || total === 0} onClick={replace}>
        {t("editor.find.replace")}
      </button>
      <button type="button" className={secondaryButtonClass} disabled={readOnly || total === 0} onClick={replaceAll}>
        {t("editor.find.replaceAll")}
      </button>
      <span className="flex-1" />
      <button type="button" className={iconButtonClass} aria-label={t("editor.find.close")} title={t("editor.find.close")} onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}
