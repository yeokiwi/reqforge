"use client";

// The macro browser (10 §5.5 `Other macros`, and `Open macro browser` in the `{` list): every
// macro, with its status. The ones that are not built yet are listed and disabled — Requirement
// (slice 2), Requirement report, Traceability matrix and Baseline (later slices), Gallery and the
// external-issue macro (later) — so users can see what is coming without being able to insert a
// macro that does nothing. A search box filters by name; arrow keys move in the list.
// spec: docs/specs/10-ui-reference.md section 5.5 (`Other macros` opens the macro browser, which also lists Requirement report, Traceability matrix and Baseline)
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { t } from "@/copy";
import { Dialog, secondaryButtonClass } from "./dialog";
import { type MacroId, browserMacros, isMacroAvailable } from "./macros";

export interface MacroBrowserProps {
  readonly onChoose: (id: MacroId) => void;
  readonly onCancel: () => void;
  readonly fallbackFocus?: () => void;
}

const inputClass =
  "mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-action-primary focus:outline-none focus:ring-1 focus:ring-action-primary";

// spec: docs/specs/10-ui-reference.md section 5.5 (the macro browser)
export function MacroBrowser({ onChoose, onCancel, fallbackFocus }: MacroBrowserProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const listId = useId();
  const macros = useMemo(() => browserMacros(query), [query]);

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <Dialog title={t("editor.macroBrowser.title")} onDismiss={onCancel} testId="macro-browser" size="wide" fallbackFocus={fallbackFocus}>
      <div className="mt-4">
        <label htmlFor={searchId} className="block text-sm font-medium">
          {t("editor.macroBrowser.search")}
        </label>
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          value={query}
          data-autofocus=""
          aria-controls={listId}
          className={inputClass}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              document.getElementById(listId)?.querySelector<HTMLButtonElement>("button")?.focus();
            }
          }}
        />
      </div>
      {macros.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-slate-600">
          {t("editor.macroBrowser.none", { q: query.trim() })}
        </p>
      ) : (
        <ul id={listId} aria-label={t("editor.macroBrowser.list")} className="mt-4 grid grid-cols-2 gap-2" onKeyDown={onListKeyDown}>
          {macros.map((m) => {
            const available = isMacroAvailable(m.id);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-disabled={available ? undefined : "true"}
                  aria-describedby={available ? undefined : `${listId}-${m.id}-status`}
                  data-macro={m.id}
                  className="flex w-full items-center gap-3 rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:bg-transparent"
                  onClick={() => {
                    if (available) onChoose(m.id);
                  }}
                >
                  <span aria-hidden="true" className="w-5 text-center text-base">
                    {m.glyph}
                  </span>
                  <span className="flex-1">{t(m.label)}</span>
                  {available ? null : (
                    <span id={`${listId}-${m.id}-status`} className="text-xs text-slate-500">
                      {t("shell.later")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-5 flex justify-end">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          {t("editor.dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}
